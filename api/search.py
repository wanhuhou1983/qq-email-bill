"""
搜索/筛选 + AI查询 路由
"""
import os, re
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from openai import OpenAI

from db import get_conn, get_reader_conn
from api.models import SearchResult, DebitSearchResult
from api.utils import row_to_dict, build_where_clause

router = APIRouter(tags=["search"])


def get_ai_client() -> OpenAI:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 DEEPSEEK_API_KEY（请在 .env 中设置）")
    return OpenAI(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    )


def validate_ai_sql(raw: str) -> str:
    sql = raw.strip()

    # 提取 ```sql ... ``` 块（模型可能输出中文解释+SQL）
    blocks = re.findall(r"```(?:sql)?\s*([\s\S]*?)```", sql, flags=re.IGNORECASE)
    if blocks:
        sql = max(blocks, key=len).strip()
    else:
        # 无代码块：取第一个 SELECT 语句
        m = re.search(r"SELECT\s.*", sql, flags=re.IGNORECASE | re.DOTALL)
        if m:
            sql = m.group(0).strip().rstrip(";")

    upper = sql.upper()

    # 安全检查
    banned_keywords = ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE",
                       "ALTER", "CREATE", "GRANT", "REVOKE", "COPY"]
    # 仅禁止多语句分号；语句末尾的分号允许
    multi_stmt_chk = sql.rstrip(";")
    if ";" in multi_stmt_chk:
        raise HTTPException(status_code=400, detail="AI SQL 包含多语句（不允许）")
    banned_tokens = ["--", "/*", "*/", "PG_", "INFORMATION_SCHEMA", "PG_CATALOG"]

    if not upper.startswith("SELECT"):
        raise HTTPException(status_code=400, detail="AI 仅允许生成 SELECT 查询")
    if any(kw in upper for kw in banned_keywords):
        raise HTTPException(status_code=400, detail="AI SQL 包含危险关键字")
    if any(t in upper for t in banned_tokens):
        raise HTTPException(status_code=400, detail="AI SQL 包含不允许的结构")
    if "CREDIT_CARD_TRANSACTIONS" not in upper:
        raise HTTPException(status_code=400, detail="AI SQL 必须查询 credit_card_transactions")
    if "JOIN " in upper or "WITH " in upper:
        raise HTTPException(status_code=400, detail="AI SQL 暂不允许 JOIN 或 CTE")

    # 去掉尾部分号（子查询包装时会报错）
    sql = sql.rstrip(";").strip()

    return sql


@router.get("/search", response_model=SearchResult)
def search(
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=0, le=200),
    bank_code: Optional[str] = Query(None, alias="bank_code"),
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
    bill_id: Optional[int] = Query(None),
):
    params = {k: v for k, v in locals().items() if k not in ("self", "page", "size") and v is not None}
    where_sql, values = build_where_clause(params)

    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute(f"""SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                               COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                        FROM credit_card_transactions t WHERE 1=1 {where_sql}""", values)
        sum_spend, sum_repay = cur.fetchone()
        sum_spend = float(sum_spend); sum_repay = float(sum_repay)

        cur.execute(f"SELECT COUNT(*) FROM credit_card_transactions t WHERE 1=1 {where_sql}", values)
        total = cur.fetchone()[0]

        # size=0 时只返回聚合值，不查询交易明细
        if size == 0:
            return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay, transactions=[])

        offset = page * size
        cur.execute(f"""
            SELECT t.id, t.bill_id, t.bank_code, COALESCE(b.bank_name, '') as bank_name,
                   t.cardholder, t.card_last4, COALESCE(t.card_type, '') as card_type,
                   t.trans_date, t.post_date, t.description, COALESCE(t.category, '') as category,
                   t.amount, t.currency, t.trans_type, COALESCE(t.source, '') as source,
                   COALESCE(b.bill_cycle, '') as bill_cycle, COALESCE(t.account_masked, '') as account_masked
            FROM credit_card_transactions t
            LEFT JOIN credit_card_bills b ON t.bill_id = b.id
            WHERE 1=1 {where_sql}
            ORDER BY t.trans_date DESC, t.id DESC LIMIT %s OFFSET %s
        """, values + [size, offset])
        cols = [desc[0] for desc in cur.description]
        return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay,
                            transactions=[row_to_dict(r, cols) for r in cur.fetchall()])
    finally:
        cur.close(); conn.close()


