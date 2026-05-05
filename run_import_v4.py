"""
富途月结单导入 - v4 完整版
修复:
  1) 所有资金流水都生成交易记录(出入金/基金申购/基金赎回/月度利息扣除)
  2) IPO中签记录(股票到账=资产进出)
  3) 基金申购不再跳过
  4) 融资利息扣除记录为交易
"""
import pdfplumber, re, os, psycopg2
from datetime import datetime

PDF_DIR = r'C:\Users\linhu\.workbuddy\skills\QQ邮箱\scripts\futu_monthly_pdfs'
DB_PASSWORD = 'DB_PASSWORD'

ACCOUNTS = {
    '5912': {
        'periods': {
            '2025-11': 'monthly_statement_202511_665950812_2563.pdf',
            '2025-12': 'monthly_statement_202512_665950812_2757.pdf',
            '2026-01': 'monthly_statement_202601_665950812_2934.pdf',
            '2026-02': 'monthly_statement_202602_665950812_3103.pdf',
            '2026-03': 'monthly_statement_202603_665950812_3286.pdf',
            '2026-04': 'monthly_statement_202604_665950812_3531.pdf',
        },
        'password': None
    },
    '0162': {
        'periods': {
            '2025-11': 'monthly_statement_202511_1770680955_2563.pdf',
            '2025-12': 'monthly_statement_202512_1770680955_2757.pdf',
            '2026-01': 'monthly_statement_202601_1770680955_2934.pdf',
            '2026-02': 'monthly_statement_202602_1770680955_3103.pdf',
            '2026-03': 'monthly_statement_202603_1770680955_3286.pdf',
            '2026-04': 'monthly_statement_202604_1770680955_3531.pdf',
        },
        'password': None
    },
    '7913': {
        'periods': {
            '2025-11': 'monthly_statement_202511_2179198667_2563.pdf',
            '2025-12': 'monthly_statement_202512_2179198667_2757.pdf',
            '2026-01': 'monthly_statement_202601_2179198667_2934.pdf',
            '2026-02': 'monthly_statement_202602_2179198667_3103.pdf',
            '2026-03': 'monthly_statement_202603_2179198667_3286.pdf',
            '2026-04': 'monthly_statement_202604_2179198667_3531.pdf',
        },
        'password': 'FUTU_PASSWORD'
    }
}

def extract_number(s):
    if not s: return None
    s = s.strip().replace(',', '').replace(' ', '')
    if s == '-' or s == '': return 0.0
    m = re.search(r'[-+]?[\d.]+', s)
    if m:
        val = float(m.group())
        if '(' in s and ')' in s: val = -val
        return val
    return None

def parse_fee_line(line):
    fees = {}
    fee_map = {
        '佣金:': 'commission', '平台使用費:': 'platform_fee', '交收費:': 'settlement_fee',
        '印花稅:': 'stamp_duty', '交易費:': 'trade_fee', '證監會徵費:': 'regulatory_fee', '財匯局徵費:': 'levy'
    }
    for label, key in fee_map.items():
        m = re.search(rf'{re.escape(label)}\s*([\d,.-]+)', line)
        if m: fees[key] = extract_number(m.group(1))
    return fees

def normalize_account_name(raw_name):
    """从原始账户名中提取纯姓名"""
    if not raw_name:
        return ''
    idx = raw_name.find('賬戶號碼')
    if idx > 0:
        raw_name = raw_name[:idx].strip()
    # 去掉后缀如 "1/8", "1/7", "1/6"
    raw_name = re.sub(r'\s+\d+/\d+$', '', raw_name).strip()
    return raw_name

