"""导入所有京东交易CSV文件，按订单号去重"""
import csv, re, psycopg2
from datetime import datetime

def parse_amt(s):
    s = s.strip()
    m = re.match(r'(-?[\d,]+\.?\d*)', s)
    return float(m.group(1).replace(',', '')) if m else 0.0

def parse_payment(method):
    bank = ''; last4 = ''
    m = re.match(r'(.+?)[\uff08(](\d{4})[\uff09)]', method)
    if m:
        bank = m.group(1)
        for sfx in ['信用卡', '借记卡', '储蓄卡']:
            bank = bank.replace(sfx, '')
        last4 = m.group(2)
    return bank, last4

conn = psycopg2.connect('host=localhost port=5432 user=postgres password=DB_PASSWORD dbname=postgres')
cur = conn.cursor()

# 获取已存在订单号
cur.execute('SELECT order_id FROM jd_transactions WHERE order_id IS NOT NULL AND order_id != \'\'')
existing = set(r[0] for r in cur.fetchall())
print(f'已有 {len(existing)} 条记录')

files = [
    'jd_transactions.csv', 'jd_439.csv', 'jd_519.csv', 'jd_283.csv',
    'jd_976.csv', 'jd_541.csv', 'jd_651.csv', 'jd_697.csv', 'jd_194.csv',
]

total_new = 0; total_dup = 0; total_files = 0
for fn in files:
    with open(fn, encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        lines = list(reader)
    
    header_idx = next(i for i,l in enumerate(lines) if l and l[0] == '交易时间')
    file_new = 0
    for row in lines[header_idx+1:]:
        if not row or len(row) < 6: continue
        try:
            ts = datetime.strptime(row[0].strip(), '%Y-%m-%d %H:%M:%S')
        except:
            continue
        oid = row[8].strip() if len(row) > 8 else ''
        if oid and oid in existing:
            total_dup += 1
            continue
        
        if oid: existing.add(oid)
        amt = parse_amt(row[3])
        bank, last4 = parse_payment(row[4].strip())
        
        cur.execute('''INSERT INTO jd_transactions
            (trans_time, merchant_name, description, amount, payment_method, status,
             income_expense, category, order_id, merchant_order_id, remark,
             bank_name, card_last4)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (ts, row[1].strip() if len(row)>1 else '',
             row[2].strip() if len(row)>2 else '', amt,
             row[4].strip(), row[5].strip() if len(row)>5 else '',
             row[6].strip() if len(row)>6 else '',
             row[7].strip() if len(row)>7 else '',
             oid, row[9].strip() if len(row)>9 else '',
             row[10].strip() if len(row)>10 else '', bank, last4))
        file_new += 1
        total_new += 1
    
    print(f'{fn}: +{file_new}')
    total_files += 1

conn.commit()
print(f'\n合计: +{total_new} 新, {total_dup} 重复, 共 {total_files} 个文件')

cur.execute('SELECT COUNT(*) FROM jd_transactions')
print(f'jd_transactions 总数: {cur.fetchone()[0]}')
cur.execute('''SELECT income_expense, COUNT(*), ROUND(SUM(amount)::numeric,2)
    FROM jd_transactions GROUP BY income_expense''')
for r in cur.fetchall():
    print(f'  {r[0]}: {r[1]}条 ¥{r[2]}')

cur.close()
conn.close()
