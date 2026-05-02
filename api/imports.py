"""
导入路由: QQ邮箱刷新 / XLS文件上传
"""
import os, re, json, subprocess, tempfile
from fastapi import APIRouter, UploadFile, File
import pandas as pd

from db import get_conn

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.getenv("NODE_BIN", "node")
LOADER_JS = os.path.join(_HERE, "bank-loader", "loader.js")

router = APIRouter(tags=["import"])

@router.post("/refresh-qq")
async def refresh_qq():
    """从QQ邮箱拉取最新账单"""
    banks = ["abc","boc","bocom","ccb","ceb","cgb","citic","cmb","cmbc","czb","icbc","pab"]
    total = 0; count = 0; errors = []

    for code in banks:
        r = subprocess.run([NODE, LOADER_JS, code], capture_output=True, text=True, encoding="utf-8", errors="replace")
        for line in (r.stdout + r.stderr).split("\n"):
            m = re.search(r"新增 (\d+) 条", line)
            if m: total += int(m.group(1))
        if "新增" in r.stdout + r.stderr:
            count += 1
        elif r.returncode != 0:
            errors.append(code)

    return {"inserted": total, "banks": count, "errors": errors}

@router.post("/import-xls")
async def import_xls(file: UploadFile = File(...)):
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
            except Exception as e:
                return {"error": f"解析失败: {e}", "inserted": 0}

        transactions = []
        parse_errors = []
        for i in range(1, len(df)):
            try:
                row = df.iloc[i]
                td = str(int(row[0])); pd_ = str(int(row[1]))
                desc = str(row[2])[:200]
                card = str(int(row[3])); amt = float(row[6])
                if len(td) == 8 and len(pd_) == 8:
                    transactions.append({
                        "trans_date": f"{td[:4]}-{td[4:6]}-{td[6:8]}",
                        "post_date": f"{pd_[:4]}-{pd_[4:6]}-{pd_[6:8]}",
                        "description": desc, "amount": amt, "card_last4": card,
                        "cardholder": os.getenv("DEFAULT_CARDHOLDER", "吴华辉"),
                    })
                else:
                    parse_errors.append(f"行{i}: 日期格式 {td}/{pd_}")
            except Exception as e:
                parse_errors.append(f"行{i}: {e}")

        if not transactions:
            return {"error": f"无有效交易 ({len(parse_errors)}行失败)", "inserted": 0, "errors": parse_errors[:10]}

        conn = get_conn(); cur = conn.cursor()
        try:
            bc = transactions[0]["trans_date"][:7]
            cur.execute("""INSERT INTO credit_card_bills (bank_code,bank_name,cardholder,bill_date,bill_cycle,cycle_start,cycle_end,account_masked)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW() RETURNING id""",
                ("SPDB","浦发银行",transactions[0]["cardholder"],transactions[-1]["post_date"],bc,
                 transactions[0]["trans_date"],transactions[-1]["trans_date"],"****"+transactions[0]["card_last4"]))
            bill_id = cur.fetchone()[0]
            inserted = 0
            for t in transactions:
                try:
                    cur.execute("""INSERT INTO credit_card_transactions (bill_id,bank_code,cardholder,card_last4,account_masked,
                        trans_date,post_date,description,amount,currency,trans_type,source,raw_line_text)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'upload',%s) ON CONFLICT DO NOTHING""",
                        (bill_id,"SPDB",t["cardholder"],t["card_last4"],"****"+t["card_last4"],
                         t["trans_date"],t["post_date"],t["description"],t["amount"],"CNY",
                         "SPEND" if t["amount"] > 0 else "REPAY", f'{t["trans_date"]}|{t["amount"]}|{t["description"]}'))
                    if cur.rowcount > 0: inserted += 1
                except Exception as e:
                    parse_errors.append(f"入库: {t['trans_date']} {e}")
            conn.commit()
            return {"inserted": inserted, "total": len(transactions), "errors": parse_errors[:10],
                    "filename": file.filename, "bill_cycle": bc}
        finally:
            cur.close(); conn.close()
    finally:
        os.unlink(tmp.name)
