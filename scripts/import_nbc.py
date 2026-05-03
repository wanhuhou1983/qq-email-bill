"""
宁波银行信用卡账单导入脚本
来源: MinerU OCR输出的Markdown文件（含HTML表格）
格式: 交易日期 | 记账日期 | 交易描述 | 交易金额 | 交易卡号
金额: 正=消费, 负=还款（符号已正确）
"""
import os, re, json
from datetime import datetime
from bs4 import BeautifulSoup
import psycopg2

OCR_DIR = r"C:\Users\linhu\Desktop\宁波\ocr_output"
DB_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres"

BANK_CODE = "NBC"
BANK_NAME = "宁波银行"

def parse_md_file(md_path):
    """解析一个MinerU输出的Markdown文件"""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 提取所有HTML表格
    soup = BeautifulSoup(content, "html.parser")
    tables = soup.find_all("table")

    if len(tables) < 2:
        return None

    # 表1: 账单头信息 - 找包含"账单日"的行
    header_rows = tables[0].find_all("tr")
    bill_info = {}
    for row in header_rows:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        text = "|".join(cells)
        # 找账单日行
        if "账单日" in text or "到期还款日" in text:
            # 取紧随其后的行(含实际数值)
            if len(cells) >= 8 and re.match(r"^\d{8}$", cells[0]):
                bill_info["bill_date"] = cells[0]
                bill_info["due_date"] = cells[1]
                bill_info["statement_balance"] = cells[5]
                bill_info["min_payment"] = cells[6]
                break
    # 如果上面没找到，检查第一行是否就是日期行
    if "bill_date" not in bill_info and header_rows:
        first_cells = [td.get_text(strip=True) for td in header_rows[0].find_all("td")]
        if len(first_cells) >= 8:
            for c in first_cells:
                if re.match(r"^\d{8}$", c):
                    bill_info["bill_date"] = first_cells[0]
                    bill_info["due_date"] = first_cells[1]
                    bill_info["statement_balance"] = first_cells[5]
                    bill_info["min_payment"] = first_cells[6]
                    break

    # 表2: 交易明细
    tx_rows = tables[1].find_all("tr")
    transactions = []
    for row in tx_rows[1:]:  # 跳过表头
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 5:
            continue

        trans_date = cells[0]
        post_date = cells[1]
        description = cells[2][:200]
        amount_str = cells[3].replace(",", "").strip()
        card_raw = cells[4]

        # 验证日期
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", trans_date):
            continue
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", post_date):
            continue

        # 金额
        try:
            amount = float(amount_str)
        except ValueError:
            continue
        if abs(amount) < 0.001:
            continue

        # 卡号末4位
        card_match = re.search(r"(\d{4})$", card_raw)
        card_last4 = card_match.group(1) if card_match else "7108"

        # 交易类型
        desc_lower = description.lower()
        if "还款" in desc_lower:
            trans_type = "REPAY"
        elif amount < 0:
            trans_type = "REPAY"
        elif "退款" in desc_lower or "退货" in desc_lower:
            trans_type = "REFUND"
        else:
            trans_type = "SPEND"

        transactions.append({
            "trans_date": trans_date,
            "post_date": post_date,
            "description": description,
            "amount": amount,
            "card_last4": card_last4,
            "trans_type": trans_type,
        })

    # 账单周期
    if transactions:
        cycle_start = min(t["trans_date"] for t in transactions)
        cycle_end = max(t["trans_date"] for t in transactions)
    else:
        cycle_start = cycle_end = None

    bill_date = bill_info.get("bill_date", "")
    if bill_date and len(bill_date) == 8:
        bill_date_fmt = f"{bill_date[:4]}-{bill_date[4:6]}-{bill_date[6:8]}"
    else:
        bill_date_fmt = cycle_end

    due_date = bill_info.get("due_date", "")
    if due_date and len(due_date) == 8:
        due_date_fmt = f"{due_date[:4]}-{due_date[4:6]}-{due_date[6:8]}"
    else:
        due_date_fmt = None

    bill_cycle = bill_date_fmt[:7] if bill_date_fmt else None

    return {
        "billInfo": {
            "billDate": bill_date_fmt,
            "dueDate": due_date_fmt,
            "billCycle": bill_cycle,
            "cycleStart": cycle_start,
            "cycleEnd": cycle_end,
            "cardLast4": transactions[0]["card_last4"] if transactions else "7108",
            "cardholder": "吴华辉",
            "statementBalance": bill_info.get("statement_balance"),
            "minPayment": bill_info.get("min_payment"),
        },
        "transactions": transactions,
    }


