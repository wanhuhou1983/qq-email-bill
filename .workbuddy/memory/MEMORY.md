# 长期记忆

## 信用卡账单系统（13家银行）
- bank-loader模块化框架: loader.js统一管道 + 14家parser
- 所有银行解析器在 `bank-loader/parsers/` 下
- PG入库方案: 2张表(credit_card_bills + credit_card_transactions)
- 统一符号规则: 消费=正(+), 还款/存入/退款=负(-)
- ⚠️ 农行符号相反(消费记负), 入库时需取反
- 光大(存入)前缀需转负数
- 中行: PDF附件+pdfplumber, 存入/支出分两列都正需转换
- 自动转发邮件会混入同一文件夹, CCB parser应动态识别持卡人

## Web 查询系统
- FastAPI 后端, 前端 index.html
- 条件筛选: 持卡人、银行、金额区间、日期区间、类别、账期、交易类型
- AI 查询: 自然语言→DeepSeek→SQL, 用只读数据库用户防注入
- 📥 XLS上传导入(浦发银行格式)
- 🔄 QQ邮箱刷新按钮(遍历12家银行)
- app.py已模块化拆分为api/包 (models/search/meta/export/imports)
- 数据库密码通过.env配置, 已gitignore

## 已知持卡人
- 吴华辉: 大部分银行主卡
- 赵健伟: CCB建行6258
- 钱伟琴: CCB建行
- 吴大军: CCB建行 + ICBC工行3751
- 王晓峰: CCB建行
- 冯传玉: BOCOM还款记录中出现

## 数据库现状 (2026-05-02)
13家银行, 1653条交易, 5位持卡人
数据跨度: 2024-10-18 ~ 2026-05-01
git仓库: https://github.com/wanhuhou1983/qq-email-bill.git

## 第二QQ邮箱
- hhwu1983@qq.com (授权码: uihsavyndbpscccc)
- 建行账单自动转发到主邮箱, 混在"其他文件夹/建设银行"中

## 技术要点
- QP解码: Buffer.from(latin1, 'binary').toString('utf-8')
- 日期格式多样: YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD / YYMMDD / MM/DD / MMDD
- 编码: QP/Base64 + GBK/GB18030/UTF-8
- 农行 YYMMDD + 符号取反
- 中行 PDF附件 → pdfplumber
- 浦发 本地XLS文件 → pandas+xlrd