def parse_futu_pdf(pdf_path, password=None, fallback_period=''):
    data = {
        'account_name': '', 'account_no': '', 'account_type': '', 'base_currency': 'HKD',
        'period': fallback_period, 'prepared_date': None,
        'opening_equity_hkd': 0, 'closing_equity_hkd': 0, 'equity_change_hkd': 0,
        'total_hkd': 0, 'total_usd': 0, 'total_cnh': 0, 'total_jpy': 0, 'total_sgd': 0,
        'fx_usd_hkd': None, 'fx_cnh_hkd': None, 'fx_jpy_hkd': None, 'fx_sgd_hkd': None,
        'initial_margin_required': 0, 'maintenance_margin_required': 0, 'available_for_trading_hkd': 0,
        'financing_balance_hkd': 0, 'financing_rate': 0, 'total_interest_hkd': 0, 'financing_currency': 'HKD',
        'deposit_hkd': 0, 'withdrawal_hkd': 0, 'fund_redemption_hkd': 0, 'fund_subscription_hkd': 0,
        'ipo_application_hkd': 0, 'ipo_refund_hkd': 0, 'net_cash_flow_hkd': 0,
        'interest_fee_hkd': 0,
        'total_trade_amount_hkd': 0, 'total_commission_hkd': 0, 'total_platform_fee_hkd': 0,
        'total_settlement_fee_hkd': 0, 'total_stamp_duty_hkd': 0, 'total_trade_fee_hkd': 0,
        'total_regulatory_fee_hkd': 0, 'total_levy_hkd': 0,
        'transactions': [], 'financing_daily': [],
    }

    with pdfplumber.open(pdf_path, password=password) as pdf:
        full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        lines = full_text.split('\n')

        # 账期
        m_period = re.search(r'結算日期[：:\s]*(\d{4}/\d{2}/\d{2})\s*[-~]\s*(\d{4}/\d{2}/\d{2})', full_text)
        if m_period:
            data['period'] = m_period.group(1)[:7].replace('/', '-')

        m_prep = re.search(r'製備日期[：:\s]*(\d{4}/\d{2}/\d{2})', full_text)
        if m_prep: data['prepared_date'] = m_prep.group(1).replace('/', '-')

        # 账户信息
        m_acct = re.search(r'賬戶號碼[：:\s]*(\d+)', full_text)
        if m_acct: data['account_no'] = m_acct.group(1)
        m_name = re.search(r'客戶姓名[：:\s]*(.+?)\s*\n', full_text)
        if m_name:
            data['account_name'] = normalize_account_name(m_name.group(1).strip())
        m_type = re.search(r'賬戶類型[：:\s]*(.+?)\s*\n', full_text)
        if m_type: data['account_type'] = m_type.group(1).strip()

        # 资产净值
        found_section = False
        for line in lines:
            if '資產組合摘要' in line:
                found_section = True
                continue
            if found_section and re.match(r'資產淨值\s+[\d,.-]+\s+[\d,.-]+', line):
                parts = line.split()
                if len(parts) >= 3:
                    data['opening_equity_hkd'] = extract_number(parts[1]) or 0
                    data['closing_equity_hkd'] = extract_number(parts[2]) or 0
                    if len(parts) >= 4:
                        data['equity_change_hkd'] = extract_number(parts[3]) or 0
                break

        # 多币种资产
        for cur, key in [('HKD', 'total_hkd'), ('USD', 'total_usd'), ('CNH', 'total_cnh'), ('JPY', 'total_jpy'), ('SGD', 'total_sgd')]:
            m = re.search(rf'{cur}[^折算]*折算[^{cur}]*{cur}[^\d]*([\d,.-]+)\s*{cur}', full_text)
            if not m: m = re.search(rf'{cur}[^\d]*\d+[^\d]*([\d,.-]+)\s*{cur}', full_text)
            if m: data[key] = extract_number(m.group(1)) or 0

        for cur, key in [('USD', 'fx_usd_hkd'), ('CNH', 'fx_cnh_hkd'), ('JPY', 'fx_jpy_hkd'), ('SGD', 'fx_sgd_hkd')]:
            m = re.search(rf'{cur}/HKD[^\d]*([\d,.-]+)', full_text)
            if m: data[key] = extract_number(m.group(1))

        m_im = re.search(r'期初需求[^\d]*([\d,.-]+)', full_text)
        m_mm = re.search(r'維持需求[^\d]*([\d,.-]+)', full_text)
        m_av = re.search(r'可交易[^\d]*([\d,.-]+)', full_text)
        if m_im: data['initial_margin_required'] = extract_number(m_im.group(1)) or 0
        if m_mm: data['maintenance_margin_required'] = extract_number(m_mm.group(1)) or 0
        if m_av: data['available_for_trading_hkd'] = extract_number(m_av.group(1)) or 0

        m_fb = re.search(r'融資/融券金額[^\d]*([\d,.-]+)\s*HKD', full_text)
        m_fr = re.search(r'年利率[^\d]*([\d.]+)%', full_text)
        if m_fb: data['financing_balance_hkd'] = extract_number(m_fb.group(1)) or 0
        if m_fr: data['financing_rate'] = float(m_fr.group(1)) / 100

        # ========== 资金流解析 - 全部生成交易记录 ==========
        cash_flow_pattern = re.compile(
            r'(\d{4}/\d{2}/\d{2})\s+(增加|減少)\s+(.+?)\s+(HKD|USD|CNH|JPY|SGD)\s+([+-]?[\d,.-]+)\s*(.*)',
            re.MULTILINE
        )

        cf_transactions = []  # 从资金页提取的所有流水记录

        for m_cf in cash_flow_pattern.finditer(full_text):
            cf_date = m_cf.group(1).replace('/', '-')
            cf_dir = m_cf.group(2)
            cf_type = m_cf.group(3).strip()
            cf_cur = m_cf.group(4)
            cf_amt_raw = m_cf.group(5)
            cf_note = m_cf.group(6).strip()

            if cf_cur != 'HKD': continue
            abs_amount = abs(extract_number(cf_amt_raw) or 0)

            # 判断资金流水类型
            # 出入金=通用词, 需结合方向判断: 增加=存入, 減少=取出
            is_deposit = '存入' in cf_type or ('入金' in cf_type and '出金' not in cf_type)
            is_withdrawal = '提取' in cf_type or ('出金' in cf_type and '入金' not in cf_type) or ('出入金' in cf_type and cf_dir == '減少')
            is_fund_redemption = '基金贖回' in cf_type or 'Fund Redemption' in cf_note
            is_fund_subscription = '基金申購' in cf_type or 'Fund Subscription' in cf_note
            is_ipo = ('港股IPO公開發售' in cf_type or 'IPO公開發售' in cf_type or
                      'IPO Application' in cf_note or 'IPO Refund' in cf_note)
            is_ipo_allotment = 'IPO Allotment' in cf_note or ('IPO' in cf_type and 'Allotment' in cf_note)
            is_interest_fee = '月度利息扣除' in cf_type or 'Interest' in cf_note

            # 统一方向映射 (与前端保持一致的命名)
            if is_deposit:
                direction = 'deposit'
                data['deposit_hkd'] += abs_amount
            elif is_withdrawal:
                direction = 'withdrawal'
                data['withdrawal_hkd'] += abs_amount
            elif is_fund_redemption:
                direction = 'fund_redemption'
                data['fund_redemption_hkd'] += abs_amount
            elif is_fund_subscription:
                direction = 'fund_subscription'
                data['fund_subscription_hkd'] += abs_amount
            elif is_ipo:
                if cf_dir == '減少':
                    direction = 'ipo_apply'
                    data['ipo_application_hkd'] += abs_amount
                else:
                    direction = 'ipo_refund'
                    data['ipo_refund_hkd'] += abs_amount
            elif is_ipo_allotment:
                direction = 'ipo_allot'
            elif is_interest_fee:
                direction = 'interest_fee'
                data['interest_fee_hkd'] += abs_amount
            else:
                # 未知类型 - 记录为 other
                direction = 'other'

            # 提取股票代码（从备注或类型中）
            stock_code = ''
            stock_name = ''
            m_code = re.search(r'#(\d{5})', cf_note)
            if m_code:
                stock_code = m_code.group(1)
            else:
                # 从类型中提取: "港股IPO公 6082(壁仞科技)"
                m_code2 = re.search(r'(\d{4,5})\s*\(', cf_type)
                if m_code2:
                    stock_code = m_code2.group(1)

            # 提取股票名称
            m_name_cf = re.search(r'\((.*?)\)', cf_type)
            if m_name_cf:
                stock_name = m_name_cf.group(1)
            elif is_ipo_allotment:
                stock_name = cf_type

            # 构建交易名称
            tx_name = cf_type
            if cf_note and not is_deposit and not is_withdrawal:
                tx_name = cf_note[:50]

            note = f"{cf_dir}: {cf_type}"
            if cf_note:
                note = f"{cf_dir}: {cf_note}"

            cf_transactions.append({
                'asset_type': '股票和股票期權' if is_ipo or is_ipo_allotment else '资金',
                'direction': direction,
                'symbol': stock_code,
                'name': tx_name,
                'currency': cf_cur,
                'trade_date': cf_date,
                'settle_date': None,
                'quantity': None,
                'price': None,
                'amount': abs_amount,
                'net_amount': abs_amount,
                'fees': {},
                'exchange': '',
                'notes': note
            })

        # 净现金流
        data['net_cash_flow_hkd'] = (
            data['deposit_hkd'] - data['withdrawal_hkd']
            + data['fund_redemption_hkd'] - data['fund_subscription_hkd']
            + data['ipo_refund_hkd'] - data['ipo_application_hkd']
            - data['interest_fee_hkd']
        )

        # ========== 融资每日明细 ==========
        fin_pattern = re.compile(
            r'(\d{4}/\d{2}/\d{2})\s+(HKD|USD)\s+([\d,.-]+)\s+([\d.]+)%\s+([\d,.-]+)\s+([\d,.-]+)',
            re.MULTILINE
        )
        max_interest = 0
        for m_fin in fin_pattern.finditer(full_text):
            currency = m_fin.group(2)
            if currency != 'HKD': continue
            balance = extract_number(m_fin.group(3)) or 0
            rate = float(m_fin.group(4)) / 100
            daily_int = extract_number(m_fin.group(5)) or 0
            cum_int = extract_number(m_fin.group(6)) or 0
            data['financing_daily'].append({
                'date': m_fin.group(1).replace('/', '-'),
                'currency': currency,
                'financing_balance': balance,
                'daily_rate': rate / 365,
                'daily_interest': daily_int,
                'cumulative_interest': cum_int
            })
            if cum_int and cum_int > max_interest: max_interest = cum_int
            if balance and data['financing_balance_hkd'] == 0: data['financing_balance_hkd'] = balance
            if rate and data['financing_rate'] == 0: data['financing_rate'] = rate
        data['total_interest_hkd'] = max_interest

        # ========== 交易明细解析 ==========
        all_page_lines = []
        for page in pdf.pages:
            page_text = page.extract_text() or ''
            all_page_lines.extend(page_text.split('\n'))

        i = 0
        tx_transactions = []
        pending_stock_trade = None
        current_fees = {}

        while i < len(all_page_lines):
            line = all_page_lines[i].strip()

            if i <= 4 or line.startswith('成交金額合計') or line.startswith('佣金合計') or \
               line.startswith('平台使用費合計') or line.startswith('交收費合計') or \
               line.startswith('印花稅合計') or line.startswith('交易費合計') or \
               line.startswith('證監會徵費合計') or line.startswith('財匯局徵費合計') or \
               line.startswith('變動金額合計') or line.startswith('製備日期') or \
               line.startswith('客戶姓名') or \
               re.match(r'^\d{4}/\d{2}/\d{2}$', line):
                i += 1; continue

            m_fund_req = re.match(r'(申購|贖回)\s+(HK\d+)\s+\(([^)]+)\)\s+(HKD|USD|CNH|JPY|SGD)\s+(\d{4}/\d{2}/\d{2})\s+-\s+-\s+-\s+([\d,.-]+)', line)
            if m_fund_req:
                i += 1; continue

            m_fund = re.match(r'(申購|贖回)\s+(HK\d+)\s+\(([^)]+)\)\s+(HKD|USD|CNH|JPY|SGD)\s+(\d{4}/\d{2}/\d{2})\s+(\d{4}/\d{2}/\d{2})\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)', line)
            if m_fund:
                tx_transactions.append({
                    'asset_type': '基金',
                    'direction': 'redeem' if m_fund.group(1) == '贖回' else 'purchase',
                    'symbol': m_fund.group(2), 'name': m_fund.group(3),
                    'currency': m_fund.group(4),
                    'trade_date': m_fund.group(5).replace('/', '-'),
                    'settle_date': m_fund.group(6).replace('/', '-'),
                    'quantity': extract_number(m_fund.group(7)),
                    'price': extract_number(m_fund.group(8)),
                    'amount': extract_number(m_fund.group(9)),
                    'net_amount': extract_number(m_fund.group(9)),
                    'fees': {}, 'exchange': 'FUND',
                    'notes': ''
                })
                i += 1; continue

            m_title = re.match(r'(買入|賣出平倉)\s+(HKD|USD|CNH|JPY|SGD)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)', line)
            if m_title:
                if pending_stock_trade:
                    pending_stock_trade['fees'] = current_fees
                    tx_transactions.append(pending_stock_trade)
                direction_map = {'買入': 'buy', '賣出平倉': 'sell'}
                pending_stock_trade = {
                    'asset_type': '股票和股票期權',
                    'direction': direction_map.get(m_title.group(1), m_title.group(1)),
                    'currency': m_title.group(2),
                    'quantity': extract_number(m_title.group(3)),
                    'price': extract_number(m_title.group(4)),
                    'amount': extract_number(m_title.group(5)),
                    'net_amount': extract_number(m_title.group(6)),
                    'fees': {}, 'symbol': '', 'name': '', 'exchange': '',
                    'trade_time': '', 'trade_date': None, 'settle_date': None,
                    'notes': ''
                }
                current_fees = {}

                combined = ''
                j = i + 1
                while j < len(all_page_lines) and not all_page_lines[j].strip().startswith('佣金:'):
                    nxt = all_page_lines[j].strip()
                    if nxt.startswith('成交金額合計') or nxt.startswith('佣金合計') or \
                       nxt.startswith('平台使用費合計') or nxt.startswith('交易-'):
                        break
                    combined += ' ' + nxt
                    j += 1
                combined = combined.strip()

                m_sym = re.search(r'(\d{4,5})\(([^)]+?)(?:\s*-|\s+\d{4}/)', combined)
                if m_sym:
                    pending_stock_trade['symbol'] = m_sym.group(1)
                    pending_stock_trade['name'] = m_sym.group(2).strip()

                m_ex = re.search(r'-\s+([A-Z][A-Za-z\s]+?)\s+HKD', combined)
                if m_ex: pending_stock_trade['exchange'] = m_ex.group(1).strip()

                m_dt = re.search(r'(\d{4}/\d{2}/\d{2})\s+(\d{4}/\d{2}/\d{2})', combined)
                if m_dt:
                    pending_stock_trade['trade_date'] = m_dt.group(1).replace('/', '-')
                    pending_stock_trade['settle_date'] = m_dt.group(2).replace('/', '-')

                m_tm = re.search(r'(\d{2}:\d{2}:\d{2})', combined)
                if m_tm: pending_stock_trade['trade_time'] = m_tm.group(1)

                i = j
                continue

            if '佣金:' in line:
                current_fees = parse_fee_line(line)
                i += 1; continue

            i += 1

        if pending_stock_trade:
            pending_stock_trade['fees'] = current_fees
            tx_transactions.append(pending_stock_trade)

        # 合并交易和资金流水, 统一去重
        all_tx = tx_transactions + cf_transactions
        deduped = {}
        for t in all_tx:
            key = (t['direction'], t['symbol'], t['trade_date'],
                   round(t.get('amount', 0) or 0, 2))
            if key not in deduped:
                deduped[key] = t
        data['transactions'] = list(deduped.values())

        # 费用合计
        for label, key in [('成交金額合計', 'total_trade_amount_hkd'), ('佣金合計', 'total_commission_hkd'),
                           ('平台使用費合計', 'total_platform_fee_hkd'), ('交收費合計', 'total_settlement_fee_hkd'),
                           ('印花稅合計', 'total_stamp_duty_hkd'), ('交易費合計', 'total_trade_fee_hkd'),
                           ('證監會徵費合計', 'total_regulatory_fee_hkd'), ('財匯局徵費合計', 'total_levy_hkd')]:
            m = re.search(rf'{label}：\s*HKD:\s*([\d,.-]+)', full_text)
            if m: data[key] = extract_number(m.group(1)) or 0

    return data


