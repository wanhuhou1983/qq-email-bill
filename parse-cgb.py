from bs4 import BeautifulSoup
import re
import pandas as pd
import os

html_file = os.path.join(os.path.dirname(__file__), 'latest-cgb-bill.html')
with open(html_file, 'r', encoding='utf-8') as f:
    html = f.read()

soup = BeautifulSoup(html, 'html.parser')
text = soup.get_text()

# 找到交易明细部分
idx = text.find('交易日期')
section = text[idx:]

# 提取交易行
pattern = r'(\d{4}/\d{2}/\d{2})\s+(\d{4}/\d{2}/\d{2})\s+\(([^)]+)\)\s*([^0-9]+?)\s*([0-9,.]+)\s+人民币'
matches = re.findall(pattern, section)

data = []
for m in matches:
    trans_date = m[0]
    post_date = m[1]
    trans_type = m[2]  # 消费/还款/退款/赠送
    desc = m[3].strip()
    amount = m[4].replace(',', '')
    
    # 跳过非消费类型 (退款、还款、赠送)
    if trans_type != '消费':
        continue
    
    # 跳过负数金额
    if float(amount) <= 0:
        continue
    
    data.append({
        '交易日期': trans_date,
        '入账日期': post_date,
        '交易描述': desc,
        '交易金额': amount,
    })

df = pd.DataFrame(data)

# 转换日期格式 yyyymmdd
df['交易日期'] = pd.to_datetime(df['交易日期']).dt.strftime('%Y%m%d')
df['入账日期'] = pd.to_datetime(df['入账日期']).dt.strftime('%Y%m%d')

# 按交易日期排序
df = df.sort_values('交易日期')

print(f'消费记录数: {len(df)}')
print(df.head(10))

# 保存到桌面
output_path = os.path.join(os.path.expanduser('~'), 'Desktop', '广发银行信用卡消费明细.xlsx')
df.to_excel(output_path, index=False)
print(f'\n已保存到: {output_path}')
