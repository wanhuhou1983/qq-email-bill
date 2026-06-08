---
name: ceb-parse
description: 解析光大银行(CEB)信用卡账单EML文件，提取交易明细并校对。触发：光大银行、CEB、光大账单解析。注意分期交易的特殊处理。
---

# 光大银行账单解析

## 用法
```bash
python scripts/ceb_parse.py <eml文件或目录> [output.xlsx]
```

## 结构
- **输入**: EML 文件，目录 `fetched_ceb_eml/`
- **校对**: 上期欠款 + 非旧分期支出 - 非旧分期存入 = 本期欠款 Closing Balance
- **交易起点**: `交易日` 表头行
- **交易终点**: `本期欠款 Closing Balance` 或 `本期存款 Closing Balance`
- **方向**: 正数=支出，`(存入)amount`=收入
- **分期处理**: 排除含"分期"AND"本期应还"的旧分期还款；保留新消费分期和手续费
- **空金额列**: 保留空单元格，避免描述中金额被误提取
- **多卡共享**: 所有卡共享一个账户，一个汇总表

## 数据源
- EML 目录: `C:\Users\linhu\WorkBuddy\2026-05-12-task-10\qq-email-bill\fetched_ceb_eml`
- 输出: `C:\Users\linhu\Documents\信用卡账单\CEB_*.xlsx`

## 结果: 59 文件, 3,460 交易, 100% PASS
