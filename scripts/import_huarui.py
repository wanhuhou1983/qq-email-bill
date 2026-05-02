"""
华瑞银行 借记卡对账单导入脚本 v2
直接从 full.md 文本中提取交易行，不依赖 HTML 表格结构
"""
import os, re, html
import psycopg2
from dotenv import load_dotenv

load_dotenv()

MD_PATH = r"C:\Users\linhu\MinerU\f55b5213-910f-44d9-908e-c9065f4f52c9_origin.pdf-5ef74ea7-31fe-4733-af65-08ea0e087072\full.md"
BANK_CODE = "HRB"
ACCOUNT_NUMBER = "6236222299130362647"
ACCOUNT_NAME = "吴华辉"

conn = psycopg2.connect(
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", 5432)),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME", "postgres"),
)
cur = conn.cursor()

def parse_amt(s):
    """安全的金额解析"""
    s = s.strip().replace(",", "").replace(" ", "")
    if re.match(r"^-?\d+(\.\d+)?$", s):
        return float(s)
    return 0.0

def clean_text(s):
    """清理 HTML 和空白"""
    s = html.unescape(s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", "").replace("\xa0", "")
    return s.strip()

with open(MD_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# 提取所有 <tr> 行
rows_data = []
seen = set()

for tr_match in re.finditer(r"<tr>(.*?)</tr>", content, re.DOTALL | re.IGNORECASE):
    tr_html = tr_match.group(1)
    tds = re.findall(r"<td>(.*?)</td>", tr_html, re.DOTALL | re.IGNORECASE)
    if len(tds) < 7:
        continue
    tds = [clean_text(td) for td in tds]

    date_raw = tds[0]
    if not re.match(r"^\d{8}$", date_raw):
        continue

    # 列结构: 交易日期|交易行|凭证号|摘要|借方|贷方|余额|备注|对手账号|对手名称|交易时间|参考号|对手银行|对方银行
    desc = tds[3] if len(tds) > 3 else ""
    debit_raw = tds[4] if len(tds) > 4 else ""
    credit_raw = tds[5] if len(tds) > 5 else ""
    balance_raw = tds[6] if len(tds) > 6 else ""
    remark = tds[7] if len(tds) > 7 else ""
    cp_account = tds[8] if len(tds) > 8 else ""
    cp_name = tds[9] if len(tds) > 9 else ""
    time_raw = tds[10] if len(tds) > 10 else ""
    cp_bank = tds[12] if len(tds) > 12 else ""

    # 金额解析
    debit = parse_amt(debit_raw)
    credit = parse_amt(credit_raw)
    balance = parse_amt(balance_raw)

    # 跳过无摘要也无金额的行
    if not desc and debit == 0 and credit == 0:
        continue

    # 跳过金额异常大的（可能是列错位混入了账号）
    if abs(debit) > 1e8 or abs(credit) > 1e8 or abs(balance) > 1e8:
        continue

    # 统一金额
    if debit > 0:
        amount = -debit
    elif credit > 0:
        amount = credit
    else:
        amount = 0.0

    # 交易时间
    trans_time = None
    time_parts = time_raw.strip().split()
    for p in time_parts:
        if re.match(r"\d{2}:\d{2}:\d{2}", p):
            trans_time = p
            break

    # 日期
    trans_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:8]}"

    # 去重 key
    dedup_key = (trans_date, desc[:80], amount, cp_name[:40])
    if dedup_key in seen:
        continue
    seen.add(dedup_key)

    rows_data.append({
        "trans_date": trans_date,
        "description": desc[:500] or "(无摘要)",
        "debit": debit,
        "credit": credit,
        "balance": balance,
        "amount": amount,
        "remark": remark[:200],
        "counterparty_account": cp_account[:50],
        "counterparty_name": cp_name[:100],
        "counterparty_bank": cp_bank[:100],
        "trans_time": trans_time,
    })

print(f"解析到 {len(rows_data)} 条去重交易")

# === 清空旧数据 ===
cur.execute("TRUNCATE debit_card_transactions;")
conn.commit()

# === 入库（使用 autocommit 避免单行失败回滚全部）===
conn.autocommit = True
cur = conn.cursor()

inserted = 0
skipped = 0
errors = 0

for row in rows_data:
    try:
        cur.execute("""
            INSERT INTO debit_card_transactions
                (bank_code, account_number, account_name,
                 trans_date, description, debit, credit, balance, amount,
                 remark, counterparty_name, counterparty_account, counterparty_bank,
                 trans_time, source, raw_line_text)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (account_number, trans_date, amount, description, counterparty_name)
            DO NOTHING
        """, (
            BANK_CODE, ACCOUNT_NUMBER, ACCOUNT_NAME,
            row["trans_date"], row["description"], row["debit"], row["credit"],
            row["balance"], row["amount"], row["remark"],
            row["counterparty_name"], row["counterparty_account"],
            row["counterparty_bank"], row["trans_time"],
            "mineru_hrb",
            f'{row["trans_date"]}|{row["amount"]}|{row["description"]}',
        ))
        if cur.rowcount > 0:
            inserted += 1
        else:
            skipped += 1
    except Exception as e:
        errors += 1
        if errors <= 3:
            print(f"  ⚠ {row['trans_date']} {row['description'][:30]}: {e}")

cur.close()
conn.close()

print(f"入库完成: 新增 {inserted}, 跳过 {skipped}, 错误 {errors}")
