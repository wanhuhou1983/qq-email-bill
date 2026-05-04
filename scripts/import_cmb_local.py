"""
招商银行信用卡账单导入脚本（本地PDF）
来源: 坚果云"招商银行信用卡账单"文件夹
格式: 文本PDF，pdfplumber直接提取
金额: 负=还款(REPAY), 正=消费(SPEND) - 符号已正确
"""
import os, re
import pdfplumber
import psycopg2

FOLDER = r'E:\我的坚果云\每月资金流水\信用卡账单\招商银行信用卡账单'
DB_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres"
BANK_CODE = "CMB"
BANK_NAME = "招商银行"
CARDHOLDER = "吴华辉"


def main():
    conn = psycopg2.connect(DB_URI)
    cur = conn.cursor()
    files = sorted(f for f in os.listdir(FOLDER) if f.lower().endswith('.pdf'))
    total_tx, total_bills = 0, 0

    for fname in files:
        path = os.path.join(FOLDER, fname)
        with pdfplumber.open(path) as doc:
            full_text = ''.join(page.extract_text() or '' for page in doc.pages) + "\n"

        ym = re.search(r'(\d{4})年(\d{2})月', full_text[:200])
        if not ym: continue
        bill_year, bill_month = int(ym.group(1)), int(ym.group(2))

        m_bill = re.search(r'账单日.*?(\d{4})年(\d{2})月(\d{2})日', full_text[:500], re.DOTALL)
        bill_date = f'{m_bill.group(1)}-{m_bill.group(2)}-{m_bill.group(3)}' if m_bill else None
        m_due = re.search(r'到期还款日.*?(\d{4})年(\d{2})月(\d{2})日', full_text[:500], re.DOTALL)
        due_date = f'{m_due.group(1)}-{m_due.group(2)}-{m_due.group(3)}' if m_due else None

        s = full_text.find('本期账务明细')
        if s < 0: s = full_text.find('Transaction Details')
        if s < 0: continue
        e = full_text.find('本期还款总额', s)
        if e < 0: e = full_text.find('Current Balance', s)
        detail = full_text[s:e]

        txns = []
        for line in detail.split("\n"):
            line = line.strip()
            if not line or len(line.split()) <= 2: continue
            parts = line.split()
            if not re.match(r'^\d{2}/\d{2}$', parts[0]): continue
            # 卡号必须是4位数字（过滤PDF分页粘合导致的异常行）
            card_last4 = parts[-2]
            if not re.match(r'^\d{4}$', card_last4): continue

            trans_m, trans_d = int(parts[0][:2]), int(parts[0][3:])
            has_post = len(parts) >= 6 and re.match(r'^\d{2}/\d{2}$', parts[1])
            if has_post:
                post_m, post_d = int(parts[1][:2]), int(parts[1][3:])
                desc = ' '.join(parts[2:-3])
            else:
                post_m, post_d = trans_m, trans_d
                desc = ' '.join(parts[1:-3])
            if not desc: continue
            try:
                amount = float(parts[-3].replace(',', ''))
            except:
                continue
            if abs(amount) < 0.001: continue

            def _y(m):
                return bill_year - 1 if m > bill_month + 1 else bill_year

            txns.append((f'{_y(trans_m):04d}-{trans_m:02d}-{trans_d:02d}',
                         f'{_y(post_m):04d}-{post_m:02d}-{post_d:02d}',
                         desc[:200], amount, card_last4))

        if not txns: continue
        cs = min(t[0] for t in txns)
        ce = max(t[0] for t in txns)

        cur.execute("""INSERT INTO credit_card_bills
            (bank_code,bank_name,cardholder,bill_date,due_date,cycle_start,cycle_end,bill_cycle,account_masked)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW()
            RETURNING id""",
            (BANK_CODE, BANK_NAME, CARDHOLDER, bill_date, due_date,
             cs, ce, bill_date[:7] if bill_date else None, '****8022'))
        bid = cur.fetchone()[0]

        for t in txns:
            cur.execute("""INSERT INTO credit_card_transactions
                (bill_id,bank_code,cardholder,card_last4,account_masked,
                 trans_date,post_date,description,amount,currency,trans_type,source)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'file')""",
                (bid, BANK_CODE, CARDHOLDER, t[4], '****' + t[4],
                 t[0], t[1], t[2], t[3], 'CNY', 'REPAY' if t[3] < 0 else 'SPEND'))

        total_tx += len(txns)
        total_bills += 1
        print(f'{bill_date or "?":>10s} | {len(txns):>3} txns')
        conn.commit()

    print(f"\n{'='*40}")
    print(f"Done: {total_bills} bills, {total_tx} txns")
    cur.execute("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code='CMB'")
    print(f"PG: {cur.fetchone()[0]}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
