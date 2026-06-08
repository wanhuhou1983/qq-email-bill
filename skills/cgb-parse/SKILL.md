---
name: cgb-parse
description: 解析广发银行(CGB)信用卡账单HTML文件，提取交易明细并校对。触发：广发银行、CGB、广发账单解析。注意输入是HTML文件而非EML。
---

# 广发银行账单解析

## 用法
```bash
python scripts/cgb_parse.py <html文件或目录> [output.xlsx]
```

## 结构
- **输入**: HTML 文件（非EML），目录 `fetched3/`
- **校对**: 本期消费金额(支出) + 上期还款金额(收入) vs 账单汇总表
- **汇总表**: 含运算符列（|=|-=|+=），vals[2]=上期还款 vals[3]=本期消费
- **交易**: 每个 `<table>` 一笔，起点=`交易日期`，终点=`积分类型`
- **方向**: 正数=消费，负数=还款/赠送
- **`fetched_emails/cgb.html` 不是账单，跳过**

## 数据源
- HTML: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched3\cgb*.html`
- 输出: `C:\Users\linhu\Documents\信用卡账单\CGB_*.xlsx`

## 结果: 2 文件, 78 交易, 100% PASS
