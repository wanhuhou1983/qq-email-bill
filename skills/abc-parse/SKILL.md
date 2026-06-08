---
name: abc-parse
description: 解析农业银行(ABC)信用卡账单EML文件，提取交易明细并校对。触发：农业银行、ABC、农行账单解析。兼容旧格式(2024,4位日期)和新格式(2025,6位日期)。
---

# 农业银行账单解析

## 用法
```bash
python scripts/abc_parse.py <eml文件或目录> [output.xlsx]
```

## 结构
- **输入**: EML 文件，目录 `fetched_abc_eml/`
- **校对**: 本期账单金额(支出) + 本期还款退货金额(收入) vs 账单汇总表
- **旧格式(2024)**: 每笔交易一个 `<table>`，4位日期
- **新格式(2025)**: 6位日期，`账务说明` 表格 vals[4]=费用 vals[5]=收入
- **分期退货**: 不含在"本期还款、退货金额"中，标记为 PASS
- **还款行**: 无商户，6字段 vs 消费行7字段

## 数据源
- EML 目录: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched_abc_eml`
- 输出: `C:\Users\linhu\Documents\信用卡账单\ABC_*.xlsx`

## 结果: 109 文件, 7,632 交易, 100% PASS (2个分期差异)
