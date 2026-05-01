# 长期记忆

## 信用卡账单系统（12家银行）
- 7家有自动化Skill: ABC农行/BOCOM交行/CCB建行/CGB广发/CITIC中信/CMB招行/ICBC工行
- 4家手动脚本: PAB平安/CEB光大/CMBC民生/BOC中行(PDF+MinerU解析)
- PG入库方案已设计(2张表: credit_card_bills + credit_card_transactions)，详见 pg_schema_design.md
- 统一符号规则: 消费=正(+), 还款/存入/退款=负(-)
- ⚠️农行符号相反(消费记负), 入库时需取反; 光大(存入)前缀需转负数
- description字段保持银行原文不修改; 新增cardholder持卡人字段(非全部是吴华辉)
- 中行特殊: PDF附件(octet-stream类型), 存入/支出分两列都正, 需转换
- QQ邮箱IMAP走代理，连接不稳定易超时

## Web 查询系统（2026-05-01）
- FastAPI 后端端口 8765，前端 index.html
- 条件筛选：持卡人、银行、金额区间、日期区间、类别、账期、交易类型
- AI 查询：自然语言 → DeepSeek → SQL
- 账期搜索字段：cycle_start/cycle_end（关联 credit_card_bills 表子查询）

## 浙商银行导入要点（2026-05-01）
- QQ邮箱文件夹：`其他文件夹/浙商银行`
- QP 解码正确方式：`Buffer.from(latin1, 'binary').toString('utf-8')`（不能直接用 String.fromCharCode）
- 日期格式：`YYYYMMDD`（8位无分隔符）
- 金额含 ¥ 符号，负号可能在前
- 4封邮件 → 85条交易，已直接入库 PG（不经过 Excel）
