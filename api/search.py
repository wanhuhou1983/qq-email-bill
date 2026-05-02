"""
搜索/筛选 + AI查询 路由
"""
import os, re
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from openai import OpenAI

from db import get_conn, get_reader_conn
from api.models import SearchResult
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
            SELECT t.id, t.bank_code, COALESCE(b.bank_name, '') as bank_name,
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
- 只能查询单表，不允许 JOIN、WITH、多语句、注释
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
        cur.execute(f"""SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                               COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                        FROM ({sql}) AS sub""")
        sum_spend, sum_repay = cur.fetchone()
        sum_spend = float(sum_spend); sum_repay = float(sum_repay)

        cur.execute(f"SELECT COUNT(*) FROM ({sql}) AS sub")
        total = cur.fetchone()[0]

        cur.execute(f"SELECT * FROM ({sql}) AS sub LIMIT {size} OFFSET {offset}")
        if cur.description is None:
            raise HTTPException(status_code=400, detail="AI SQL 无法返回结果")
        cols = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
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

