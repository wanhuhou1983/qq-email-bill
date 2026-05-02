-- 借记卡交易明细表
CREATE TABLE IF NOT EXISTS debit_card_transactions (
    id SERIAL PRIMARY KEY,

    -- 账户信息
    bank_code VARCHAR(10) NOT NULL DEFAULT 'HRB',       -- 华瑞银行
    account_number VARCHAR(32) NOT NULL,                -- 卡号/账号
    account_name VARCHAR(32) NOT NULL,                  -- 账户名称

    -- 交易信息
    trans_date DATE NOT NULL,                           -- 交易日期
    description VARCHAR(500) NOT NULL,                  -- 摘要
    debit NUMERIC(15,2) DEFAULT 0,                      -- 借方(支出, 正数)
    credit NUMERIC(15,2) DEFAULT 0,                     -- 贷方(收入, 正数)
    balance NUMERIC(15,2) DEFAULT 0,                    -- 余额
    amount NUMERIC(15,2),                               -- 统一金额: 支出为负, 收入为正

    -- 辅助信息
    remark VARCHAR(200) DEFAULT '',                     -- 备注
    counterparty_name VARCHAR(100) DEFAULT '',           -- 交易对手
    counterparty_account VARCHAR(50) DEFAULT '',         -- 对方账号
    counterparty_bank VARCHAR(100) DEFAULT '',           -- 对方银行

    -- 元数据
    trans_time TIME,                                    -- 交易时间
    source VARCHAR(32) DEFAULT 'upload',                -- 数据来源
    imported_at TIMESTAMP DEFAULT NOW(),
    raw_line_text TEXT DEFAULT '',

    -- 去重: 同一账户同一天同一金额同一描述视为重复
    UNIQUE (account_number, trans_date, amount, description, counterparty_name)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_debit_trans_date ON debit_card_transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_debit_bank ON debit_card_transactions(bank_code);
CREATE INDEX IF NOT EXISTS idx_debit_account ON debit_card_transactions(account_number);
CREATE INDEX IF NOT EXISTS idx_debit_amount ON debit_card_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_debit_desc ON debit_card_transactions USING gin(description gin_trgm_ops);