def upsert_summary(conn, data):
    sql = """
    INSERT INTO futu_monthly_summary (
        account_no, account_name, account_type, base_currency, period,
        opening_equity_hkd, closing_equity_hkd, equity_change_hkd,
        initial_margin_required, maintenance_margin_required, available_for_trading_hkd,
        financing_balance_hkd, financing_rate, total_interest_hkd, financing_currency,
        total_hkd, total_usd, total_cnh, total_jpy, total_sgd,
        fx_usd_hkd, fx_cnh_hkd, fx_jpy_hkd, fx_sgd_hkd,
        total_trade_amount_hkd, total_commission_hkd, total_platform_fee_hkd,
        total_settlement_fee_hkd, total_stamp_duty_hkd, total_trade_fee_hkd,
        total_regulatory_fee_hkd, total_levy_hkd,
        deposit_hkd, withdrawal_hkd, fund_redemption_hkd,
        ipo_application_hkd, ipo_refund_hkd, net_cash_flow_hkd,
        prepared_date
    ) VALUES (
        %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
    )
    ON CONFLICT (account_no, period) DO UPDATE SET
        closing_equity_hkd = EXCLUDED.closing_equity_hkd,
        equity_change_hkd = EXCLUDED.equity_change_hkd,
        account_name = EXCLUDED.account_name,
        deposit_hkd = EXCLUDED.deposit_hkd,
        withdrawal_hkd = EXCLUDED.withdrawal_hkd,
        net_cash_flow_hkd = EXCLUDED.net_cash_flow_hkd,
        prepared_date = EXCLUDED.prepared_date
    """
    cur = conn.cursor()
    cur.execute(sql, (
        data['account_no'], data['account_name'], data['account_type'], data['base_currency'], data['period'],
        data['opening_equity_hkd'], data['closing_equity_hkd'], data['equity_change_hkd'],
        data['initial_margin_required'], data['maintenance_margin_required'], data['available_for_trading_hkd'],
        data['financing_balance_hkd'], data['financing_rate'], data['total_interest_hkd'], data['financing_currency'],
        data['total_hkd'], data['total_usd'], data['total_cnh'], data['total_jpy'], data['total_sgd'],
        data['fx_usd_hkd'], data['fx_cnh_hkd'], data['fx_jpy_hkd'], data['fx_sgd_hkd'],
        data['total_trade_amount_hkd'], data['total_commission_hkd'], data['total_platform_fee_hkd'],
        data['total_settlement_fee_hkd'], data['total_stamp_duty_hkd'], data['total_trade_fee_hkd'],
        data['total_regulatory_fee_hkd'], data['total_levy_hkd'],
        data['deposit_hkd'], data['withdrawal_hkd'], data['fund_redemption_hkd'],
        data['ipo_application_hkd'], data['ipo_refund_hkd'], data['net_cash_flow_hkd'],
        data['prepared_date']
    ))
    cur.close()


