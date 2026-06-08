---
name: ccb-parse
description: 解析建设银行(CCB)信用卡账单EML文件，提取交易明细并校对。触发：建设银行、CCB、建行账单解析。
---

# 建设银行账单解析

## 用法
```bash
python scripts/ccb_parse.py <eml文件或目录> [output.xlsx]
```

## 结构
- **输入**: EML 文件，目录 `fetched_ccb_eml/`
- **校对**: 消费/取现/其它费用(支出) + 还款/退货/费用返还(收入) vs 账单汇总表
- **交易表识别**: 首行含 `【交易明细】`
- **方向**: 正数=费用，负数=收入（与ABC方向相反）
- **交易行**: TDate PDate CardNo Desc CNY Amount CNY Amount (8单元格)

## 数据源
- EML 目录: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched_ccb_eml`
- 输出: `C:\Users\linhu\Documents\信用卡账单\CCB_*.xlsx`

## 结果: 70 文件, 1,497 交易, 100% PASS
