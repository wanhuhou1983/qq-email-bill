---
name: citic-parse
description: 中信银行(CITIC)信用卡账单解析与交易明细校验。
---

# 中信银行账单解析器

## 用法
```bash
python scripts/citic_parse.py <文件或目录> [output.xlsx]
```

## 结构
- **输入**: HTML 文件（fetched2/fetched3/fetched_emails 目录）
- **公式**: 上期应还款额 - 上期已还款额 + 本期新增金额 = 账户账单金额
- **方向**: 正数=消费，负数=还款/入账，日期 YYYYMMDD
- **特点**:
  - 支持 QP 编码自动解码
- 兼容中文乱码版本（英文 fallback）
- 交易行在嵌套 <table> 外的 <tr> 中
- 汇总值在 <table> 外的非表格区域

## 数据源
- 文件目录见脚本内默认路径

## 结果: 3 个文件(同一期), 9 txns, 100% PASS
