"""
导入路由: QQ邮箱刷新 / XLS文件上传
"""
import os, re, subprocess, tempfile
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from db import get_conn

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.getenv("NODE_BIN", "node")
LOADER_JS = os.path.join(_HERE, "bank-loader", "loader.js")
DEFAULT_CARDHOLDER = os.getenv("DEFAULT_CARDHOLDER", "")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "10"))
REFRESH_TIMEOUT_SEC = int(os.getenv("REFRESH_TIMEOUT_SEC", "120"))

router = APIRouter(tags=["import"])


@router.post("/refresh-qq")
async def refresh_qq():
    """从QQ邮箱拉取最新账单"""
    banks = ["abc","boc","bocom","ccb","ceb","cgb","citic","cmb","cmbc","czb","icbc","pab"]
    total = 0; count = 0; errors = []

    if not Path(LOADER_JS).exists():
        raise HTTPException(status_code=500, detail=f"未找到 loader.js: {LOADER_JS}")

    for code in banks:
        try:
            r = subprocess.run([NODE, LOADER_JS, code],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=REFRESH_TIMEOUT_SEC)
            output = (r.stdout or "") + "\n" + (r.stderr or "")
            for line in output.splitlines():
                m = re.search(r"新增\s+(\d+)\s+条", line)
                if m: total += int(m.group(1))
            if "新增" in output:
                count += 1
            elif r.returncode != 0:
                errors.append({"bank": code, "error": f"exit={r.returncode}"})
        except subprocess.TimeoutExpired:
            errors.append({"bank": code, "error": "timeout"})
        except Exception as e:
            errors.append({"bank": code, "error": str(e)})

    return {"inserted": total, "banks": count, "errors": errors}


def normalize_card_last4(raw) -> str:
    text = str(raw).strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits[-4:] if len(digits) >= 4 else digits


@router.post("/import-xls")
async def import_xls(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".xls"):
        raise HTTPException(status_code=400, detail="仅支持 .xls 文件")

    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"文件过大，限制 {MAX_UPLOAD_MB}MB")

    tmp = tempfile.NamedTemporaryFile(suffix=".xls", delete=False)
    try:
        tmp.write(content); tmp.close()

        try:
            df = pd.read_excel(tmp.name, header=None, engine="xlrd")
        except Exception:
            try:
                df = pd.read_excel(tmp.name, header=None, engine="openpyxl")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"解析失败: {e}")

        transactions = []
        parse_errors = []

        for i in range(1, len(df)):
            try:
                row = df.iloc[i]
                td = str(int(row[0])); pd_ = str(int(row[1]))
                desc = str(row[2]).strip()[:200]
                card_last4 = normalize_card_last4(row[3])
                amt = float(row[6])

                if len(td) != 8 or len(pd_) != 8:
                    parse_errors.append(f"行{i}: 日期格式 {td}/{pd_}")
                    continue
                if not card_last4:
                    parse_errors.append(f"行{i}: 卡号为空")
                    continue

                transactions.append({
                    "trans_date": f"{td[:4]}-{td[4:6]}-{td[6:8]}",
                    "post_date": f"{pd_[:4]}-{pd_[4:6]}-{pd_[6:8]}",
                    "description": desc, "amount": amt, "card_last4": card_last4,
                    "cardholder": DEFAULT_CARDHOLDER,
                })
            except Exception as e:
                parse_errors.append(f"行{i}: {e}")

        if not transactions:
            raise HTTPException(status_code=400,
                detail=f"无有效交易 ({len(parse_errors)}行失败), errors: {parse_errors[:10]}")

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
                    "filename": filename, "bill_cycle": bc}
        finally:
            cur.close(); conn.close()
    finally:
        os.unlink(tmp.name)