@router.get("/ai-search")
def ai_search(
    q: str = Query(..., description="自然语言查询"),
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=1, le=200),
):
    offset = page * size

    conn = get_reader_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'credit_card_transactions' ORDER BY ordinal_position")
        schema = "\n".join([f"  {c[0]}: {c[1]}" for c in cur.fetchall()])
    finally:
        cur.close(); conn.close()

    prompt = f"""你是一个 PostgreSQL 查询生成器。根据用户的自然语言查询，生成 SQL 查询。

数据库表名: credit_card_transactions（简称 cct）
列结构:
{schema}

规则:
- amount > 0 消费/支出, amount < 0 还款/存入/退款
- trans_type: SPEND/REPAY/REFUND/DEPOSIT/INSTALLMENT_PRIN/INSTALLMENT_INT/FEE/CASH_ADVANCE/ADJUST/OTHER
- 自然语言"消费"→ amount > 0，"还款"→ amount < 0
- 表名必须是 credit_card_transactions，不要用简称或缩写
- 只能用 SELECT * 查询明细记录，不允许 SELECT 指定字段，不允许聚合函数
- 排序用 ORDER BY trans_date DESC
- LIMIT 最大 500 条

只输出 SQL 代码，不要任何解释。"""

    client = get_ai_client()
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": q}],
        temperature=0,
    )

    sql = validate_ai_sql(response.choices[0].message.content)

    conn = get_reader_conn(); cur = conn.cursor()
    try:
        # 先跑计数
        cur.execute(f"SELECT COUNT(*) FROM ({sql}) AS sub")
        total = cur.fetchone()[0]

        # 跑数据（带分页）
        paged_sql = f"SELECT * FROM ({sql}) AS sub LIMIT {size} OFFSET {offset}"
        cur.execute(paged_sql)
        if cur.description is None:
            raise HTTPException(status_code=400, detail="AI SQL 无法返回结果")
        cols = [desc[0] for desc in cur.description]
        rows = cur.fetchall()

        # 消费/还款：适配聚合查询（子查询中无 amount 列）和明细查询
        sum_spend = 0.0; sum_repay = 0.0
        if "amount" in [c.lower() for c in cols]:
            try:
                cur.execute(f"""SELECT COALESCE(SUM(CASE WHEN sub.amount > 0 THEN sub.amount ELSE 0 END), 0),
                                       COALESCE(SUM(CASE WHEN sub.amount < 0 THEN ABS(sub.amount) ELSE 0 END), 0)
                                FROM ({sql}) AS sub""")
                s = cur.fetchone()
                sum_spend = float(s[0]); sum_repay = float(s[1])
            except:
                pass

        return {
            "total": total,
            "sum_spend": sum_spend,
            "sum_repay": sum_repay,
            "transactions": [row_to_dict(r, cols) for r in rows],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL 执行失败: {str(e)}")
    finally:
        cur.close(); conn.close()


# ============ 借记卡查询 ============

@router.get("/debit/search", response_model=DebitSearchResult)
def debit_search(
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=0, le=200),
    bank_code: Optional[str] = Query(None),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    keyword: Optional[str] = Query(None),
    counterparty_name: Optional[str] = Query(None),
):
    conditions = []
    values = []

    if bank_code:
        conditions.append("AND bank_code = %s"); values.append(bank_code)
    if min_amount is not None:
        conditions.append("AND ABS(amount) >= %s"); values.append(min_amount)
    if max_amount is not None:
        conditions.append("AND ABS(amount) <= %s"); values.append(max_amount)
    if start_date:
        conditions.append("AND trans_date >= %s"); values.append(start_date)
    if end_date:
        conditions.append("AND trans_date <= %s"); values.append(end_date)
    if keyword:
        conditions.append("AND (description ILIKE %s OR counterparty_name ILIKE %s)")
        values.append(f"%{keyword}%"); values.append(f"%{keyword}%")
    if counterparty_name:
        conditions.append("AND counterparty_name ILIKE %s")
        values.append(f"%{counterparty_name}%")

    where = " ".join(conditions)
    offset = page * size

    conn = get_reader_conn(); cur = conn.cursor()
    try:
        cur.execute(f"""SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                               COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                        FROM debit_card_transactions WHERE 1=1 {where}""", values)
        r = cur.fetchone()
        sum_income = float(r[0]); sum_expense = float(r[1])

        cur.execute(f"SELECT COUNT(*) FROM debit_card_transactions WHERE 1=1 {where}", values)
        total = cur.fetchone()[0]

        if size == 0:
            return DebitSearchResult(total=total, sum_income=sum_income, sum_expense=sum_expense, transactions=[])

        cur.execute(f"""
            SELECT id, bank_code, account_number, trans_date, description,
                   debit, credit, balance, amount,
                   COALESCE(counterparty_name,'') as counterparty_name,
                   COALESCE(counterparty_bank,'') as counterparty_bank,
                   COALESCE(counterparty_account,'') as counterparty_account
            FROM debit_card_transactions WHERE 1=1 {where}
            ORDER BY trans_date ASC, id ASC LIMIT %s OFFSET %s
        """, values + [size, offset])
        cols = [desc[0] for desc in cur.description]
        return DebitSearchResult(total=total, sum_income=sum_income, sum_expense=sum_expense,
                                 transactions=[row_to_dict(r, cols) for r in cur.fetchall()])
    finally:
        cur.close(); conn.close()


