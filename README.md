# 账单查询系统 (qq-email-bill)

一站式管理信用卡账单、借记卡流水、证券交易记录、电商交易流水。
FastAPI + PostgreSQL 后端，纯前端单页HTML。

---

## 一、系统架构

```
app.py              — FastAPI入口，挂载各router
├── api/            — API路由模块
│   ├── search.py   — 查询/AI搜索/证券/电商/日历API
│   ├── models.py   — Pydantic数据模型
│   ├── meta.py     — 元数据API（银行列表、账期等）
│   ├── export.py   — 导出Excel API
│   └── imports.py  — 账单导入API（浦发XLS等）
├── db.py           — 数据库连接
├── index.html      — 前端单页面（5个标签页）
├── bank-loader/    — 邮箱账单抓取+解析Node.js模块
└── scripts/        — 数据导入脚本
```

---

## 二、前端标签页(5个)

| 序号 | 标签名 | 说明 |
|:---:|:-------|:-----|
| 1 | 信用卡交易查询 | 多条件筛选+AI查询+日历视图 |
| 2 | 借记卡交易查询 | 多条件筛选+AI查询+日历视图 |
| 3 | 电商交易查询 | 京东/微信/支付宝/抖音, AI查询 |
| 4 | 证券交易查询 | 银河证券拖拉机关户 |
| 5 | 卡片管理 | 全部卡片信息(61张) |

### 所有翻页器统一风格
- 居中对齐
- «首页 / ‹上一页 / 第X/Y页 / 下一页› / 末页»
- 跳转 [输入框] 页

### 日历视图
- **信用卡日历**: 10格比例柱状图(红色支出+绿色收入)
- **借记卡日历**: 10格固定位置+位数数字填充
  - 上排5格=支出(红色系,从深到浅左→右:百万→百元)
  - 下排5格=收入(绿色系,从深到浅左→右:百万→百元)
  - 每格按数字填充(如3百万→左1格30%)
- **点击日历弹出当日交易明细**,点击外部关闭

---

## 三、数据库表结构

### credit_card_transactions (信用卡交易, ~8701条)
| 字段 | 类型 | 说明 |
|:----|:----|:------|
| id | SERIAL PK | |
| bank_code | VARCHAR(20) | 银行代码 |
| bank_name | VARCHAR(50) | 银行名称 |
| trans_date | DATE | 交易日期 |
| description | TEXT | 交易摘要 |
| amount | NUMERIC(12,2) | 金额(正=消费,负=还款/存入/退款) |
| trans_type | VARCHAR(30) | SPEND/REPAY/REFUND/DEPOSIT/... |
| card_last4 | VARCHAR(4) | 卡号尾4位 |
| cardholder | VARCHAR(20) | 持卡人 |
| bill_cycle | VARCHAR(20) | 账期 |
| bill_id | INT FK | 关联账单 |

### debit_card_transactions (借记卡交易, ~1953条)
| 字段 | 说明 |
|:----|:------|
| bank_code | 银行代码 |
| amount | 金额(正=收入,负=支出) |
| debit | 支出金额(正数) |
| credit | 收入金额(正数) |
| description | 交易摘要 |
| counterparty_name | 交易对手 |
| counterparty_bank | 对方银行 |

### card_info (卡片信息, 61张)
| 字段 | 说明 |
|:----|:------|
| account_type | credit/debit |
| bank_code/bank_name | 银行 |
| card_number | 完整卡号(加密) |
| card_last4 | 尾号 |
| cardholder | 持卡人 |
| card_category | 卡种(白金/VISA/JCB/运通等) |
| credit_limit | 信用额度 |
| card_class | 卡等级 |
| location | 归属地 |
| linked_card | 绑定银行卡 |

### jd_transactions (电商交易, 2558条)
| 字段 | 说明 |
|:----|:------|
| trans_time | 交易时间 |
| merchant_name | 商户名称 |
| description | 商品说明 |
| amount | 金额 |
| payment_method | 支付方式(含银行+尾号) |
| status | 交易状态 |
| income_expense | 收入/支出/不计收支 |
| category | 交易分类 |
| bank_name | 解析出的银行名 |
| card_last4 | 解析出的卡尾号 |
| **platform** | 平台(京东/微信/支付宝/抖音) |
| **phone** | 手机号(区分多账号) |

