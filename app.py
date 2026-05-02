"""
信用卡账单查询系统 - FastAPI 后端
"""
import os, re, json, subprocess
from datetime import date
from decimal import Decimal
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from fastapi import FastAPI, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

from db import get_conn, get_reader_conn

# ============ 路径配置 ============
_HERE = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.getenv("VENV_PYTHON", os.path.join(_HERE, ".venv", "Scripts", "python.exe"))
NODE = os.getenv("NODE_BIN", "node")
LOADER_JS = os.path.join(_HERE, "bank-loader", "loader.js")

# ============ App ============
app = FastAPI(title="信用卡账单查询", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

BANK_NAMES = {
    "ABC": "农业银行", "BOCOM": "交通银行", "CCB": "建设银行", "CGB": "广发银行",
    "CITIC": "中信银行", "CMB": "招商银行", "ICBC": "工商银行", "PAB": "平安银行",
    "CEB": "光大银行", "CMBC": "民生银行", "CZB": "浙商银行", "BOC": "中国银行",
    "SPDB": "浦发银行",
}

# ============ Pydantic 模型 ============
class TransactionItem(BaseModel):
    id: int
    bank_code: str
    bank_name: str
    cardholder: str
    card_last4: str
    card_type: Optional[str]
    trans_date: date
    post_date: date
    description: str
    category: Optional[str]
    amount: float
    currency: str
    trans_type: str
    source: Optional[str]
    bill_cycle: Optional[str]
    account_masked: Optional[str]

class SearchResult(BaseModel):
    total: int
    sum_spend: float = 0
    sum_repay: float = 0
    transactions: list[TransactionItem]


# ============ 工具函数 ============
def row_to_dict(row, cols) -> dict:
    """将数据库行转为字典，金额转 float，日期转字符串"""
    result = {}
    for i, col in enumerate(cols):
        val = row[i]
        if isinstance(val, Decimal):
            val = float(val)
        elif isinstance(val, date):
            val = val.isoformat()
        result[col] = val
    return result

def build_whereClause(params: dict) -> tuple[str, list]:
    """参数化构建 WHERE 条件"""
    conditions = []
    values = []
    bank_code = params.get("bank_code") or params.get("bank")
    cardholder = params.get("cardholder")
    min_amount = params.get("min_amount")
    max_amount = params.get("max_amount")
    start_date = params.get("start_date")
    end_date = params.get("end_date")
    category = params.get("category")
    bill_cycle = params.get("bill_cycle")
    trans_type = params.get("trans_type")
    currency = params.get("currency")
    card_last4 = params.get("card_last4")
    keyword = params.get("keyword")
    description = params.get("description")

    if bank_code:
        conditions.append("t.bank_code = %s")
        values.append(bank_code)
    if cardholder:
        conditions.append("t.cardholder = %s")
        values.append(cardholder)
    if min_amount is not None:
        conditions.append("ABS(t.amount) >= %s")
        values.append(min_amount)
    if max_amount is not None:
        conditions.append("ABS(t.amount) <= %s")
        values.append(max_amount)
    if start_date:
        conditions.append("t.trans_date >= %s")
        values.append(start_date)
    if end_date:
        conditions.append("t.trans_date <= %s")
        values.append(end_date)
    if category:
        conditions.append("t.category = %s")
        values.append(category)
    if bill_cycle:
        conditions.append("(SELECT b.bill_cycle FROM credit_card_bills b WHERE b.id = t.bill_id) = %s")
        values.append(bill_cycle)
    if trans_type:
        conditions.append("t.trans_type = %s")
        values.append(trans_type)
    if currency:
        conditions.append("t.currency = %s")
        values.append(currency)
    if card_last4:
        conditions.append("t.card_last4 = %s")
        values.append(card_last4)
    if keyword:
        conditions.append("t.description ILIKE %s")
        values.append(f"%{keyword}%")
    if description:
        conditions.append("t.description ILIKE %s")
        values.append(f"%{description}%")

    return " ".join(conditions), values


# ============ 路由 ============
@app.get("/")
def index():
    return FileResponse(os.path.join(_HERE, "index.html"))

@app.get("/api/health")
def health():
    return {"status": "ok"}

# ---------- 搜索/筛选 ----------
@app.get("/api/search", response_model=SearchResult)
def search(
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=1, le=200),
    bank_code: Optional[str] = Query(None, alias="bank"),
    cardholder: Optional[str] = Query(None),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    bill_cycle: Optional[str] = Query(None),
    trans_type: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    card_last4: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
):
    params = {k: v for k, v in locals().items() if k not in ("self", "page", "size") and v is not None}
    where_sql, values = build_whereClause(params)

    conn = get_conn()
    cur = conn.cursor()
    try:
        # 聚合
        cur.execute(f"""
            SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
            FROM credit_card_transactions t WHERE 1=1 {where_sql}
        """, values)
        sum_spend, sum_repay = cur.fetchone()
        sum_spend = float(sum_spend)
        sum_repay = float(sum_repay)

        cur.execute(f"SELECT COUNT(*) FROM credit_card_transactions t WHERE 1=1 {where_sql}", values)
        total = cur.fetchone()[0]

        cur.execute(f"""
            SELECT t.id, t.bank_code, b.bank_name, t.cardholder, t.card_last4,
                   COALESCE(t.card_type, '') as card_type,
                   t.trans_date, t.post_date, t.description,
                   COALESCE(t.category, '') as category,
                   t.amount, t.currency, t.trans_type,
                   COALESCE(t.source, '') as source,
                   COALESCE(b.bill_cycle, '') as bill_cycle,
                   COALESCE(t.account_masked, '') as account_masked
            FROM credit_card_transactions t
            LEFT JOIN credit_card_bills b ON t.bill_id = b.id
            WHERE 1=1 {where_sql}
            ORDER BY t.trans_date DESC, t.id DESC
            LIMIT %s OFFSET %s
        """, values + [size, page])
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]
        transactions = [row_to_dict(row, cols) for row in rows]

        return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay, transactions=transactions)
    finally:
        cur.close()
        conn.close()

