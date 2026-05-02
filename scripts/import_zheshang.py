"""
浙商银行信用卡账单 - 从QQ邮箱批量拉取，直接入库PostgreSQL
不经过Excel，不保留中间文件
"""
import os
import re
import json
from datetime import date
from email.header import decode_header
import imaplib
import email
from email.header import decode_header

# 配置
QQ_EMAIL = os.getenv("QQ_EMAIL_ACCOUNT")
QQ_AUTH_CODE = os.getenv("QQ_EMAIL_AUTH_CODE")
IMAP_HOST = "imap.qq.com"
IMAP_PORT = 993

# PG配置
PG_CONN = "host=localhost port=5432 user=postgres password=DB_PASSWORD dbname=postgres"

# 银行信息
BANK_CODE = "CZB"
BANK_NAME = "浙商银行"
CARDHOLDER = "吴华辉"
CARD_LAST4 = "2171"
CARD_TYPE = ""


def pg_execute(sql, params=None):
    import psycopg2
    conn = psycopg2.connect(PG_CONN)
    cur = conn.cursor()
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    conn.commit()
    cur.close()
    conn.close()


def pg_fetchone(sql, params=None):
    import psycopg2
    conn = psycopg2.connect(PG_CONN)
    cur = conn.cursor()
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    result = cur.fetchone()
    cur.close()
    conn.close()
    return result


def pg_fetchall(sql, params=None):
    import psycopg2
    conn = psycopg2.connect(PG_CONN)
    cur = conn.cursor()
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    result = cur.fetchall()
    cur.close()
    conn.close()
    return result


def decode_str(s):
    """解码email-header字符串"""
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            result.append(part)
    return "".join(result)


def find_folder(client, keyword):
    """在文件夹列表中找包含keyword的文件夹"""
    folders = list(client.list())
    for f in folders:
        if keyword.lower() in f["name"].lower():
            return f
    for f in folders:
        path = f.get("path", "")
        if keyword.lower() in path.lower():
            return f
    return None


