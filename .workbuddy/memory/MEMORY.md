# 长期记忆

## 信用卡账单系统（14家银行）
- bank-loader模块化框架: loader.js统一管道 + parser
- PG入库方案: 2张表(credit_card_bills + credit_card_transactions)
- 统一符号规则: 消费=正(+), 还款/存入/退款=负(-)
- ⚠️ 农行符号相反(消费记负), 入库时需取反
- 光大(存入)前缀需转负数
- 中行: PDF附件+pdfplumber, 存入/支出分两列都正需转换

## 数据来源分三类
1. **QQ邮箱 IMAP**: BOC/CCB/CEB/CGB/CITIC/CMB/CMBC/CZB/ICBC/PAB (9家)
2. **坚果云本地PDF**: 中行/招行/中信/宁波银行 (替换了旧IMAP数据)
3. **坚果云本地XLS**: 浦发SPDB (2022-01~2026-04, 52个月, 1394条)

## 数据库现状 (2026-05-04)
14家银行, 8701条交易(信用卡), 252个账单
数据跨度: 2022-01 ~ 2026-04
加上借记卡 debit_card_transactions: 1953条
git仓库: https://github.com/wanhuhou1983/qq-email-bill.git

### 各银行数据量
- NBC: 2248条 | CITIC: 2262条 | SPDB: 1394条
- ICBC: 373条 | ABC: 510条 | BOC: 489条 | CMB: 489条
- CCB: 262条 | BOCOM: 159条 | CGB: 181条
- CEB: 94条 | CMBC: 91条 | CZB: 111条 | PAB: 38条

## Web 查询系统
- FastAPI 后端 http://localhost:8765
- 条件筛选: 持卡人、银行、金额、日期、类别、账期、交易类型
- AI 查询: 自然语言→DeepSeek→SQL
- app.py模块化: api/包 (models/search/meta/export/imports)
- 数据库密码通过.env配置

## 卡片信息表 card_info
- 信用卡20张 + 借记卡41张 = 61张卡
- 字段: account_type/bank_code/bank_name/cardholder/card_number/card_last4/card_category/credit_limit/fee_desc/card_class/location/linked_card
- 信用卡: 含VISA/JCB/运通/京东卡/无界卡/白金卡/沃尔玛卡类型识别
- 借记卡: 含一类卡/二类卡分类+归属地+绑定关系

## 前端
- 3标签页(升级到4): 信用卡交易查询 | 借记卡交易查询 | 卡片管理
- 新增: 电商交易查询（第4个标签）
- 借记卡查询: 姓名/银行/尾号/日期/关键词筛选
- 卡片管理: 全部卡展示+筛选（姓名/银行/类型/卡种，卡种仅在选借记卡时显示）
- debitBankName函数覆盖30+银行名称映射
- 日历: 信用卡用比例柱状图、借记卡用位数数字填充柱
- 翻页器统一居中对齐，支持首页/末页/页号跳转
- 日历弹出当日明细

## 电商交易表 jd_transactions
- 2558条（京东2017-2025年）
- 字段含platform/phone，方便未来接入微信/支付宝/抖音
- AI查询支持

## ⚠️ 禁止操作
- 禁止使用 `taskkill -f -fi "PID ne 0"`（杀全部进程）
- 改index.html后重启uvicorn即可, 不需要杀所有进程

## 技术要点
- QP解码: Buffer.from(latin1, 'binary').toString('utf-8')
- 日期格式多样: YYYY-MM-DD / YYYYMMDD / MM/DD
- 编码: QP/Base64 + GBK/GB18030/UTF-8
- 中行/招行/中信本地PDF: pdfplumber直接提取文本
- 浦发XLS: xlrd解析
- HRB银行: BIN前缀匹配填充对方银行(474条)
