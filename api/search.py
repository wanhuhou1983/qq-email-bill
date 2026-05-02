"""
搜索/筛选 + AI查询 路由
"""
import os, re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Query
from openai import OpenAI

from db import get_conn, get_reader_conn
from api.models import SearchResult
from api.utils import row_to_dict, build_where_clause

router = APIRouter(tags=["search"])

client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY", "sk-jtiawbivdncqlenhubffbktndozwmgqrwgvxcyfuiqspghjr"),
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)

@router.get("/search", response_model=SearchResult)
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
        """, values + [size, page])
        cols = [desc[0] for desc in cur.description]
        return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay,
                            transactions=[row_to_dict(r, cols) for r in cur.fetchall()])
    finally:
        cur.close(); conn.close()

@router.get("/ai-search", response_model=SearchResult)
def ai_search(
    q: str = Query(..., description="自然语言查询"),
    page: int = Query(0, ge=0),
    size: int = Query(20, ge=1, le=200),
):
    conn = get_reader_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'credit_card_transactions' ORDER BY ordinal_position")
        schema = "\n".join([f"  {c[0]}: {c[1]}" for c in cur.fetchall()])
    finally:
        cur.close(); conn.close()

    prompt = f"""你是一个 PostgreSQL 查询生成器。根据用户的自然语言查询，生成 SQL 查询。

表名: credit_card_transactions
列结构:
{schema}

规则:
- amount > 0 消费/支出, amount < 0 还款/存入/退款
- trans_type: SPEND/REPAY/REFUND/DEPOSIT/INSTALLMENT_PRIN/INSTALLMENT_INT/FEE/CASH_ADVANCE/ADJUST/OTHER
- 自然语言"消费"→ amount > 0，"还款"→ amount < 0

只输出 SQL，不要其他内容。LIMIT 最大 500 条。只允许查询 credit_card_transactions 表。"""

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": q}],
        temperature=0,
    )
    sql = response.choices[0].message.content.strip()
    sql = re.sub(r"^```sql\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"^```\s*", "", sql).strip().rstrip(";")

    if not sql.upper().startswith("SELECT") or any(kw in sql.upper() for kw in ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "ALTER", "CREATE"]):
        return {"error": f"不允许的 SQL: {sql[:100]}"}

    conn = get_reader_conn(); cur = conn.cursor()
    try:
        cur.execute(f"""SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                               COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                        FROM ({sql}) AS sub""")
        sum_spend, sum_repay = cur.fetchone()
        sum_spend = float(sum_spend); sum_repay = float(sum_repay)

        cur.execute(f"SELECT COUNT(*) FROM ({sql}) AS sub")
        total = cur.fetchone()[0]

        cur.execute(sql + f" LIMIT {size} OFFSET {page}")
        cols = [desc[0] for desc in cur.description]
        return SearchResult(total=total, sum_spend=sum_spend, sum_repay=sum_repay,
                            transactions=[row_to_dict(r, cols) for r in cur.fetchall()])
    except Exception as e:
        return {"error": f"SQL 执行失败: {str(e)}\nSQL: {sql}"}
    finally:
        cur.close(); conn.close()