def main():
    conn = psycopg2.connect(DB_URI)
    cur = conn.cursor()

    # 遍历所有MD文件
    md_files = sorted(
        [os.path.join(OCR_DIR, d, f) for d in os.listdir(OCR_DIR)
         for f in os.listdir(os.path.join(OCR_DIR, d)) if f.endswith(".md")],
        key=lambda x: os.path.basename(os.path.dirname(x))
    )

    total_tx = 0
    total_bills = 0

    for md_path in md_files:
        name = os.path.basename(os.path.dirname(md_path))
        print(f"\n=== {name} ===")

        result = parse_md_file(md_path)
        if not result or not result["transactions"]:
            print(f"  ⚠ 无有效交易")
            continue

        bill = result["billInfo"]
        txns = result["transactions"]
        print(f"  账期: {bill['billCycle']} | {len(txns)} 条交易")
        print(f"  卡号: ****{bill['cardLast4']} | 持卡人: {bill['cardholder']}")

        # 插入账单头
        cur.execute("""
            INSERT INTO credit_card_bills
                (bank_code, bank_name, cardholder, bill_date, due_date,
                 cycle_start, cycle_end, bill_cycle, account_masked,
                 statement_balance, min_payment)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (bank_code, bill_date, account_masked) DO UPDATE
                SET updated_at=NOW()
            RETURNING id
        """, (
            BANK_CODE, BANK_NAME, bill["cardholder"],
            bill["billDate"], bill["dueDate"],
            bill["cycleStart"], bill["cycleEnd"], bill["billCycle"],
            f"****{bill['cardLast4']}",
            bill["statementBalance"], bill["minPayment"],
        ))
        bill_id = cur.fetchone()[0]
        print(f"  账单ID: {bill_id}")

        # 插入交易
        inserted = 0
        for i, t in enumerate(txns):
            try:
                cur.execute("""
                    INSERT INTO credit_card_transactions
                        (bill_id, bank_code, cardholder, card_last4, account_masked,
                         trans_date, post_date, description, amount, currency,
                         trans_type, source, raw_line_text)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'file',%s)
                    ON CONFLICT ON CONSTRAINT uq_txn DO NOTHING
                """, (
                    bill_id, BANK_CODE, bill["cardholder"], t["card_last4"],
                    f"****{t['card_last4']}",
                    t["trans_date"], t["post_date"], t["description"],
                    t["amount"], "CNY", t["trans_type"],
                    f"{t['trans_date']}|{t['amount']}|{t['description']}|{i}",
                ))
                if cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                print(f"  ⚠ 入库失败: {t['trans_date']} {e}")

        total_tx += inserted
        total_bills += 1
        print(f"  ✅ 新增 {inserted} 条")
        conn.commit()

    print(f"\n{'='*40}")
    print(f"✅ 完成！共导入 {total_bills} 个账单, {total_tx} 条交易")

    # 验证
    cur.execute("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code='NBC'")
    print(f"📊 PG 宁波银行共 {cur.fetchone()[0]} 条交易")
    cur.execute("SELECT COUNT(*) FROM credit_card_bills WHERE bank_code='NBC'")
    print(f"📊 PG 宁波银行共 {cur.fetchone()[0]} 个账单")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