def upsert_financing_daily(conn, data):
    if not data['financing_daily']: return
    cur = conn.cursor()
    for row in data['financing_daily']:
        sql = """
        INSERT INTO futu_financing_daily (account_no, account_name, period, date, currency,
            financing_balance, daily_rate, daily_interest, cumulative_interest)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (account_no, date) DO UPDATE SET
            financing_balance = EXCLUDED.financing_balance,
            daily_interest = EXCLUDED.daily_interest,
            cumulative_interest = EXCLUDED.cumulative_interest
        """
        cur.execute(sql, (
            data['account_no'], data['account_name'], data['period'],
            row['date'], row['currency'],
            row['financing_balance'], row['daily_rate'],
            row['daily_interest'], row['cumulative_interest']
        ))
    cur.close()


def upsert_transactions(conn, data):
    if not data['transactions']: return
    cur = conn.cursor()
    for t in data['transactions']:
        fees = t.get('fees', {})
        sql = """
        INSERT INTO futu_transactions (
            account_no, account_name, period, asset_type,
            direction, symbol, name, exchange, currency,
            trade_date, settle_date, quantity, price,
            amount_hkd, net_amount_hkd,
            commission_hkd, platform_fee_hkd, settlement_fee_hkd,
            stamp_duty_hkd, trade_fee_hkd, regulatory_fee_hkd, levy_hkd, notes
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (account_no, period, asset_type, symbol, trade_date, direction) DO UPDATE SET
            settle_date = EXCLUDED.settle_date,
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            amount_hkd = EXCLUDED.amount_hkd,
            net_amount_hkd = EXCLUDED.net_amount_hkd,
            account_name = EXCLUDED.account_name,
            notes = EXCLUDED.notes
        """
        cur.execute(sql, (
            data['account_no'], data['account_name'], data['period'],
            t.get('asset_type', '资金'),
            t.get('direction'), t.get('symbol', ''), t.get('name', ''),
            t.get('exchange', ''), t.get('currency', 'HKD'),
            t.get('trade_date'), t.get('settle_date'),
            t.get('quantity'), t.get('price'),
            t.get('amount'), t.get('net_amount'),
            fees.get('commission'),
            fees.get('platform_fee'),
            fees.get('settlement_fee'),
            fees.get('stamp_duty'),
            fees.get('trade_fee'),
            fees.get('regulatory_fee'),
            fees.get('levy'),
            t.get('notes', '')
        ))
    cur.close()


