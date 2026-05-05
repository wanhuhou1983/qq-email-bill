"""
元数据查询路由: banks / categories / cardholders / cards / currencies / stats
"""
from typing import Optional
from fastapi import APIRouter, Query
from db import get_conn

router = APIRouter(tags=["meta"])

@router.get("/banks")
def get_banks():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT bank_code, cardholder, COUNT(*) as cnt FROM credit_card_transactions GROUP BY bank_code, cardholder ORDER BY bank_code, cardholder")
        return [{"bank_code": r[0], "cardholder": r[1], "count": r[2]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/categories")
def get_categories():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT category FROM credit_card_transactions WHERE category IS NOT NULL AND category != '' ORDER BY category")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/cardholders")
def get_cardholders():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT cardholder FROM credit_card_transactions WHERE cardholder IS NOT NULL AND cardholder != '' ORDER BY cardholder")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/cards")
def get_cards(bank_code: Optional[str] = Query(None), cardholder: Optional[str] = Query(None)):
    conn = get_conn(); cur = conn.cursor()
    try:
        sql = "SELECT bank_code, cardholder, card_last4, COUNT(*) as cnt FROM credit_card_transactions"
        vals = []
        conds = []
        if bank_code:
            conds.append("bank_code = %s"); vals.append(bank_code)
        if cardholder:
            conds.append("cardholder = %s"); vals.append(cardholder)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " GROUP BY bank_code, cardholder, card_last4 ORDER BY bank_code, cardholder, card_last4"
        cur.execute(sql, vals)
        return [{"bank_code": r[0], "cardholder": r[1], "card_last4": r[2], "count": r[3]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/currencies")
def get_currencies():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT currency FROM credit_card_transactions WHERE currency IS NOT NULL AND currency != '' ORDER BY currency")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/stats")
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


@router.get("/debit/account-names")
def get_debit_account_names():
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT account_name FROM debit_card_transactions WHERE account_name IS NOT NULL AND account_name != '' ORDER BY account_name")
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


@router.get("/debit/account-last4s")
def get_debit_account_last4s(bank_code: Optional[str] = Query(None)):
    conn = get_conn(); cur = conn.cursor()
    try:
        sql = "SELECT DISTINCT RIGHT(account_number, 4) FROM debit_card_transactions"
        vals = []
        if bank_code:
            sql += " WHERE bank_code = %s"; vals.append(bank_code)
        sql += " ORDER BY 1"
        cur.execute(sql, vals)
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


@router.get("/card-info")
def get_card_info(
    account_type: Optional[str] = Query(None),
    cardholder: Optional[str] = Query(None),
    bank_code: Optional[str] = Query(None),
    card_class: Optional[str] = Query(None),
):
    conn = get_conn(); cur = conn.cursor()
    try:
        sql = """SELECT id, account_type, bank_code, bank_name, cardholder, card_number,
                 card_last4, card_category, fee_desc, credit_limit,
                 card_class, location, linked_card FROM card_info"""
        conds = []
        vals = []
        if account_type:
            conds.append("account_type = %s"); vals.append(account_type)
        if cardholder:
            conds.append("cardholder ILIKE %s"); vals.append(f"%{cardholder}%")
        if bank_code:
            conds.append("(bank_code ILIKE %s OR bank_name ILIKE %s)"); vals.append(f"%{bank_code}%"); vals.append(f"%{bank_code}%")
        if card_class:
            conds.append("card_class = %s"); vals.append(card_class)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY account_type, bank_code, id"
        cur.execute(sql, vals)
        return [{"id": r[0], "account_type": r[1], "bank_code": r[2], "bank_name": r[3],
                 "cardholder": r[4], "card_number": r[5], "card_last4": r[6],
                 "card_category": r[7], "fee_desc": r[8], "credit_limit": r[9],
                 "card_class": r[10], "location": r[11], "linked_card": r[12]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()
