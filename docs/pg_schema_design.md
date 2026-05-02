# 信用卡账单 PostgreSQL 统一入库方案

## 一、银行总览（11家）

| # | 银行代码 | 银行全称 | 自动化状态 | 卡数 |
|:--|:--------|:---------|:----------|:----|
| 1 | **ABC** | 农业银行 | ✅ Skill (v2.0) | 多卡 |
| 2 | **BOCOM** | 交通银行 | ✅ Skill (v2.0) | 主+副 |
| 3 | **CCB** | 建设银行 | ✅ Skill (v2.0) | 多卡 |
| 4 | **CGB** | 广发银行 | ✅ Skill | - |
| 5 | **CITIC** | 中信银行 | ✅ Skill | - |
| 6 | **CMB** | 招商银行 | ✅ Skill | - |
| 7 | **ICBC** | 工商银行 | ✅ Skill | 多卡 |
| 8 | **PAB** | 平安银行 | ❌ 手动脚本 | 2卡(0662/3355) |
| 9 | **CEB** | 光大银行 | ❌ 手动脚本 | 3卡(4365/0173/5973) |
| 10 | **CMBC** | 民生银行 | ❌ 手动脚本 | 5卡(0575/2544/2705/7293/9927) |
| 11 | **CZB** | 浙商银行 | ❌ 手动脚本 | 1卡(2171) |

---

## 二、现状问题：字段不统一

### 各家当前列名对比

| 字段含义 | 平安 | 光大 | 民生 | 浙商 | ICBC(参考) | BOCOM(参考) |
|:--------|:-----|:-----|:-----|:-----|:----------|:-----------|
| **交易日期** | `交易日` | `交易日期` | `交易日期` | `交易日期` | ✓ | ✓ |
| **记账日期** | `记账日` | `记账日期` | `记账日期` | `记账日期` | ✓ | ✓ |
| **金额** | `入账金额` | `人民币金额` | `人民币金额` | `人民币金额` | ✓ | ✓ |
| **交易说明** | `交易描述` | `交易说明` | `交易摘要` | `交易摘要` | ✓ | ✓ |
| **卡号** | `卡号后四位` | `信用卡尾号` | `卡号末四位` | `卡号末四位` | ✓ | ✓ |
| **交易类型** | `交易类型`(推导) | 无(推导) | `交易类型`(推导) | `交易类型`(推导) | ✓ | ✓ |

**核心矛盾**：
- 列名不统一（5种叫法）
- 金额正负规则一致但未显式标准化
- 缺少银行维度标识
- 缺少账单周期元信息

---

## 三、统一标准字段定义

### 核心原则
> **消费/支出/分期 = 正数(+)**  
> **还款/存入/退款/调整 = 负数(-)**
> 
> 所有11家银行统一到此符号规则。
> **交易描述(description)保持银行原文，不做任何修改**

---

## 四、PostgreSQL 表结构设计

### 表1：`credit_card_bills` — 账单头信息

```sql
CREATE TABLE credit_card_bills (
    id              SERIAL PRIMARY KEY,
    bank_code       VARCHAR(10) NOT NULL,        -- 银行代码 ABC/BOCOM/...
    bank_name       VARCHAR(50) NOT NULL,         -- 银行全称
    cardholder      VARCHAR(50),                  -- ★ 持卡人姓名（非全部是吴华辉）
    bill_date       DATE NOT NULL,               -- 账单日
    due_date        DATE,                        -- 到期还款日
    cycle_start     DATE NOT NULL,               -- 账单周期起始
    cycle_end       DATE NOT NULL,                -- 账单周期结束
    statement_balance DECIMAL(14,2),             -- 本期应还金额
    min_payment      DECIMAL(14,2),              -- 最低还款额
    prev_balance    DECIMAL(14,2),               -- 上期账单金额
    new_charges     DECIMAL(14,2),               -- 本期新增
    payments        DECIMAL(14,2),               -- 上期还款
    adjustments     DECIMAL(14,2),               -- 调整/退款
    interest        DECIMAL(14,2),               -- 循环利息
    credit_limit    DECIMAL(14,2),               -- 信用额度
    account_masked  VARCHAR(30),                 -- 脱敏账号 如 62265541****5973
    raw_email_uid   VARCHAR(100),                -- 原始邮件UID（用于去重）
    raw_html_path   TEXT,                        -- 原始HTML存储路径
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE(bank_code, bill_date, account_masked)
);

CREATE INDEX idx_bills_bank_date ON credit_card_bills(bank_code, bill_date);
CREATE INDEX idx_bills_cycle ON credit_card_bills(cycle_start, cycle_end);
```

