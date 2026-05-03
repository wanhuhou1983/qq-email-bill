"""
共享工具函数
"""
from decimal import Decimal
from datetime import date

BANK_NAMES = {
    "ABC": "农业银行", "BOCOM": "交通银行", "CCB": "建设银行", "CGB": "广发银行",
    "CITIC": "中信银行", "CMB": "招商银行", "ICBC": "工商银行", "PAB": "平安银行",
    "CEB": "光大银行", "CMBC": "民生银行", "CZB": "浙商银行", "BOC": "中国银行",
    "SPDB": "浦发",
}

def row_to_dict(row, cols) -> dict:
    """数据库行转字典，金额转float，日期转字符串"""
    result = {}
    for i, col in enumerate(cols):
        val = row[i]
        if isinstance(val, Decimal):
            val = float(val)
        elif isinstance(val, date):
            val = val.isoformat()
        result[col] = val
    return result

def build_where_clause(params: dict) -> tuple[str, list]:
    """参数化构建 WHERE 条件"""
    conditions = []
    values = []
    bank_code = params.get("bank_code") or params.get("bank")
    for key, col, op in [
        ("cardholder", "t.cardholder", "="),
        ("category", "t.category", "="),
        ("trans_type", "t.trans_type", "="),
        ("currency", "t.currency", "="),
        ("card_last4", "t.card_last4", "="),
    ]:
        v = params.get(key)
        if v:
            conditions.append(f"AND {col} = %s")
            values.append(v)

    for key, col, op in [
        ("bank_code", "t.bank_code", "="),
    ]:
        v = bank_code
        if v:
            conditions.append(f"AND {col} = %s")
            values.append(v)

    min_a = params.get("min_amount")
    if min_a is not None:
        conditions.append("AND ABS(t.amount) >= %s")
        values.append(min_a)

    max_a = params.get("max_amount")
    if max_a is not None:
        conditions.append("AND ABS(t.amount) <= %s")
        values.append(max_a)

    sd = params.get("start_date")
    if sd:
        conditions.append("AND t.trans_date >= %s")
        values.append(sd)

    ed = params.get("end_date")
    if ed:
        conditions.append("AND t.trans_date <= %s")
        values.append(ed)

    bc = params.get("bill_cycle")
    if bc:
        # 账期匹配: 优先bill_cycle字段, 没有则用交易日期范围(如农行无bill_cycle)
        from datetime import datetime
        try:
            y, m = int(bc[:4]), int(bc[5:7])
            start_d = f"{y:04d}-{m:02d}-01"
            if m == 12:
                end_d = f"{y+1:04d}-01-01"
            else:
                end_d = f"{y:04d}-{m+1:02d}-01"
            conditions.append("AND ((SELECT b.bill_cycle FROM credit_card_bills b WHERE b.id = t.bill_id) = %s OR (t.trans_date >= %s AND t.trans_date < %s))")
            values.extend([bc, start_d, end_d])
        except:
            conditions.append("AND (SELECT b.bill_cycle FROM credit_card_bills b WHERE b.id = t.bill_id) = %s")
            values.append(bc)

    for key, col in [("keyword", "t.description"), ("description", "t.description")]:
        v = params.get(key)
        if v:
            conditions.append(f"AND {col} ILIKE %s")
            values.append(f"%{v}%")

    return " ".join(conditions), values
