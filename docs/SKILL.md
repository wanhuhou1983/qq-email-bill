---
name: abc-creditcard-bill
description: 农业银行信用卡账单解析 - 从QQ邮箱"农业银行"文件夹获取最新信用卡电子对账单，提取消费明细并生成Excel
description_zh: 解析农业银行信用卡账单，生成消费明细Excel
version: 1.0.0
allowed-tools: Read,Write,Bash
---

# 农业银行信用卡账单解析

从 QQ 邮箱"农业银行"文件夹获取最新信用卡电子对账单，提取消费明细并生成 Excel 文件。

## 凭证（环境变量）

| 变量 | 说明 |
|------|------|
| **QQ_EMAIL_ACCOUNT** | QQ 邮箱账号 |
| **QQ_EMAIL_AUTH_CODE** | QQ 邮箱授权码 |

## 使用方法

```bash
# 确保已设置环境变量
$env:QQ_EMAIL_ACCOUNT = "your@qq.com"
$env:QQ_EMAIL_AUTH_CODE = "your-auth-code"

# 运行脚本
node scripts/get-abchina-creditcard.js
python parse-transactions.py
```

## 输出

- 消费记录（排除还款）
- 日期格式：yyyy/mm/dd
- 金额单位：删除 /CNY 后缀
- 按交易日期从先到后排序
- 保存位置：桌面 `农业银行信用卡消费明细.xlsx`

## 前置要求

1. QQ 邮箱开启 IMAP 服务
2. 在 QQ 邮箱网页版设置中勾选"收到'我的文件夹'"
3. "农业银行"文件夹中已有信用卡账单邮件
