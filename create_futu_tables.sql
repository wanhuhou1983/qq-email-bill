-- 富途保证金综合账户 月结单 数据库表 (PostgreSQL)

-- 账户信息表
CREATE TABLE IF NOT EXISTS futu_accounts (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL UNIQUE,
    account_name VARCHAR(100),
    account_type VARCHAR(20),
    base_currency VARCHAR(5),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 资金余额（按币种分）
CREATE TABLE IF NOT EXISTS futu_cash_balances (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL,
    account_name VARCHAR(100),
    period VARCHAR(7) NOT NULL,
    currency VARCHAR(5) NOT NULL,
    opening_balance DECIMAL(18,4) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(18,4) NOT NULL DEFAULT 0,
    net_change DECIMAL(18,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_no, period, currency)
);

-- 持仓记录（期初/期末）
CREATE TABLE IF NOT EXISTS futu_positions (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL,
    account_name VARCHAR(100),
    period VARCHAR(7) NOT NULL,
    position_type VARCHAR(10) NOT NULL,
    asset_type VARCHAR(20) NOT NULL,
    symbol VARCHAR(20),
    name VARCHAR(100),
    exchange VARCHAR(20),
    currency VARCHAR(5),
    quantity DECIMAL(18,6),
    price DECIMAL(18,6),
    market_value_hkd DECIMAL(18,4),
    initial_margin DECIMAL(18,4),
    maintenance_margin DECIMAL(18,4),
    margin_rate DECIMAL(8,4),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_no, period, position_type, asset_type, symbol)
);

-- 月度账户汇总
CREATE TABLE IF NOT EXISTS futu_monthly_summary (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL,
    account_name VARCHAR(100),
    account_type VARCHAR(20),
    base_currency VARCHAR(5),
    period VARCHAR(7) NOT NULL UNIQUE,

    -- 资产净值
    opening_equity_hkd DECIMAL(18,4),
    closing_equity_hkd DECIMAL(18,4),
    equity_change_hkd DECIMAL(18,4),

    -- 保证金要求
    initial_margin_required DECIMAL(18,4),
    maintenance_margin_required DECIMAL(18,4),
    available_for_trading_hkd DECIMAL(18,4),

    -- 融资
    financing_balance_hkd DECIMAL(18,4),
    financing_rate DECIMAL(10,6),
    total_interest_hkd DECIMAL(18,4),
    financing_currency VARCHAR(5),

    -- 多币种资产
    total_hkd DECIMAL(18,4),
    total_usd DECIMAL(18,4),
    total_cnh DECIMAL(18,4),
    total_jpy DECIMAL(18,4),
    total_sgd DECIMAL(18,4),

    -- 参考汇率
    fx_usd_hkd DECIMAL(10,6),
    fx_cnh_hkd DECIMAL(10,6),
    fx_jpy_hkd DECIMAL(10,6),
    fx_sgd_hkd DECIMAL(10,6),

    -- 交易费用
    total_trade_amount_hkd DECIMAL(18,4),
    total_commission_hkd DECIMAL(18,4),
    total_platform_fee_hkd DECIMAL(18,4),
    total_settlement_fee_hkd DECIMAL(18,4),
    total_stamp_duty_hkd DECIMAL(18,4),
    total_trade_fee_hkd DECIMAL(18,4),
    total_regulatory_fee_hkd DECIMAL(18,4),
    total_levy_hkd DECIMAL(18,4),

    -- 资金进出
    deposit_hkd DECIMAL(18,4),
    withdrawal_hkd DECIMAL(18,4),
    fund_redemption_hkd DECIMAL(18,4),
    ipo_application_hkd DECIMAL(18,4),
    ipo_refund_hkd DECIMAL(18,4),
    net_cash_flow_hkd DECIMAL(18,4),

    prepared_date DATE,

    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_no, period)
);

-- 交易明细
CREATE TABLE IF NOT EXISTS futu_transactions (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL,
    account_name VARCHAR(100),
    period VARCHAR(7) NOT NULL,
    asset_type VARCHAR(20) NOT NULL,
    direction VARCHAR(20),
    symbol VARCHAR(20),
    name VARCHAR(100),
    exchange VARCHAR(20),
    currency VARCHAR(5),
    trade_date DATE,
    settle_date DATE,
    quantity DECIMAL(18,6),
    price DECIMAL(18,6),
    amount_hkd DECIMAL(18,4),
    net_amount_hkd DECIMAL(18,4),
    commission_hkd DECIMAL(18,4),
    platform_fee_hkd DECIMAL(18,4),
    settlement_fee_hkd DECIMAL(18,4),
    stamp_duty_hkd DECIMAL(18,4),
    trade_fee_hkd DECIMAL(18,4),
    regulatory_fee_hkd DECIMAL(18,4),
    levy_hkd DECIMAL(18,4),
    notes VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_futu_tx_account_period ON futu_transactions (account_no, period);

-- 融资每日记录
CREATE TABLE IF NOT EXISTS futu_financing_daily (
    id SERIAL PRIMARY KEY,
    account_no VARCHAR(20) NOT NULL,
    account_name VARCHAR(100),
    period VARCHAR(7) NOT NULL,
    date DATE NOT NULL,
    currency VARCHAR(5),
    financing_balance DECIMAL(18,4),
    daily_rate DECIMAL(10,6),
    daily_interest DECIMAL(18,4),
    cumulative_interest DECIMAL(18,4),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_no, date)
);
