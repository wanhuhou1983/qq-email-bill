---
name: boc-parse
description: 中国银行(BOC)信用卡账单解析与交易明细校验。
---

# 中国银行账单解析器

## 用法
```bash
python scripts/boc_parse.py <文件或目录> [output.xlsx]
```

## 结构
- **输入**: PDF 文件（中国银行信用卡电子合并账单YYYY年MM月账单.PDF）
- **公式**: 上期余额 + 本期支出 - 本期存入 = 本期余额（sign-aware，存款/欠款）
- **方向**: 两列金额：存入(Deposit) + 支出(Expenditure)
- **特点**:
  - PDF 解析（pdfplumber）
- 两列金额（存入/支出分列）
- 自动识别存款/欠款状态
- 单卡 6259 0755 **** 0177
- 注意缺 2024-05 文件

## 数据源
- 文件目录见脚本内默认路径

## 结果: 30 个文件 (2023.11~2026.05), 372 txns, 29/30 PASS
