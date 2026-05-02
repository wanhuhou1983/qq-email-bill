import re
import pandas as pd
import os

# 读取HTML文件
html_file = os.path.join(os.path.dirname(__file__), 'latest-ccb-bill.html')
with open(html_file, 'r', encoding='utf-8') as f:
    html = f.read()

# 简化匹配 - 找到所有交易行
# 交易日、记账日、卡号、描述、币种、金额、币种、结算金额
pattern = r'<tr[^>]*>\s*<td[^>]*>[^&]*&nbsp;(\d{4}-\d{2}-\d{2})</font></td>\s*<td[^>]*>[^&]*&nbsp;(\d{4}-\d{2}-\d{2})</font></td>\s*<td[^>]*>[^&]*&nbsp;(\d{4})</font></td>\s*<td[^>]*>[^&]*&nbsp;([^<]+)</font></td>\s*<td[^>]*>[^&]*&nbsp;CNY</font></td>\s*<td[^>]*>[^&]*&nbsp;([^<]+)</font></td>\s*<td[^>]*>[^&]*&nbsp;CNY</font></td>\s*<td[^>]*>[^&]*&nbsp;([^<]+)</font></td>\s*</tr>'

matches = re.findall(pattern, html)
print(f'找到 {len(matches)} 条交易记录')

data = []
for m in matches:
    trans_date = m[0]  # 交易日
    post_date = m[1]   # 记账日
    card_no = m[2]    # 卡号后四位
    desc = m[3].strip()  # 交易描述
    amount = m[4].strip()  # 交易金额
    settle = m[5].strip()  # 结算金额
    
    # 跳过还款/退款
    if '还款' in desc or '退款' in desc:
        continue
    
    # 处理金额 - 删除空格和逗号
    amount = amount.replace(',', '').replace(' ', '')
    settle = settle.replace(',', '').replace(' ', '')
    
    try:
        amt_val = float(amount)
        if amt_val > 0:  # 消费（正数）
            data.append({
                '交易日期': trans_date,
                '入账日期': post_date,
                '卡号后四位': card_no,
                '交易描述': desc,
                '交易金额': amount,
            })
    except:
        pass

df = pd.DataFrame(data)

# 转换日期格式 yyyymmdd
df['交易日期'] = pd.to_datetime(df['交易日期']).dt.strftime('%Y%m%d')
df['入账日期'] = pd.to_datetime(df['入账日期']).dt.strftime('%Y%m%d')

# 按交易日期排序（从先到后）
df = df.sort_values('交易日期')

print(f'消费记录数: {len(df)}')
print(df.head())

# 保存到桌面
output_path = os.path.join(os.path.expanduser('~'), 'Desktop', '建设银行信用卡消费明细.xlsx')
df.to_excel(output_path, index=False)
print(f'\n已保存到: {output_path}')