---

## 四、证券交易系统 (核心)

### 4.1 表结构: stock_transactions

| 字段 | 对应交割单列 | 说明 |
|:----|:-----------|:-----|
| stock_code | 证券代码 | 基金/股票代码 |
| stock_name | 证券名称 | |
| operation | 业务类型 | 开放基金申购/证券卖出/上证LOF申购/股份转入等 |
| quantity | 成交数量 | LOF申购时为份额(2025早期)或NAV(2026后期) |
| avg_price | 成交均价 | |
| trade_amount | 成交金额 | 数量×价格(含手续费) |
| stock_balance | 证券数量 | **关键字段: 成交后剩余份额** |
| settle_amount | 发生金额 | 正=收入,负=支出 |
| fee | 手续费/佣金 | |
| stamp_tax | 印花税 | |
| cash_balance | 资金余额 | |
| contract_id | 合同编号 | **去重依据** |
| shareholder_account | 股东帐户 | **持仓计算关键** |
| settle_date | 交收日期 | |
| transfer_fee | 过户费(上交所) | |
| clearing_fee | 清算费(上交所B股) | |
| currency | 币种 | |
| full_name | 证券中文全称 | |
| cardholder | - | 持卡人(从Excel sheet名或文件夹解析) |
| account_number | - | 账户号(26270002xxxx) |
| platform | - | 默认'银河证券' |

### 4.2 拖拉机账户

一个人有**多个股东账户**并行操作。以吴华辉为例：

| 交易所 | 股东账户格式 | 数量 | 用途 |
|:-----|:----------|:---:|:----|
| 深交所 | `0xxxxxxxxx` (10位,含前导0) | **6个** | LOF基金场内申购+卖出 |
| 上交所A股 | `Axxxxxxxx` | 1个 | 股票交易 |
| 上交所基金 | `Fxxxxxxxx` | 1~3个 | 上交所LOF基金申购 |

**⚠️ 前导0坑（已踩过）：**
- 深圳股东账户正确格式：**10位带前导0**（如 `0105015768`）
- Excel导出的交割单：**9位无前导0**（如 `105015768`）
- TXT交割单正确：10位带前导0
- 导入时必须统一：`UPDATE SET shareholder_account = '0' || shareholder_account WHERE LENGTH=9 AND ISDIGIT`
- **已修复**：吴华辉592条 + 汪丽清756条 + 吴大军712条

### 4.3 深交所 vs 上交所差异

| 项目 | 深交所(16xxxx) | 上交所(50xxxx/51xxxx) |
|:----|:-------------|:-------------------|
| 申购记录 | **一笔** `开放基金申购`(扣钱+到账合一) | **两笔** `上证LOF申购`(扣钱) + `股份转入`(到账) |
| 卖出记录 | `证券卖出` | `证券卖出` |
| 股票代码 | 16开头 | 50/51开头 |
| 股东账户 | 0xxxxxxx(深圳) | Axxxxxxxx(股票) / Fxxxxxxx(基金) |
| 交收规则 | T+1~T+2 | T+2 |

### 4.4 T+N 交收规则

| 品种 | 代码 | 场内申购可卖 | 场外申购可卖 |
|:----|:---:|:----------:|:----------:|
| 白银基金 | 161226 | **T+1**（次日份额到账可卖） | T+3~T+4 |
| 标普科技 | 161128 | T+2 | T+4 |
| 华宝油气 | 162411 | T+2 | T+4 |
| 标普500 | 161125 | T+2 | T+4 |
| 南方原油 | 501018(上交所) | T+2(股份转入后) | T+4 |
| 美元债 | 501300 | T+2 | T+4 |

### 4.5 套利路径（三种）

```
路径1——场内申购（深交所）:
  开放基金申购(NAV) → T+1/T+2份额到账 → 证券卖出(市价)

路径2——场外申购转场内:
  OTC资金划出(不显示标的) × 多日 → 转托管入(份额到账，显示标的)
  → 证券卖出(市价)
  
路径3——上交所LOF:
  上证LOF申购(扣钱) → 股份转入(份额到账) → 证券卖出(市价)
```

