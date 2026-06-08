---
name: czb-parse
description: 浙商银行(CZB)信用卡账单解析与交易明细校验。
---

# 浙商银行账单解析器

## 用法
```bash
python scripts/czb_parse.py <文件或目录> [output.xlsx]
```

## 结构
- **输入**: HTML 文件（fetched2/fetched3 目录）
- **公式**: 上期账单金额 － 上期还款金额 + 本期新增账款 + 本期调整 + 循环利息 = 本期应还金额
- **方向**: 正数=支出，负数=还款/退款
- **特点**:
  - 兼容 UTF-8 和编码损坏文件（英文 fallback）
- QP 编码自动解码
- 预留 USD 分账户支持

## 数据源
- 文件目录见脚本内默认路径

## 结果: 2 个有效文件, 21 txns, 100% PASS
