---
name: cmbc-parse
description: 解析民生银行(CMBC)信用卡账单HTML文件，提取交易明细并校对。触发：民生银行、CMBC、民生账单解析。注意RMB/USD分账户独立计算。
---

# 民生银行账单解析

## 用法
```bash
python scripts/cmbc_parse.py <html文件或目录> [output.xlsx]
```

## 结构
- **输入**: HTML 文件，目录 `fetched_cmbc_all/`
- **校对**: 上期账单金额 - 本期已还金额 + 本期账单金额 + 本期调整 + 循环利息 = 本期应还款金额
- **每笔交易 = 3 个 `<table>`**: (date+desc | amount | cardno)
- **单元格解析**: 用 `parse_cells()` 将 `<td>` 用 `|` 连接
- **方向**: 正数=支出，负数=收入/退款
- **RMB/USD 分账户**: 多个 `交易日` 标记=多个币种区域，各自独立汇总校对
- **两格式**: 老格式(label+en+value三元组) / 新格式(all labels then all values)

## 数据源
- HTML: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched_cmbc_all`
- 输出: `C:\Users\linhu\Documents\信用卡账单\CMBC_*.xlsx`

## 结果: 6 文件, 81 交易, 100% PASS