@router.get("/debit/banks")
def debit_banks():
    conn = get_reader_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT bank_code FROM debit_card_transactions ORDER BY bank_code")
        return [row[0] for row in cur.fetchall()]
    finally:
        cur.close(); conn.close()


@router.get("/bill-cycles")
def bill_cycles(cardholder: Optional[str] = Query(None), bank_code: Optional[str] = Query(None),
                bank: Optional[str] = Query(None)):
    conditions = []; values = []
    bc = bank_code or bank
    if cardholder:
        conditions.append("AND b.cardholder = %s"); values.append(cardholder)
    if bc:
        conditions.append("AND b.bank_code = %s"); values.append(bc)
    where = " ".join(conditions)
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute(f"""
            SELECT b.id, b.bank_code, COALESCE(b.bank_name, ''), b.cardholder,
                   b.account_masked, b.cycle_start, b.cycle_end, b.bill_cycle, b.bill_date
            FROM credit_card_bills b
            WHERE 1=1 {where}
            ORDER BY COALESCE(b.cycle_start, b.bill_date, '1900-01-01') DESC, b.bank_code, b.id
        """, values)

        bills = []
        for row in cur.fetchall():
            cs = row[5] or row[8] or '?'  # cycle_start → bill_date → ?
            ce = row[6] or row[8] or '?'
            label = f"{row[2] or row[1]} | {cs}~{ce} | {row[3]} | {row[4]}"
            bills.append({
                "id": row[0],
                "label": label,
                "bank_code": row[1],
                "bank_name": row[2],
                "cardholder": row[3],
                "account_masked": row[4],
                "cycle_start": row[5],
                "cycle_end": row[6],
                "bill_cycle": row[7],
                "bill_date": row[8],
            })

        # 如果没有cycle_start的bills，回退到旧版月份列表
        if not bills:
            cur.execute(f"SELECT DISTINCT b.bill_cycle FROM credit_card_bills b WHERE b.bill_cycle != '' {where} ORDER BY b.bill_cycle", values)
            cycles = [row[0] for row in cur.fetchall()]
            if not cycles:
                tx_conditions = []; tx_values = []
                if cardholder:
                    tx_conditions.append("AND t.cardholder = %s"); tx_values.append(cardholder)
                if bc:
                    tx_conditions.append("AND t.bank_code = %s"); tx_values.append(bc)
                tx_where = " ".join(tx_conditions)
                cur.execute(f"""SELECT DISTINCT to_char(t.trans_date, 'YYYY-MM') FROM credit_card_transactions t
                               WHERE 1=1 {tx_where} ORDER BY 1""", tx_values)
                cycles = [row[0] for row in cur.fetchall()]
            return {"bills": [], "cycles": cycles}

        return {"bills": bills, "cycles": []}
    finally:
        cur.close(); conn.close()