def clean_db(conn):
    cur = conn.cursor()
    # 删除所有旧记录，重新导入
    cur.execute("DELETE FROM futu_monthly_summary")
    cur.execute("DELETE FROM futu_transactions")
    cur.execute("DELETE FROM futu_financing_daily")
    conn.commit()
    print(f"数据库已清空")
    cur.close()


# ========== 主流程 ==========
conn = psycopg2.connect(host='localhost', port=5432, user='postgres',
                        password=DB_PASSWORD, database='postgres')

print("=" * 60)
print("清理旧数据 + 重新导入 (v4 完整版)")
print("=" * 60)
clean_db(conn)

total_imported = 0
total_transactions = 0

for account_no, account_info in ACCOUNTS.items():
    for period, filename in account_info['periods'].items():
        pdf_path = os.path.join(PDF_DIR, filename)
        print(f"\n处理: {account_no} {period} -> {filename}")

        try:
            data = parse_futu_pdf(pdf_path, account_info.get('password'), fallback_period=period)
        except Exception as e:
            print(f"  解析失败: {e}")
            import traceback; traceback.print_exc()
            continue

        print(f"  账户: {data['account_name']} ({data['account_no']})")
        print(f"  期末净值: {data['closing_equity_hkd']:,.2f} HKD")
        print(f"  资金流水+交易: {len(data['transactions'])} 条")
        print(f"  融资日息: {len(data['financing_daily'])} 天")

        # 分类统计
        dir_counts = {}
        for t in data['transactions']:
            d = t['direction']
            dir_counts[d] = dir_counts.get(d, 0) + 1
        for d, c in sorted(dir_counts.items()):
            print(f"    - {d}: {c}条")

        try:
            upsert_summary(conn, data)
            upsert_financing_daily(conn, data)
            upsert_transactions(conn, data)
            conn.commit()
            print(f"  -> 入库成功! ({len(data['transactions'])}条)")
            total_imported += 1
            total_transactions += len(data['transactions'])
        except Exception as e:
            conn.rollback()
            print(f"  -> 入库失败: {e}")
            import traceback; traceback.print_exc()

conn.close()
print(f"\n{'='*60}")
print(f"共导入 {total_imported} 个月结单, {total_transactions} 条交易/流水")
print(f"{'='*60}")