### 4.6 持仓计算算法（重要）

正确的当前持仓计算方式：

```sql
WITH per_acct AS (
    SELECT DISTINCT ON (stock_code, shareholder_account)
        stock_code, stock_name, shareholder_account, stock_balance
    FROM stock_transactions
    WHERE cardholder = '某持有人'
      AND stock_code IS NOT NULL AND stock_code != ''
      AND stock_code ~ '^[0-9]'
      AND stock_balance IS NOT NULL
    ORDER BY stock_code, shareholder_account, settle_date DESC
)
SELECT stock_code, stock_name, SUM(stock_balance) as total_holding
FROM per_acct
WHERE stock_balance > 0
GROUP BY stock_code, stock_name
HAVING SUM(stock_balance) > 0
```

**关键：先按(stock_code, shareholder_account)取每条最新balance，再汇总SUM。**
不能直接 `DISTINCT ON (stock_code)` 否则只拿到一个账户的余额。

### 4.7 当前持仓(截至2026-05-04)

| 持有人 | 华宝油气(162411) | 其他 |
|:-----|:--------------:|:----|
| 吴华辉 | 7,068份(6账户×1,178) | 无 |
| 汪丽清 | 7,068份(6账户×1,178) | 无 |
| 吴大军 | 7,068份(6账户×1,178) | 白银64份+统联精密201股 |

---

## 五、数据来源

| 类型 | 来源 | 方式 | 数量 |
|:----|:----|:----|:----:|
| 信用卡(9家) | QQ邮箱IMAP | Node.js抓取+解析 | |
| 中行/招行/中信/宁波 | 坚果云本地PDF | pdfplumber提取 | |
| 浦发 | 坚果云XLS | xlrd解析 | |
| 借记卡 | 坚果云XLS | 批量导入 | 1,953条 |
| **证券** | **坚果云XLS+TXT** | **银河证券交割单** | **10,000+条,10户** |
| 电商 | 京东CSV导出 | 批量导入 | 2,558条 |

---

## 六、已踩过的坑（重要）

1. **前导0坑**：深圳股东账户10位含前导0，Excel导入缺0
2. **拖拉机账户**：不是单账户，必须逐账户算持仓再汇总
3. **T+N错觉**：交割单显示的是交收日期，申购日比交收日早T+1~T+2天
4. **LCF vs ETF**：LOF基金有申购赎回机制，不同于ETF
5. **场内申购 vs 场外申购**：场内=开放基金申购(显示标的)，场外=OTC资金划出(不显示)+转托管入(显示)
6. **上交所两笔记账**：上证LOF申购(扣钱) + 股份转入(到账) 分开记录
7. **stock_balance字段**：不同时期含义可能不同(2025=份额, 2026部分记录=NAV)，需结合settle_amount验证
8. **taskkill -f -fi "PID ne 0" 禁止使用**：会杀掉系统所有进程(包括Chrome和WorkBuddy)
9. **PowerShell Set-Content/Add-Content 带BOM**：会破坏UTF-8文件导致中文乱码，禁止使用
10. **反引号bug**：JS中混入反引号会炸掉整个页面

---

## 七、技术踩坑记录

### 编码问题
- QQ邮箱QP解码: `Buffer.from(latin1, 'binary').toString('utf-8')`
- 银行账单编码: QP/Base64 + GBK/GB18030/UTF-8混合
- 银河证券TXT: GBK编码(非UTF-8)
- PowerShell不能写Python文件(`Add-Content`产生BOM, `Set-Content -NoNewline`破坏行尾)

### 日期格式
- `YYYY-MM-DD` / `YYYYMMDD` / `MM/DD` 混合
- Excel串行日期: `datetime(1899,12,30) + timedelta(days=int(v))`
- 整数日期(如20240730): 先用 `%Y%m%d` 解析，失败再判断是否Excel串行

### 列映射问题
- **深交所**：quantity=份额数, avg_price=NAV
- **上交所**：quantity列可能是申购金额(元)，需结合settle_amount推算实际份额
- **成交金额(trade_amount)** = quantity × avg_price + fee调整
- **发生金额(settle_amount)** = 实际资金变动(含手续费)
