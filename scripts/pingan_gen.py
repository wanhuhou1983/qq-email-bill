import pandas as pd
from datetime import datetime
import os
import sys

# Windows GBK fix
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

data = [
    ['0662', '2026-04-06', '2026-04-07', '支付宝-上海拉扎斯信息科技有限公司', 10.94],
    ['0662', '2026-04-09', '2026-04-09', '财付通-山姆餐吧', 19.50],
    ['3355', '2026-03-17', '2026-03-18', '银联转账（云闪付）', -2.00],
    ['3355', '2026-04-05', '2026-04-05', '抖音支付-广州安怡信息服务有限公司', 5.50]
]

df = pd.DataFrame(data, columns=['卡号后四位', '交易日', '记账日', '交易描述', '入账金额'])
df['交易类型'] = df['入账金额'].apply(lambda x: '消费' if x > 0 else ('还款/退款' if x < 0 else '其他'))
df = df[['交易类型', '交易日', '记账日', '卡号后四位', '交易描述', '入账金额']]
df = df.sort_values('交易日').reset_index(drop=True)

output = os.path.join(os.path.expanduser('~'), 'Desktop', '平安银行信用卡消费明细.xlsx')

spending = df[df['入账金额'] > 0]
repayments = df[df['入账金额'] < 0]

print(f'共 {len(df)} 条记录')
print(f'消费 {len(spending)} 笔 ¥{spending["入账金额"].sum():,.2f}')
print(f'还款/退款 {len(repayments)} 笔 ¥{abs(repayments["入账金额"].sum()):,.2f}')

info = {
    '银行': '平安银行',
    '账单周期': '2026年3月-4月',
    '导出时间': datetime.now().strftime('%Y-%m-%d %H:%M'),
    '总笔数': len(df),
    '消费总额': spending['入账金额'].sum(),
    '还款/退款总额': abs(repayments['入账金额'].sum()) if len(repayments) > 0 else 0
}

with pd.ExcelWriter(output, engine='openpyxl') as w:
    df.to_excel(w, sheet_name='交易明细', index=False)
    pd.DataFrame([info]).to_excel(w, sheet_name='账单摘要', index=False)

    card_sum = df.groupby('卡号后四位').agg(
        消费笔数=('入账金额', lambda x: (x > 0).sum()),
        消费金额=('入账金额', lambda x: x[x > 0].sum()),
        还款退款笔数=('入账金额', lambda x: (x < 0).sum()),
        还款退款金额=('入账金额', lambda x: abs(x[x < 0].sum()))
    ).reset_index()
    card_sum.to_excel(w, sheet_name='按卡汇总', index=False)

print(f'\n已保存: {output}')
