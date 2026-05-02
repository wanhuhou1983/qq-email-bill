-- PostgreSQL 信用卡账单建表SQL
-- 执行: psql -h localhost -U postgres -d postgres -f create_tables.sql

DROP TABLE IF EXISTS credit_card_transactions CASCADE;
DROP TABLE IF EXISTS credit_card_bills CASCADE;

-- 表1：账单头信息
CREATE TABLE credit_card_bills (
    id              SERIAL PRIMARY KEY,
    bank_code       VARCHAR(10) NOT NULL,
    bank_name       VARCHAR(50) NOT NULL,
    cardholder      VARCHAR(50),
    bill_date       DATE NOT NULL,
    due_date        DATE,
    cycle_start     DATE,
    cycle_end       DATE,
    statement_balance DECIMAL(14,2),
    min_payment     DECIMAL(14,2),
    prev_balance    DECIMAL(14,2),
    new_charges     DECIMAL(14,2),
    payments        DECIMAL(14,2),
    adjustments     DECIMAL(14,2),
    interest        DECIMAL(14,2),
    credit_limit    DECIMAL(14,2),
    account_masked  VARCHAR(30),
    raw_email_uid   VARCHAR(100),
    raw_html_path   TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(bank_code, bill_date, account_masked)
);

CREATE INDEX idx_bills_bank_date ON credit_card_bills(bank_code, bill_date);
CREATE INDEX idx_bills_cycle ON credit_card_bills(cycle_start, cycle_end);
CREATE INDEX idx_bills_cardholder ON credit_card_bills(cardholder);

-- 表2：交易明细（主表）
CREATE TABLE credit_card_transactions (
    id              SERIAL PRIMARY KEY,
    bill_id         INTEGER REFERENCES credit_card_bills(id) ON DELETE SET NULL,

    -- 银行与卡
    bank_code       VARCHAR(10) NOT NULL,
    cardholder      VARCHAR(50),
    card_last4      VARCHAR(10),
    card_type       VARCHAR(50),
    account_masked  VARCHAR(30),

    -- 日期
    trans_date      DATE NOT NULL,
    post_date       DATE NOT NULL,

    -- 交易内容
    description     VARCHAR(500) NOT NULL,
    category        VARCHAR(50),

    -- 金额（统一符号：消费+=，还款/存入/退款-）
    amount          DECIMAL(14,2) NOT NULL,
    currency        VARCHAR(10) DEFAULT 'CNY',

    -- 交易类型
    trans_type      VARCHAR(20) NOT NULL,
    is_installment  BOOLEAN DEFAULT FALSE,
    installment_info VARCHAR(200),

    -- 元信息
    source          VARCHAR(20) DEFAULT 'manual',
    imported_at     TIMESTAMP DEFAULT NOW(),
    raw_line_text   TEXT,

    UNIQUE(bank_code, trans_date, post_date, card_last4, description, amount)
);

CREATE INDEX idx_trans_bank ON credit_card_transactions(bank_code);
CREATE INDEX idx_trans_date ON credit_card_transactions(trans_date);
CREATE INDEX idx_trans_card ON credit_card_transactions(bank_code, card_last4);
CREATE INDEX idx_trans_type ON credit_card_transactions(trans_type);
CREATE INDEX idx_trans_amount ON credit_card_transactions(amount);
CREATE INDEX idx_trans_cardholder ON credit_card_transactions(cardholder);
CREATE INDEX idx_trans_category ON credit_card_transactions(category);
