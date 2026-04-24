import re
import pandas as pd
import os

# 读取HTML文件
html_file = os.path.join(os.path.dirname(__file__), 'latest-creditcard-bill.html')
with open(html_file, 'r', encoding='utf-8') as f:
    html = f.read()

# 提取交易记录
pattern = r'<tr[^>]*>.*?<span[^>]*>(\d{6})</span>.*?<span[^>]*>(\d{6})</span>.*?<span[^>]*>(\d{4}|[^<]+)</span>.*?<span[^>]*>([^<]+)</span>.*?<span[^>]*>([0-9.,/CNY]+)</span>.*?<span[^>]*>([0-9.,/CNY-]+)</span>.*?</tr>'
matches = re.findall(pattern, html, re.DOTALL)

data = []
for m in matches:
    trans_date = m[0]
    post_date = m[1]
    card_no = m[2]
    desc = m[3]
    amount = m[4]
    settle = m[5]
    
    if '还款' in desc or '还款金' in desc:
        continue  # 跳过还款
    
    if not settle.startswith('-'):
        continue  # 跳过其他
    
    data.append({
        '交易日期': trans_date,
        '入账日期': post_date,
        '卡号后四位': card_no,
        '交易描述': desc,
        '交易金额': amount.replace('/CNY', ''),
        '入账金额': settle.replace('/CNY', '')
    })

df = pd.DataFrame(data)

# 转换日期格式 yyyy/mm/dd
df['交易日期'] = pd.to_datetime(df['交易日期'], format='%y%m%d').dt.strftime('%Y/%m/%d')
df['入账日期'] = pd.to_datetime(df['入账日期'], format='%y%m%d').dt.strftime('%Y/%m/%d')

# 按交易日期排序（从先到后）
df = df.sort_values('交易日期')

print(f'消费记录数: {len(df)}')
print(df.head())

# 输出到桌面或指定位置
output_path = os.path.join(os.path.expanduser('~'), 'Desktop', '农业银行信用卡消费明细.xlsx')
df.to_excel(output_path, index=False)
print(f'\n已保存到: {output_path}')