### 表2：`credit_card_transactions` — 交易明细（主表）

```sql
CREATE TABLE credit_card_transactions (
    id              SERIAL PRIMARY KEY,
    bill_id         INTEGER REFERENCES credit_card_bills(id),
    
    -- === 银行与卡 ===
    bank_code       VARCHAR(10) NOT NULL,        -- 冗余，方便独立查询
    cardholder      VARCHAR(50),                  -- ★ 持卡人姓名
    card_last4      VARCHAR(10),                  -- 卡号末四位（多卡时区分）
    card_type       VARCHAR(50),                 -- 卡种名称（如"美国运通金卡""bduck小黄鸭"）
    account_masked  VARCHAR(30),                 -- 脱敏账号
    
    -- === 日期 ===
    trans_date      DATE NOT NULL,               -- 交易日
    post_date       DATE NOT NULL,                -- 记账日
    
    -- === 交易内容 ===
    description     VARCHAR(500) NOT NULL,       -- 交易说明/摘要
    category        VARCHAR(50),                 -- 分类（自动标注：餐饮/交通/购物/还款/分期...）
    
    -- === 金额（统一符号规则：消费+ / 还款存入退款-）===
    amount          DECIMAL(14,2) NOT NULL,       -- ★ 正=消费/支出/分期，负=还款/存入/退款
    currency        VARCHAR(10) DEFAULT 'CNY',   -- 币种
    
    -- === 交易类型（标准化枚举）===
    trans_type      VARCHAR(20) NOT NULL,         -- 见下方枚举定义
    is_installment  BOOLEAN DEFAULT FALSE,        -- 是否分期
    installment_info VARCHAR(200),               -- 分期信息（如"第5/12期 本金274.96"）
    
    -- === 元信息 ===
    source          VARCHAR(20) DEFAULT 'manual', -- 数据来源 skill/email/manual
    imported_at     TIMESTAMP DEFAULT NOW(),
    raw_line_text   TEXT,                         -- 原始行文本（审计用）
    
    -- === 索引优化 ===
    UNIQUE(bank_code, trans_date, post_date, card_last4, description, amount)
);

CREATE INDEX idx_trans_bank ON credit_card_transactions(bank_code);
CREATE INDEX idx_trans_date ON credit_card_transactions(trans_date);
CREATE INDEX idx_trans_card ON credit_card_transactions(bank_code, card_last4);
CREATE INDEX idx_trans_type ON credit_card_transactions(trans_type);
CREATE INDEX idx_trans_amount ON credit_card_transactions(amount);  -- 用于区分正负
```

### `trans_type` 枚举值定义

| 枚举值 | 含义 | amount符号 | 典型关键词 |
|:------|:-----|:----------|:---------|
| **SPEND** | 消费支出 | **+** | 支付宝-xxx / 财付通-xxx / 银联消费 |
| **INSTALLMENT_PRIN** | 分期本金 | **+** | 分期...本金 / 每月摊消 |
| **INSTALLMENT_INT** | 分期利息/手续费 | **+** | 分期...利息 / 分期费 |
| **FEE** | 年费/手续费 | **+** | 年费 / 手续费 / 滞纳金 |
| **CASH_ADVANCE** | 取现 | **+** | 取现 / 预借现金 |
| **REPAY** | 还款 | **-** | 还款 / 信用卡还款 / 自动扣账还款 |
| **DEPOSIT** | 存入/入账 | **-** | 存入 / 银联入账 / 消费金入账 |
| **REFUND** | 退款 | **-** | 退款 / 退货 |
| **ADJUST** | 调整 | **-/+** | 调整 / 冲正（按实际符号） |
| **TRANSFER_OUT** | 转出 | **+** | 转账给他人（如支付宝-吴华辉） |
| **OTHER** | 其他 | 视情况 | 无法归类的 |

