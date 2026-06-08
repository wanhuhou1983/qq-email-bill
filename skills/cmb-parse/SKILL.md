---
name: cmb-parse
description: 招商银行(CMB)信用卡账单解析与交易明细校验。
---

# 招商银行账单解析器

## 用法
```bash
python scripts/cmb_parse.py <文件或目录> [output.xlsx]
```

## 结构
- **输入**: PDF 文件（CreditCardReckoningYYYY-MM.pdf）
- **公式**: 本期还款总额 = 上期账单金额 - 上期还款金额 + 本期账单金额 - 本期调整金额 + 循环利息
- **方向**: 还款段：1个日期，负数；费用/消费段：2个日期，正数
- **特点**:
  - PDF 解析（pdfplumber），非 HTML
- 三段交易：还款、费用、消费（各有标记）
- 多卡：8022、1481、0696、1251
- 日期格式 MM/DD

## 数据源
- 文件目录见脚本内默认路径

## 结果: 24 个文件 (2024.05~2026.04), 507 txns, 100% PASS