# ---------- 元数据查询 ----------
@app.get("/api/banks")
def get_banks():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT bank_code, cardholder, COUNT(*) as cnt FROM credit_card_transactions GROUP BY bank_code, cardholder ORDER BY bank_code, cardholder")
        rows = cur.fetchall()
        return [{"bank_code": r[0], "cardholder": r[1], "count": r[2]} for r in rows]
    finally:
        cur.close(); conn.close()

@app.get("/api/categories")
def get_categories():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT category FROM credit_card_transactions WHERE category IS NOT NULL AND category != '' ORDER BY category")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@app.get("/api/cardholders")
def get_cardholders():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT cardholder FROM credit_card_transactions WHERE cardholder IS NOT NULL AND cardholder != '' ORDER BY cardholder")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@app.get("/api/cards")
def get_cards(bank_code: Optional[str] = Query(None)):
    conn = get_conn(); cur = conn.cursor()
    try:
        sql = "SELECT card_last4, COUNT(*) as cnt FROM credit_card_transactions"
        vals = []
        if bank_code:
            sql += " WHERE bank_code = %s"; vals.append(bank_code)
        sql += " GROUP BY card_last4 ORDER BY card_last4"
        cur.execute(sql, vals)
        return [{"card_last4": r[0], "count": r[1]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@app.get("/api/currencies")
def get_currencies():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT currency FROM credit_card_transactions WHERE currency IS NOT NULL AND currency != '' ORDER BY currency")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

# ---------- AI 查询 ----------
import openai
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY", "sk-jtiawbivdncqlenhubffbktndozwmgqrwgvxcyfuiqspghjr"),
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)

@app.get("/api/ai-search", response_model=SearchResult)
def ai_search(
    q: str = Query(..., description="自然语言查询"),
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=1, le=200),
):
    # 查表结构（只读连接）
    conn = get_reader_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'credit_card_transactions' ORDER BY ordinal_position")
        cols = cur.fetchall()
        schema = "\n".join([f"  {c[0]}: {c[1]}" for c in cols])
    finally:
        cur.close(); conn.close()

    prompt = f"""你是一个 PostgreSQL 查询生成器。根据用户的自然语言查询，生成 SQL 查询。

表名: credit_card_transactions
列结构:
{schema}

重要规则:
- amount > 0 消费/支出, amount < 0 还款/存入/退款
- 日期字段: trans_date(交易日), post_date(记账日)
- trans_type: SPEND, REPAY, REFUND, DEPOSIT, INSTALLMENT_PRIN, INSTALLMENT_INT, FEE, CASH_ADVANCE, ADJUST, OTHER
- 持卡人: cardholder
- 自然语言如"消费"对应 amount > 0，"还款"对应 amount < 0

只输出 SQL，不要其他内容。SQL 必须是有效的 SELECT 语句，LIMIT 最大 500 条。
只允许查询 credit_card_transactions 表。"""

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": q}],
        temperature=0,
    )
    sql = response.choices[0].message.content.strip()
    sql = re.sub(r"^```sql\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"^```\s*", "", sql)
    sql = sql.strip().rstrip(";")

    # 安全检查 + 只读用户双重防护
    if not sql.upper().startswith("SELECT") or any(kw in sql.upper() for kw in ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "ALTER", "CREATE"]):
        return {"error": f"不允许的 SQL: {sql[:100]}"}

    conn = get_reader_conn()
    cur = conn.cursor()
    try:
        agg_sql = f"""SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                             COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                      FROM ({sql}) AS sub"""
        cur.execute(agg_sql)
        sum_spend, sum_repay = cur.fetchone()
        sum_spend = float(sum_spend); sum_repay = float(sum_repay)

        cur.execute(f"SELECT COUNT(*) FROM ({sql}) AS sub")
        total = cur.fetchone()[0]

        cur.execute(sql + f" LIMIT {size} OFFSET {page}")
        rows = cur.fetchall()
        cols_desc = [desc[0] for desc in cur.description]
        transactions = [row_to_dict(row, cols_desc) for row in rows]
        return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay, transactions=transactions)
    except Exception as e:
        return {"error": f"SQL 执行失败: {str(e)}\nSQL: {sql}"}
    finally:
        cur.close(); conn.close()

# ---------- 导出 Excel ----------
@app.get("/api/export")
def export_excel(
    cardholder: Optional[str] = Query(None),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    bank_code: Optional[str] = Query(None),
    bill_cycle: Optional[str] = Query(None),
    trans_type: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    card_last4: Optional[str] = Query(None),
):
    import io, openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    params = {}
    for k in ["cardholder", "min_amount", "max_amount", "start_date", "end_date",
              "bank_code", "bill_cycle", "trans_type", "currency", "card_last4"]:
        v = locals().get(k)
        if v is not None:
            params[k] = v
    where_sql, values = build_whereClause(params)

    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute(f"""SELECT bank_code, cardholder, card_last4, trans_date, post_date,
                               description, amount, trans_type
                        FROM credit_card_transactions t WHERE 1=1 {where_sql}
                        ORDER BY trans_date DESC""", values)
        rows = cur.fetchall()
    finally:
        cur.close(); conn.close()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "交易明细"
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4A90D9", end_color="4A90D9", fill_type="solid")
    thin = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))

    headers = ["银行", "持卡人", "卡号", "交易日期", "记账日", "交易说明", "金额", "类型"]
    for ci, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=ci, value=h)
        c.font = header_font; c.fill = header_fill; c.alignment = Alignment(horizontal='center'); c.border = thin

    for ri, row in enumerate(rows, 2):
        for ci, val in enumerate(row, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.border = thin
            if ci == 7 and isinstance(val, (int, float)):
                cell.number_format = '#,##0.00'
                cell.font = Font(color="FF0000" if val > 0 else "00AA00")

    for col_letter in ['A','B','C','D','E','F','G','H']:
        ws.column_dimensions[col_letter].width = 16
    ws.column_dimensions['F'].width = 40

    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=credit_card_export.xlsx"})

# ---------- 统计 ----------
@app.get("/api/stats")
def get_stats():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM credit_card_transactions"); total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT bank_code) FROM credit_card_transactions"); banks = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT cardholder) FROM credit_card_transactions"); holders = cur.fetchone()[0]
        cur.execute("SELECT MIN(trans_date), MAX(trans_date) FROM credit_card_transactions"); dr = cur.fetchone()
        return {"total_transactions": total, "total_banks": banks, "total_cardholders": holders,
                "date_range": {"from": dr[0].isoformat() if dr[0] else None, "to": dr[1].isoformat() if dr[1] else None}}
    finally:
        cur.close(); conn.close()

# ---------- QQ邮箱刷新 ----------
@app.post("/api/refresh-qq")
async def refresh_qq():
    """从QQ邮箱拉取最新账单"""
    banks = ["abc","boc","bocom","ccb","ceb","cgb","citic","cmb","cmbc","czb","icbc","pab"]
    total_inserted = 0; bank_count = 0; errors = []

    for code in banks:
        r = subprocess.run([NODE, LOADER_JS, code], capture_output=True, text=True, encoding="utf-8", errors="replace")
        output = r.stdout + r.stderr
        for line in output.split("\n"):
            m = re.search(r"新增 (\d+) 条", line)
            if m:
                total_inserted += int(m.group(1))
        if "新增" in output:
            bank_count += 1
        elif r.returncode != 0:
            errors.append(code)

    return {"inserted": total_inserted, "banks": bank_count, "errors": errors}

# ---------- XLS导入 ----------
@app.post("/api/import-xls")
async def import_xls(file: UploadFile = File(...)):
    import tempfile, pandas as pd

    if not file.filename.endswith(".xls"):
        return {"error": "仅支持 .xls 文件", "inserted": 0}

    tmp = tempfile.NamedTemporaryFile(suffix=".xls", delete=False)
    try:
        content = await file.read()
        tmp.write(content); tmp.close()

        try:
            df = pd.read_excel(tmp.name, header=None, engine="xlrd")
        except Exception:
            try:
                df = pd.read_excel(tmp.name, header=None, engine="openpyxl")
            except Exception as e2:
                return {"error": f"解析失败: {e2}", "inserted": 0}

        transactions = []
        errors = []
        for i in range(1, len(df)):
            row = df.iloc[i]
            try:
                td = str(int(row[0]))
                pd_ = str(int(row[1]))
                desc = str(row[2])[:200]
                card = str(int(row[3]))
                amt = float(row[6])
                if len(td) == 8 and len(pd_) == 8:
                    transactions.append({
                        "trans_date": f"{td[:4]}-{td[4:6]}-{td[6:8]}",
                        "post_date": f"{pd_[:4]}-{pd_[4:6]}-{pd_[6:8]}",
                        "description": desc,
                        "amount": amt,
                        "card_last4": card,
                        "cardholder": os.getenv("DEFAULT_CARDHOLDER", "吴华辉"),
                    })
                else:
                    errors.append(f"行{i}: 日期格式错误 td={td} pd_={pd_}")
            except Exception as e:
                errors.append(f"行{i}: {e}")

        if not transactions:
            return {"error": f"未找到有效交易数据 ({len(errors)}行解析失败)", "inserted": 0, "errors": errors[:10]}

        # 批量入库
        conn = get_conn(); cur = conn.cursor()
        try:
            bill_cycle = transactions[0]["trans_date"][:7]
            bill_date = transactions[-1]["post_date"]

            cur.execute("""
                INSERT INTO credit_card_bills (bank_code,bank_name,cardholder,bill_date,bill_cycle,cycle_start,cycle_end,account_masked)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW()
                RETURNING id
            """, ("SPDB","浦发银行",transactions[0]["cardholder"],bill_date,bill_cycle,
                  transactions[0]["trans_date"],transactions[-1]["trans_date"],
                  "****"+transactions[0].get("card_last4","")))
            bill_id = cur.fetchone()[0]

            inserted = 0
            for t in transactions:
                try:
                    cur.execute("""
                        INSERT INTO credit_card_transactions (bill_id,bank_code,cardholder,card_last4,account_masked,
                            trans_date,post_date,description,amount,currency,trans_type,source,raw_line_text)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'upload',%s)
                        ON CONFLICT (bank_code,trans_date,post_date,card_last4,description,amount) DO NOTHING
                    """, (bill_id,"SPDB",t["cardholder"],t["card_last4"],"****"+t["card_last4"],
                          t["trans_date"],t["post_date"],t["description"],t["amount"],"CNY",
                          "SPEND" if t["amount"] > 0 else "REPAY",
                          f'{t["trans_date"]}|{t["amount"]}|{t["description"]}'))
                    if cur.rowcount > 0: inserted += 1
                except Exception as e:
                    errors.append(f"入库失败: {t.get('trans_date','?')} {e}")
            conn.commit()
            return {"inserted": inserted, "total": len(transactions), "errors": errors[:10], "filename": file.filename, "bill_cycle": bill_cycle}
        finally:
            cur.close(); conn.close()
    finally:
        os.unlink(tmp.name)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