def parse_html_content(html_content):
    """
    从浙商银行邮件HTML中解析交易明细
    返回: list of {trans_date, post_date, description, amount, card_last4}
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_content, "html.parser")
    transactions = []

    # 尝试找表格
    tables = soup.find_all("table")

    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cols = row.find_all(["td", "th"])
            if len(cols) < 4:
                continue

            # 尝试提取日期和金额
            col_texts = [c.get_text(strip=True) for c in cols]

            # 日期格式: YYYY-MM-DD 或 YYYY/MM/DD
            date_pattern = re.compile(r"(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})")
            dates_found = []
            for t in col_texts:
                m = date_pattern.search(t)
                if m:
                    dates_found.append(f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}")

            # 金额格式
            amount = None
            for t in col_texts:
                # 去掉金额中的逗号
                cleaned = t.replace(",", "").replace("，", "")
                m = re.search(r"[-+]?¥?\s*(\d+\.?\d*)", cleaned)
                if m:
                    try:
                        val = float(m.group(1).replace("¥", "").strip())
                        if "¥" in t or "¥" in cleaned:
                            if t.startswith("-"):
                                val = -val
                            amount = val
                            break
                    except:
                        pass

            # 描述：找含中文字符的非日期列
            desc = ""
            for t in col_texts:
                if re.search(r"[\u4e00-\u9fff]", t) and not date_pattern.search(t) and len(t) > 3:
                    desc = t
                    break

            if len(dates_found) >= 2 and amount is not None and abs(amount) > 0:
                trans = {
                    "trans_date": dates_found[0],
                    "post_date": dates_found[1] if len(dates_found) > 1 else dates_found[0],
                    "description": desc,
                    "amount": amount,
                    "card_last4": CARD_LAST4,
                }
                transactions.append(trans)

    # 如果表格没找到，尝试文本模式
    if not transactions:
        text = soup.get_text()
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if not line or len(line) < 8:
                continue
            # 跳过表头
            if any(k in line for k in ["交易日期", "记账日期", "交易说明", "交易摘要", "金额", "卡号", "---", "==="]):
                continue
            # 日期+金额模式
            dm = date_pattern.findall(line)
            amounts = re.findall(r"([-]?)\s*¥?\s*(\d+\.?\d*)", line.replace(",", ""))
            if len(dm) >= 2 and amounts:
                try:
                    d1 = f"{dm[0][0]}-{int(dm[0][1]):02d}-{int(dm[0][2]):02d}"
                    d2 = f"{dm[1][0]}-{int(dm[1][1]):02d}-{int(dm[1][2]):02d}"
                    # 找最大金额
                    amt_vals = []
                    for sign, val in amounts:
                        try:
                            v = float(val)
                            if sign == "-":
                                v = -v
                            amt_vals.append(v)
                        except:
                            pass
                    if amt_vals:
                        amt = max(amt_vals, key=abs)
                        # 提取描述
                        desc_match = re.sub(r"[-+]?\s*¥?\s*\d+\.?\d*", "", line)
                        desc = re.sub(r"\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2}", "", desc_match).strip(" \t\n\r*")
                        desc = desc[:200] if desc else line[:80]
                        transactions.append({
                            "trans_date": d1, "post_date": d2,
                            "description": desc, "amount": amt, "card_last4": CARD_LAST4,
                        })
                except:
                    pass

    return transactions


def normalize_amount(raw_amount):
    """
    浙商银行金额规则：
    正数=消费/支出/分期，负数=还款/存入/退款
    与统一规则一致，无需转换
    """
    return float(raw_amount)


def detect_trans_type(amount, description):
    """根据金额符号和描述判断交易类型"""
    desc = description.lower()
    if amount < 0:
        if any(k in desc for k in ["还款", "还债", "存入", "存款", "存入", "还款"]):
            return "REPAY"
        elif any(k in desc for k in ["退款", "退货", "返还"]):
            return "REFUND"
        elif any(k in desc for k in ["调整", "冲正", "更正"]):
            return "ADJUST"
        else:
            return "DEPOSIT"
    else:
        if any(k in desc for k in ["分期", "分期的", "每期摊", "本金摊"]):
            return "INSTALLMENT_PRIN"
        elif any(k in desc for k in ["利息", "分期利息", "手续费"]):
            return "INSTALLMENT_INT"
        elif any(k in desc for k in ["年费", "滞纳金", "罚款"]):
            return "FEE"
        elif any(k in desc for k in ["取现", "预借"]):
            return "CASH_ADVANCE"
        else:
            return "SPEND"


def extract_cycle_dates(html_content):
    """
    从HTML中尝试提取账期（cycle_start / cycle_end / bill_date / due_date）
    浙商银行账单通常包含在邮件正文或HTML中
    """
    date_pattern = re.compile(r"(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})")
    dates_found = date_pattern.findall(html_content)
    dates_iso = []
    for d in dates_found:
        try:
            dates_iso.append(f"{d[0]}-{int(d[1]):02d}-{int(d[2]):02d}")
        except:
            pass

    if not dates_iso:
        return None, None, None, None

    # 假设第一个日期是cycle_start，最后一个是cycle_end附近
    # 账单日通常是cycle_end后几天
    cycle_start = dates_iso[0] if dates_iso else None
    cycle_end = dates_iso[-1] if dates_iso else None

    # 尝试从文本中找"账单日"和"到期还款日"
    bill_date = None
    due_date = None
    bill_match = re.search(r"账单日[：:]\s*(\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2})", html_content)
    if bill_match:
        d = date_pattern.search(bill_match.group(1))
        if d:
            bill_date = f"{d[0]}-{int(d[1]):02d}-{int(d[2]):02d}"

    due_match = re.search(r"到期还款日[：:]\s*(\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2})", html_content)
    if due_match:
        d = date_pattern.search(due_match.group(1))
        if d:
            due_date = f"{d[0]}-{int(d[1]):02d}-{int(d[2]):02d}"

    return cycle_start, cycle_end, bill_date, due_date


def insert_bill(cycle_start, cycle_end, bill_date, due_date, raw_email_uid):
    """插入或更新账单头，返回bill_id"""
    import psycopg2
    conn = psycopg2.connect(PG_CONN)
    cur = conn.cursor()

    sql = """
        INSERT INTO credit_card_bills
            (bank_code, bank_name, cardholder, bill_date, due_date,
             cycle_start, cycle_end, account_masked, raw_email_uid)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (bank_code, bill_date, account_masked) DO UPDATE
            SET cycle_start=EXCLUDED.cycle_start,
                cycle_end=EXCLUDED.cycle_end,
                due_date=EXCLUDED.due_date,
                raw_email_uid=EXCLUDED.raw_email_uid,
                updated_at=NOW()
        RETURNING id
    """
    account_masked = f"****{CARD_LAST4}"
    cur.execute(sql, (
        BANK_CODE, BANK_NAME, CARDHOLDER,
        bill_date or cycle_end, due_date,
        cycle_start, cycle_end,
        account_masked, raw_email_uid,
    ))
    bill_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return bill_id


def insert_transactions(bill_id, transactions):
    """批量插入交易明细，返回插入条数"""
    import psycopg2
    from psycopg2.extras import execute_values

    rows = []
    for t in transactions:
        amount = normalize_amount(t["amount"])
        trans_type = detect_trans_type(amount, t["description"])
        rows.append((
            bill_id,
            BANK_CODE, CARDHOLDER, t["card_last4"], CARD_TYPE, f"****{t['card_last4']}",
            t["trans_date"], t["post_date"],
            t["description"], "",  # category留空
            amount, "CNY",
            trans_type, False, "",
            "email", None,
        ))

    if not rows:
        return 0

    sql = """
        INSERT INTO credit_card_transactions
            (bill_id, bank_code, cardholder, card_last4, card_type, account_masked,
             trans_date, post_date, description, category,
             amount, currency, trans_type, is_installment, installment_info,
             source, raw_line_text)
        VALUES %s
        ON CONFLICT (bank_code, trans_date, post_date, card_last4, description, amount) DO NOTHING
    """
    conn = psycopg2.connect(PG_CONN)
    cur = conn.cursor()
    execute_values(cur, sql, rows)
    conn.commit()
    inserted = cur.rowcount
    cur.close()
    conn.close()
    return inserted


def fetch_email_html(client, folder_path, uid):
    """从IMAP获取邮件原文"""
    try:
        client.mailboxOpen(folder_path, uid)
        msg = client.fetchOne(uid, { "source": True, "envelope": True })
        return msg.source.toString("utf-8", errors="replace"), msg.envelope
    except Exception as e:
        print(f"  ⚠ 获取邮件 {uid} 失败: {e}")
        return None, None


def fetch_all_zheshang_emails():
    """连接QQ邮箱IMAP，获取所有浙商银行账单邮件"""
    print(f"📧 连接 QQ邮箱 IMAP...")
    client = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    client.login(QQ_EMAIL, QQ_AUTH_CODE)

    # 找浙商银行相关文件夹
    status, folder_list = client.list()
    print(f"  文件夹数量: {len(folder_list)}")

    target_folder = None
    for item in folder_list:
        if isinstance(item, bytes):
            item = item.decode("utf-8", errors="replace")
        # 解析: (\HasNoChildren) "/" "其他"
        parts = item.split('"')
        if len(parts) >= 3:
            folder_name = parts[-2].strip()
            if any(k in folder_name for k in ["浙商", "其他", "zheshang"]):
                target_folder = folder_name
                print(f"  ✅ 找到目标文件夹: {folder_name}")
                break

    if not target_folder:
        # 搜索所有文件夹
        print("  🔍 搜索浙商银行相关文件夹...")
        for item in folder_list:
            if isinstance(item, bytes):
                item = item.decode("utf-8", errors="replace")
            if "zheshang" in item.lower() or "浙商" in item:
                parts = item.split('"')
                if len(parts) >= 3:
                    target_folder = parts[-2].strip()
                    print(f"  ✅ 找到: {target_folder}")
                    break

    if not target_folder:
        print("  ⚠ 未找到浙商专属文件夹，搜索所有文件夹...")
        # 在所有文件夹中搜索包含"浙商"或"czbank"的邮件
        for item in folder_list:
            if isinstance(item, bytes):
                item = item.decode("utf-8", errors="replace")
            parts = item.split('"')
            if len(parts) >= 3:
                folder_name = parts[-2].strip()
            else:
                folder_name = item.strip()
            print(f"  检查文件夹: {folder_name}")

            try:
                status, count = client.select(f'"{folder_name}"', readonly=True)
                if status != "OK":
                    continue
                count = int(count[0]) if count and count[0] else 0
                if count == 0:
                    continue

                # 搜索浙商银行邮件
                status, search_results = client.search(None, 'FROM "czbank"')
                uids = search_results[0].split() if search_results and search_results[0] else []

                if uids:
                    print(f"  ✅ 文件夹 '{folder_name}' 中找到 {len(uids)} 封浙商银行邮件")
                    return folder_name, uids, client
            except Exception as e:
                continue

        print("❌ 未找到任何浙商银行账单邮件")
        client.logout()
        return None, [], None

    # 打开目标文件夹
    status, count = client.select(f'"{target_folder}"', readonly=True)
    if status != "OK":
        print(f"❌ 无法打开文件夹: {target_folder}")
        client.logout()
        return None, [], None

    count = int(count[0]) if count and count[0] else 0
    print(f"  文件夹 '{target_folder}' 共有 {count} 封邮件")

    # 搜索浙商银行邮件（多种方式）
    all_uids = []

    search_queries = [
        'FROM "czbank"',
        'FROM "浙商银行"',
        'SUBJECT "对账单"',
        'SUBJECT "账单"',
    ]

    for q in search_queries:
        try:
            status, search_results = client.search(None, q)
            if status == "OK" and search_results and search_results[0]:
                uids = [int(u) for u in search_results[0].split() if u]
                if uids:
                    print(f"  搜索 '{q}': 找到 {len(uids)} 封")
                    all_uids.extend(uids)
        except Exception as e:
            print(f"  搜索 '{q}' 失败: {e}")

    # 去重
    all_uids = sorted(set(all_uids))
    print(f"  📬 共找到 {len(all_uids)} 封浙商银行相关邮件")
    return target_folder, all_uids, client


def process_email(client, folder_path, uid):
    """处理单封邮件，返回交易明细列表"""
    try:
        status, msg_data = client.fetch(str(uid), "(RFC822)")
        if status != "OK":
            return None, None, None

        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        # 获取邮件日期
        email_date = msg.get("Date", "")
        email_uid = f"czb-{uid}-{email_date[:16]}"

        # 提取HTML内容
        html_content = ""
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                charset = part.get_content_charset() or "utf-8"
                if content_type == "text/html":
                    try:
                        html_content = part.get_payload(decode=True).decode(charset, errors="replace")
                        break
                    except:
                        pass
        else:
            charset = msg.get_content_charset() or "utf-8"
            try:
                html_content = msg.get_payload(decode=True).decode(charset, errors="replace")
            except:
                pass

        if not html_content:
            return None, None, email_uid

        # 解析账期
        cycle_start, cycle_end, bill_date, due_date = extract_cycle_dates(html_content)

        # 解析交易
        transactions = parse_html_content(html_content)

        return transactions, (cycle_start, cycle_end, bill_date, due_date), email_uid

    except Exception as e:
        print(f"  ⚠ 处理邮件 {uid} 失败: {e}")
        return None, None, None


def main():
    print("=" * 50)
    print("浙商银行信用卡账单 - QQ邮箱 → PostgreSQL 直导")
    print("=" * 50)

    if not QQ_EMAIL or not QQ_AUTH_CODE:
        print("❌ 未设置 QQ_EMAIL_ACCOUNT 或 QQ_EMAIL_AUTH_CODE 环境变量")
        return

    folder_path, uids, client = fetch_all_zheshang_emails()

    if not uids:
        print("❌ 没有找到浙商银行邮件")
        if client:
            client.logout()
        return

    print(f"\n📥 开始处理 {len(uids)} 封邮件...\n")

    total_inserted = 0
    total_emails = len(uids)
    processed = 0

    for uid in uids:
        processed += 1
        print(f"[{processed}/{total_emails}] 处理邮件 UID={uid} ...")

        result = process_email(client, folder_path, uid)
        transactions, cycle_info, email_uid = result

        if not transactions or len(transactions) == 0:
            print(f"  ⚠ 未解析到交易，跳过")
            continue

        cycle_start, cycle_end, bill_date, due_date = cycle_info or (None, None, None, None)

        # 如果没有找到账期，用交易日期推断
        if not cycle_start or not cycle_end:
            trans_dates = [t["trans_date"] for t in transactions]
            all_dates = sorted(set(trans_dates))
            if all_dates:
                # 假设最后一个日期所在月份的上一个月份第一天是cycle_start
                import datetime
                last_date = datetime.date.fromisoformat(all_dates[-1])
                first_date = datetime.date.fromisoformat(all_dates[0])
                # 简单取第一个和最后一个交易日的范围
                cycle_start = str(first_date)
                cycle_end = str(last_date)

        print(f"  账期: {cycle_start} ~ {cycle_end}")
        print(f"  账单日: {bill_date}, 到期日: {due_date}")
        print(f"  交易数: {len(transactions)}")

        # 插入账单头
        try:
            bill_id = insert_bill(cycle_start, cycle_end, bill_date, due_date, email_uid)
            print(f"  账单ID: {bill_id}")
        except Exception as e:
            print(f"  ⚠ 插入账单失败: {e}")
            continue

        # 插入交易明细
        try:
            inserted = insert_transactions(bill_id, transactions)
            total_inserted += inserted
            print(f"  ✅ 新增 {inserted} 条（去重后）")
        except Exception as e:
            print(f"  ⚠ 插入交易失败: {e}")

        print()

    if client:
        client.logout()

    print("=" * 50)
    print(f"✅ 完成！共处理 {total_emails} 封邮件，插入 {total_inserted} 条交易")
    print("=" * 50)

    # 验证
    result = pg_fetchone("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code=%s", (BANK_CODE,))
    print(f"📊 PostgreSQL 中浙商银行共 {result[0]} 条交易记录")


if __name__ == "__main__":
    main()