---

## 五、各银行映射规则

### 金额符号转换表

| 银行 | 原始格式 | 转换规则 |
|:----|:--------|:-------|
| **平安** | `&yen; -2.00` 或 `&yen; 10.94` | 直接取值，负=还/退，正=消费 ✅ 已符合 |
| **光大** | `(存入)1.01` 或 `102.80` | `(存入)` → 取反为 **-1.01**，其余正 ✅ 需转换 |
| **民生** | `-10.00` 或 `144.00` | 直接取值 ✅ 已符合 |
| **浙商** | `-9000.00` 或 `106.62` | 直接取值 ✅ 已符合 |
| **ICBC** | 文本中"存入"/"支出"分区 | 存入区 → **负数**，支出区 → **正数** |
| **BOCOM** | "还款/退货"区 + "消费/取现"区 | 还款区 → **负数**，消费区 → **正数** |
| **CCB** | 负数为还款 | 直接取值 ✅ 已符合 |
| **ABC** | 支出为负（农行特例！） | **取反**：原负→正(消费)，原正→负(还款) ⚠️ |
| **CMB** | 还款/消费分三区 | 还款区 → **负数**，消费区 → **正数** |
| **CITIC** | 负号为还款 | 直接取值 ✅ 已符合 |
| **CGB** | 待确认格式 | 待验证 |

> ⚠️ **农行是唯一例外**：它的原始数据里消费记为**负号**，需要取反。

### 列名映射（→ 统一字段）

> ⚠️ **description 字段保持银行原文，不做任何文字修改**

| 统一字段 | 平安 | 光大 | 民生 | 浙商 | ICBC |
|:--------|:-----|:-----|:-----|:-----|:-----|
| trans_date | 交易日 | 交易日期 | 交易日期 | 交易日期 | 交易日 |
| post_date | 记账日 | 记账日期 | 记账日期 | 记账日期 | 记账日 |
| description | 交易描述（原样） | 交易说明（原样） | 交易摘要（原样） | 交易摘要（原样） | 交易摘要（原样） |
| amount（统一±） | 入账金额 | 人民币金额 | 人民币金额 | 人民币金额 | 交易金额 |
| card_last4 | 卡号后四位 | 信用卡尾号 | 卡号末四位 | 卡号末四位 | 卡号 |

---

## 六、入库流程设计

```
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  QQ邮箱IMAP │───▶│  银行Skill    │───▶│  统一解析器       │
│  (或手动输入) │    │  (fetch+parse)│    │  normalize()     │
└─────────────┘    └──────────────┘    └────────┬─────────┘
                                                │
                                                ▼
                                      ┌──────────────────┐
                                      │  标准JSON输出      │
                                      │  {transactions[]} │
                                      └────────┬─────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │  UPSERT → PostgreSQL │
                                    │  ON CONFLICT DO      │
                                    │  UPDATE (去重)        │
                                    └─────────────────────┘
```

### 去重键
```sql
UNIQUE(bank_code, trans_date, post_date, card_last4, description, amount)
```

同一家银行、同一交易日+记账日、同一张卡、同一描述、同一金额 = 同一笔交易。

---

## 七、下一步行动

1. **建表** — 先在 PostgreSQL 执行 DDL 创建两张表
2. **写统一解析器** — 一个 `normalize.py`，接收任意银行的 DataFrame，输出标准字段
3. **改造现有skill的输出** — 7个skill的 parse-bill.py 末尾追加标准 JSON 输出
4. **4个手动脚本改造** — 平安/光大/民生/浙商 gen.py 追加 PG 入库逻辑
5. **农行特殊处理** — 符号取反
6. **分类标注** — 基于 description 关键词自动打 `category` 标签（餐饮/交通/购物/...）

---

*方案版本: v0.2 | 2026-04-24 — 新增cardholder持卡人字段，明确description原样保留不修改*
