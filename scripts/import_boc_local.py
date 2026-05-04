"""
中国银行信用卡账单导入脚本（本地PDF）
来源: 坚果云文件夹"中国银行信用卡账单"
格式: 文本PDF，pdfplumber直接提取
交易表: 交易日 | 记账日 | 卡号后4 | 描述 | 存入(正) | 支出(正)
规则: 存入→负(REPAY), 支出→正(SPEND)
"""
import os, re
import pdfplumber
import psycopg2

FOLDER = r'E:\我的坚果云\每月资金流水\信用卡账单\中国银行信用卡账单'
DB_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres"
BANK_CODE = "BOC"
BANK_NAME = "中国银行"


def parse_pdf(path):
    """解析一个中行PDF账单"""
    with pdfplumber.open(path) as doc:
        # 获取header信息（第1页表1）
        page1 = doc.pages[0]
        tables1 = page1.extract_tables()
        
        bill_info = {"billDate": None, "dueDate": None, "statementBalance": None}
        if tables1:
            for row in tables1[0]:
                cells = [c.strip() if c else "" for c in row]
                text = "|".join(cells)
                if "202" in text and "-" in text:
                    for c in cells:
                        if re.match(r"^\d{4}-\d{2}-\d{2}$", c):
                            if not bill_info["dueDate"]:
                                bill_info["dueDate"] = c
                            elif not bill_info["billDate"]:
                                bill_info["billDate"] = c
                        # 数字金额
                        m = re.match(r"^[\d,]+\.\d{2}$", c)
                        if m and bill_info["statementBalance"] is None:
                            bill_info["statementBalance"] = c

        # 提取交易明细（第2页的表1，即交易明细表）
        transactions = []
        for page in doc.pages[1:]:
            tables = page.extract_tables()
            if not tables:
                continue
            for tbl in tables:
                for row in tbl[1:]:  # 跳过表头
                    if not row or len(row) < 6:
                        continue
                    cells = [c.strip() if c else "" for c in row]
                    trans_date, post_date, card_raw, desc, deposit, expend = cells[:6]

                    # 验证日期
                    if not re.match(r"^\d{4}-\d{2}-\d{2}$", trans_date):
                        continue
                    if not re.match(r"^\d{4}-\d{2}-\d{2}$", post_date):
                        continue

                    # 卡号后4位
                    card_last4 = card_raw.strip()
                    if len(card_last4) > 4:
                        card_last4 = card_last4[-4:]

                    # 金额: 支出=正(消费), 存入=负(还款)
                    amount = 0.0
                    trans_type = None
                    if expend:
                        try:
                            amount = float(expend.replace(",", ""))
                            trans_type = "SPEND"
                        except ValueError:
                            pass
                    if deposit and amount == 0:
                        try:
                            amount = -float(deposit.replace(",", ""))
                            trans_type = "REPAY"
                        except ValueError:
                            pass

                    if amount == 0:
                        continue

                    description = desc[:200]

                    transactions.append({
                        "trans_date": trans_date,
                        "post_date": post_date,
                        "description": description,
                        "amount": amount,
                        "card_last4": card_last4,
                        "trans_type": trans_type,
                    })

    # 账期信息
    if transactions:
        cycle_start = min(t["trans_date"] for t in transactions)
        cycle_end = max(t["trans_date"] for t in transactions)
    else:
        cycle_start = cycle_end = None

    bill_date = bill_info["billDate"] or cycle_end
    bill_cycle = bill_date[:7] if bill_date else None

    # 清理金额中的逗号
    sb = bill_info.get("statementBalance")
    if sb:
        sb = sb.replace(",", "")

    return {
        "billInfo": {
            "billDate": bill_date,
            "dueDate": bill_info["dueDate"],
            "billCycle": bill_cycle,
            "cycleStart": cycle_start,
            "cycleEnd": cycle_end,
            "cardLast4": transactions[0]["card_last4"] if transactions else "0177",
            "cardholder": "吴华辉",
            "statementBalance": sb,
        },
        "transactions": transactions,
    }


def main():
    conn = psycopg2.connect(DB_URI)
    cur = conn.cursor()

    files = sorted(os.listdir(FOLDER))
    total_tx = 0
    total_bills = 0

    for fname in files:
        if not fname.endswith(".PDF") and not fname.endswith(".pdf"):
            continue
        path = os.path.join(FOLDER, fname)
        name = fname.replace("中国银行信用卡电子合并账单", "").replace("月账单.PDF", "").replace(".PDF", "")

        print(f"\n=== {name} ===")

        try:
            result = parse_pdf(path)
        except Exception as e:
            print(f"  ⚠ 解析失败: {e}")
            continue

        if not result or not result["transactions"]:
            print(f"  ⚠ 无有效交易")
            continue

        bill = result["billInfo"]
        txns = result["transactions"]
        bill_cycle_str = bill["billCycle"] or "?"
        print(f"  账期: {bill_cycle_str} | {len(txns)} 条交易")
        print(f"  卡号: ****{bill['cardLast4']} | 持卡人: {bill['cardholder']}")

        # 插入账单头
        cur.execute("""
            INSERT INTO credit_card_bills
                (bank_code, bank_name, cardholder, bill_date, due_date,
                 cycle_start, cycle_end, bill_cycle, account_masked,
                 statement_balance)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (bank_code, bill_date, account_masked) DO UPDATE
                SET updated_at=NOW()
            RETURNING id
        """, (
            BANK_CODE, BANK_NAME, bill["cardholder"],
            bill["billDate"], bill["dueDate"],
            bill["cycleStart"], bill["cycleEnd"], bill["billCycle"],
            f"****{bill['cardLast4']}",
            bill["statementBalance"],
        ))
        bill_id = cur.fetchone()[0]

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

    cur.execute("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code='BOC'")
    print(f"📊 PG 中行共 {cur.fetchone()[0]} 条交易")
    cur.execute("SELECT COUNT(*) FROM credit_card_bills WHERE bank_code='BOC'")
    print(f"📊 PG 中行共 {cur.fetchone()[0]} 个账单")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
