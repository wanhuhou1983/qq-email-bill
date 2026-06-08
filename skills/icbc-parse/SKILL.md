---
name: icbc-parse
description: 解析工商银行(ICBC)信用卡账单EML文件，提取交易明细并校对。触发：工商银行、ICBC、工行账单解析、信用卡账单提取。
---

# 工商银行账单解析

## 用法
```bash
python scripts/icbc_parse.py <eml文件或目录> [output.xlsx]
```

## 结构
- **输入**: EML 文件（GBK 编码），目录 `fetched_icbc_eml/`
- **校对**: 本期收入 + 本期支出 vs 账单汇总表
- **章节标记**: `---主卡明细---` / `---副卡明细---`
- **方向关键词**: `存入`=收入, `支出`=费用, `退款`=退款
- **卡号**: 从章节标题提取（如 `6296`）

## 数据源
- EML 目录: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched_icbc_eml`
- 输出: `C:\Users\linhu\Documents\信用卡账单\ICBC_*.xlsx`

## 结果: 50 文件, 2,880+ 交易, 100% PASS
