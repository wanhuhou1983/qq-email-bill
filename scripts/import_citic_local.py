"""
中信银行信用卡账单导入脚本（本地PDF，1年=1PDF，含全年12期）
来源: 坚果云"中信银行信用卡账单"文件夹
格式: 文本PDF，YYYYMMDD日期，金额符号已正确
持卡人: 吴华辉(1696) + 吴大军(5710)
"""
import os, re
import pdfplumber
import psycopg2

FOLDER = r'E:\我的坚果云\每月资金流水\信用卡账单\中信银行信用卡账单'
DB_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres"
BANK_CODE = "CITIC"
BANK_NAME = "中信银行"


def parse_pdf(path):
    """解析一个年度PDF，返回多期账单数据"""
    with pdfplumber.open(path) as doc:
        pages_text = [(p.page_number, p.extract_text() or "") for p in doc.pages]

    periods = []
    current = None  # {bill_date, due_date, cardholders: {card: {cardholder}}, txns: []}

    for pg_num, text in pages_text:
        lines = text.split("\n")

        # 检测新一期账单开头
        bill_date_match = re.search(r"账单日\s*(\d{4}-\d{2}-\d{2})", text)
        due_date_match = re.search(r"到期还款日\s*(\d{4}-\d{2}-\d{2})", text)

        if bill_date_match:
            # 上一期结束，保存
            if current and current["txns"]:
                periods.append(current)

            bill_date = bill_date_match.group(1)
            due_date = due_date_match.group(1) if due_date_match else None
            current = {
                "bill_date": bill_date,
                "due_date": due_date,
                "txns": [],
                "cur_cardholder": "吴华辉",  # 默认主卡
            }
            continue

        if current is None:
            continue

        # 检测附属卡切换
        for line in lines:
            if "附属卡" in line and ("吴大军" in line or "5710" in line):
                current["cur_cardholder"] = "吴大军"
                break
            if "主卡" in line and ("吴华辉" in line or "1696" in line):
                current["cur_cardholder"] = "吴华辉"
                break

        # 找交易行: YYYYMMDD YYYYMMDD last4 desc currency +/-amount currency +/-amount
        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 跳过非交易行
            parts = line.split()
            if len(parts) < 7:
                continue

            # 前两段必须是8位数字日期
            if not re.match(r"^\d{8}$", parts[0]):
                continue
            if not re.match(r"^\d{8}$", parts[1]):
                continue

            # 第三段=卡号后4位
            card_last4 = parts[2]
            if not re.match(r"^\d{4}$", card_last4):
                continue

            # 解析金额: 交易货币/金额 + 记账货币/金额
            # 格式: ... CNY +/-amount CNY +/-amount
            # 从右往左: 最后一段=记账金额, 倒数第三段=交易金额
            setl_amt_str = parts[-1]
            trx_amt_str = parts[-3]

            try:
                amount = float(setl_amt_str.replace(",", ""))
            except ValueError:
                continue

            if abs(amount) < 0.001:
                continue

            # 描述 = 中间段(去掉日期2段 + 卡号1段 + 交易货币1段 + 交易金额1段 + 记账货币1段 + 记账金额1段)
            desc = " ".join(parts[3:-3]).strip()[:200]

            # 日期
            trans_date = f"{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:8]}"
            post_date = f"{parts[1][:4]}-{parts[1][4:6]}-{parts[1][6:8]}"

            # 确定持卡人
            cardholder = current["cur_cardholder"]
            # 卡号映射
            card_map = {"1696": "吴华辉", "5710": "吴大军"}
            if card_last4 in card_map:
                cardholder = card_map[card_last4]

            tx_type = "REPAY" if amount < 0 else "SPEND"

            current["txns"].append({
                "trans_date": trans_date,
                "post_date": post_date,
                "description": desc,
                "amount": amount,
                "card_last4": card_last4,
                "cardholder": cardholder,
                "trans_type": tx_type,
            })

    # 最后一期
    if current and current["txns"]:
        periods.append(current)

    return periods


def main():
    conn = psycopg2.connect(DB_URI)
    cur = conn.cursor()

    # 清旧数据
    cur.execute("DELETE FROM credit_card_transactions WHERE bank_code='CITIC'")
    cur.execute("DELETE FROM credit_card_bills WHERE bank_code='CITIC'")
    conn.commit()

    files = sorted(f for f in os.listdir(FOLDER) if f.lower().endswith('.pdf'))
    total_tx, total_periods = 0, 0

    for fname in files:
        path = os.path.join(FOLDER, fname)
        year = re.search(r"(\d{4})", fname)
        year_str = year.group(1) if year else "?"
        print(f"\n=== {year_str} ===")

        try:
            periods = parse_pdf(path)
        except Exception as e:
            print(f"  FAIL: {e}")
            import traceback; traceback.print_exc()
            continue

        print(f"  {len(periods)} periods found")
        for p in periods:
            # 区分两个持卡人的交易
            txns_wu = [t for t in p["txns"] if t["cardholder"] == "吴华辉"]
            txns_dajun = [t for t in p["txns"] if t["cardholder"] == "吴大军"]

            periods_to_insert = []

            if txns_wu:
                periods_to_insert.append(("吴华辉", txns_wu))
            if txns_dajun:
                periods_to_insert.append(("吴大军", txns_dajun))

            for holder, txns in periods_to_insert:
                cs = min(t["trans_date"] for t in txns)
                ce = max(t["trans_date"] for t in txns)

                cur.execute("""INSERT INTO credit_card_bills
                    (bank_code,bank_name,cardholder,bill_date,due_date,cycle_start,cycle_end,bill_cycle,account_masked)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW()
                    RETURNING id""",
                    (BANK_CODE, BANK_NAME, holder, p["bill_date"], p["due_date"],
                     cs, ce, p["bill_date"][:7],
                     f"****{txns[0]['card_last4']}"))
                bill_id = cur.fetchone()[0]

                for t in txns:
                    cur.execute("""INSERT INTO credit_card_transactions
                        (bill_id,bank_code,cardholder,card_last4,account_masked,
                         trans_date,post_date,description,amount,currency,trans_type,source)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'file')""",
                        (bill_id, BANK_CODE, t["cardholder"], t["card_last4"],
                         f"****{t['card_last4']}", t["trans_date"], t["post_date"],
                         t["description"], t["amount"], "CNY", t["trans_type"]))

                total_tx += len(txns)
                total_periods += 1
                print(f"  {p['bill_date']} {holder:6s} {cs}~{ce} | {len(txns):>3} txns")

            conn.commit()

    print(f"\n{'='*40}")
    print(f"Done: {total_periods} periods, {total_tx} txns")

    # 按持卡人统计
    cur.execute("SELECT cardholder, COUNT(*) FROM credit_card_transactions WHERE bank_code='CITIC' GROUP BY cardholder")
    for r in cur.fetchall():
        print(f"  {r[0]}: {r[1]}条")
    cur.execute("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code='CITIC'")
    print(f"Total CITIC: {cur.fetchone()[0]} txns")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
