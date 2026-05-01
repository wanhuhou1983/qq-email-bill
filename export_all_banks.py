#!/usr/bin/env python3
"""
信用卡账单统一导出器 - 12家银行 最近3个月
输出单个Excel，每银行一个sheet，按持卡人分组
"""
import re
import os
import sys
import json
import subprocess
import time
import glob
import base64
import io
import warnings
from datetime import datetime, timedelta
from pathlib import Path

warnings.filterwarnings('ignore')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import pandas as pd
from bs4 import BeautifulSoup

# ============================================================
# 配置
# ============================================================
WORKSPACE = r'c:\Users\linhu\WorkBuddy\20260424010651'
DESKTOP = os.path.join(os.path.expanduser('~'), 'Desktop')
OUTPUT_FILE = os.path.join(DESKTOP, f'信用卡账单汇总_12家_{datetime.now().strftime("%Y%m%d_%H%M")}.xlsx')
QQ_EMAIL_ACCOUNT = os.getenv('QQ_EMAIL_ACCOUNT', '17501073747@qq.com')
QQ_EMAIL_AUTH_CODE = os.getenv('QQ_EMAIL_AUTH_CODE', 'xqkrzjzjvzuzbdbc')

# 标准列名（统一字段）
STD_COLS = ['bank_code', 'bank_name', 'cardholder', 'card_last4', 'trans_date', 
            'post_date', 'description', 'amount', 'currency', 'trans_type',
            'bill_month', 'source']

# 银行配置
BANKS = {
    # === 7家有Skill的银行 ===
    'ABC':   {'name': '农业银行',     'folder': '农业银行',     'skill_dir': 'abc-creditcard-bill'},
    'BOCOM': {'name': '交通银行',     'folder': '交通银行',     'skill_dir': 'bocom-creditcard-bill'},
    'CCB':   {'name': '建设银行',     'folder': '建设银行',     'skill_dir': 'ccb-creditcard-bill'},
    'CGB':   {'name': '广发银行',     'folder': '广发银行',     'skill_dir': 'cgb-creditcard-bill',
               'fetch_script': 'get-latest-bill.js', 'parse_script': 'parse-cgb.py'},
    'CITIC': {'name': '中信银行',     'folder': '中信银行',     'skill_dir': 'citic-creditcard-bill'},
    'CMB':   {'name': '招商银行',     'folder': '招商银行',     'skill_dir': 'cmb-creditcard-bill'},
    'ICBC':  {'name': '工商银行',     'folder': '工商银行',     'skill_dir': 'icbc-creditcard-bill'},
    # === 5家手动处理的银行 ===
    'PAB':   {'name': '平安银行',     'folder': '平安银行',     'type': 'html'},
    'CEB':   {'name': '光大银行',     'folder': '光大银行',     'type': 'html'},
    'CMBC':  {'name': '民生银行',     'folder': '民生银行',     'type': 'html_gb18030'},
    'CZB':   {'name': '浙商银行',     'folder': '浙商银行',     'type': 'html_qp'},
    'BOC':   {'name': '中国银行',     'folder': '中国银行',     'type': 'pdf_mineru'},
}

# ============================================================
# 工具函数
# ============================================================

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def run_node(script, args='', cwd=None):
    """运行 Node.js 脚本"""
    if cwd is None:
        cwd = WORKSPACE
    cmd = f'node {script} {args}'.strip()
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, 
                          encoding='utf-8', errors='replace', timeout=120)
    return result.stdout, result.stderr, result.returncode

def run_python(script, args='', cwd=None):
    """运行 Python 脚本"""
    if cwd is None:
        cwd = WORKSPACE
    py = r'C:\Users\linhu\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
    cmd = f'{py} {script} {args}'.strip()
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd,
                          encoding='utf-8', errors='replace', timeout=120)
    return result.stdout, result.stderr, result.returncode


def fetch_email_by_imap(folder_name, count=3):
    """
    通过QQ邮箱IMAP(使用imapflow库)拉取最新N封邮件
    返回: [email_data_dict, ...]
    """
    fetch_script = os.path.join(WORKSPACE, '_fetch_emails.cjs')
    
    script_code = r'''
"use strict";
const { ImapFlow } = require('imapflow');
const fs = require('fs');

async function main() {
  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: { 
      user: process.env.QQ_EMAIL_ACCOUNT || "''' + QQ_EMAIL_ACCOUNT + r'''", 
      pass: process.env.QQ_EMAIL_AUTH_CODE || "''' + QQ_EMAIL_AUTH_CODE + r'''" 
    },
    logger: false
  });

  await client.connect();
  
  // 打开目标文件夹（在 其他文件夹 下）
  const targetFolder = '"其他文件夹/''' + folder_name + r'''"';
  let lock;
  try {
    lock = await client.mailboxOpen(targetFolder, { readOnly: true });
  } catch(e) {
    // 尝试直接打开
    try {
      lock = await client.mailboxOpen('"' + ''' + folder_name + r''' + '"', { readOnly: true });
    } catch(e2) {
      console.log(JSON.stringify({ error: "无法打开文件夹: " + e2.message }));
      await client.logout();
      return;
    }
  }

  const total = lock.exists;
  const take = Math.min(total, parseInt(process.argv[2]) || ''' + str(count) + ''');
  const startSeq = total - take + 1;
  
  const results = [];
  for (let i = startSeq; i <= total; i++) {
    try {
      const msg = await client.fetchOne(i, { source: true, envelope: true, structure: true });
      results.push({
        subject: msg.envelope.subject || '',
        date: msg.envelope.date ? msg.envelope.date.toISOString() : '',
        source: msg.source.toString('utf-8'),
      });
    } catch(e) {
      // skip failed messages
    }
  }

  console.log(JSON.stringify(results));
  await client.logout();
}

main().catch(e => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
'''
    
    with open(fetch_script, 'w', encoding='utf-8') as f:
        f.write(script_code)
    
    # 设置环境变量
    env_cmd = f'$env:QQ_EMAIL_ACCOUNT="{QQ_EMAIL_ACCOUNT}"; $env:QQ_EMAIL_AUTH_CODE="{QQ_EMAIL_AUTH_CODE}"'
    run_node(f'npx -y imapflow --version 2>$null', cwd=WORKSPACE)
    
    stdout, stderr, code = run_node(fetch_script, WORKSPACE)
    
    # 清理JSON输出中的PowerShell噪音
    clean_stdout = re.sub(r'^#<CLIXML>.*?\n', '', stdout, flags=re.S)
    clean_stdout = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', clean_stdout).strip()
    
    if code != 0 or not clean_stdout or clean_stdout.startswith('{'):
        log(f"  [DEBUG] fetch stderr: {stderr[:300]}")
        
        # 尝试从stdout提取JSON
        json_match = re.search(r'\[.*\]', clean_stdout, re.DOTALL)
        if not json_match:
            return []
        clean_stdout = json_match.group(0)
    
    try:
        data = json.loads(clean_stdout)
        return data if isinstance(data, list) else []
    except Exception as e:
        log(f"  [DEBUG] JSON parse fail: {e}, got: {clean_stdout[:200]}")
        return []


def extract_html_from_email(email_data):
    """从邮件数据中提取HTML正文"""
    html = email_data.get('html', '')
    if html:
        return html
    
    body = email_data.get('body', '')
    if body:
        # 尝试找HTML片段
        html_match = re.search(r'<html[\s\S]*</html>', body, re.I)
        if html_match:
            return html_match.group(0)
    return ''

def extract_pdf_from_email(email_data):
    """从邮件中提取PDF附件(base64编码)"""
    for att in email_data.get('attachments', []):
        ct = att.get('contentType', '')
        fn = att.get('filename', '')
        if 'pdf' in ct.lower() or fn.endswith('.pdf') or ct == 'application/octet-stream':
            content_b64 = att.get('content', '')
            if content_b64:
                pdf_bytes = base64.b64decode(content_b64)
                return pdf_bytes, fn
    return None, None


def decode_base64_content(b64_str):
    """解码base64内容"""
    try:
        return base64.b64decode(re.sub(r'\s', '', b64_str))
    except:
        return None


def try_encodings(raw_bytes):
    """尝试多种编码解码字节流"""
    encodings = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']
    for enc in encodings:
        try:
            decoded = raw_bytes.decode(enc)
            if decoded and len(decoded) > 100:
                return decoded, enc
        except:
            continue
    return raw_bytes.decode('utf-8', errors='replace'), 'utf-8-fallback'


def mineru_parse(pdf_bytes, filename='bill.pdf'):
    """调用MinerU API解析PDF"""
    import requests
    
    API_URL = "https://mineru.net/api/v4/file/upload_and_extract"
    
    # 检查是否有API token
    env_path = os.path.join(os.path.expanduser('.workbuddy'))
    # 尝试从环境变量或配置文件读取token
    
    # 先尝试本地保存再调用
    tmp_pdf = os.path.join(WORKSPACE, '_tmp_bill.pdf')
    with open(tmp_pdf, 'wb') as f:
        f.write(pdf_bytes)
    
    # 使用minersu skill的方式解析
    try:
        # 直接调用mineru CLI
        out_dir = os.path.join(WORKSPACE, '_tmp_mineru_output')
        os.makedirs(out_dir, exist_ok=True)
        
        # 尝试用python脚本方式
        py = r'C:\Users\linhu\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
        
        # 写临时解析脚本
        parse_script = os.path.join(WORKSPACE, '_mineru_parse_tmp.py')
        with open(parse_script, 'w', encoding='utf-8') as f:
            f.write(f'''
import sys
sys.path.insert(0, r"C:\\Users\\linhu\\.workbuddy\\skills\\mineru")
try:
    from mineru_api import MinerUAPI
    api = MinerUAPI()
    result = api.parse_file("{tmp_pdf}", output_dir=r"{out_dir}")
    print(result)
except Exception as e:
    print(f"ERROR: {{e}}")
''')
        
        stdout, stderr, rc = run_python(parse_script)
        
        # 检查输出目录
        md_files = glob.glob(os.path.join(out_dir, '**/*.md'), recursive=True)
        json_files = glob.glob(os.path.join(out_dir, '**/*.json'), recursive=True)
        
        if md_files:
            with open(md_files[0], 'r', encoding='utf-8') as f:
                return f.read(), 'md'
        elif json_files:
            with open(json_files[0], 'r', encoding='utf-8') as f:
                data = json.load(f)
                return json.dumps(data, ensure_ascii=False, indent=2), 'json'
        else:
            return None, None
            
    except Exception as e:
        log(f"  MinERU 解析异常: {e}")
        return None, None
    finally:
        # 清理临时文件
        if os.path.exists(tmp_pdf):
            os.remove(tmp_pdf)


# ============================================================
# 各银行解析器
# ============================================================

def parse_pab_html(html_text, cardholder=None):
    """平安银行 HTML 解析"""
    soup = BeautifulSoup(html_text, 'html.parser')
    transactions = []
    
    # 找到所有卡分组
    cards = re.findall(r'<strong>([^<]+?)\((\d{4})\)</strong>', html_text)
    if not cards:
        # 备用模式
        cards = [('未知', '')]
    
    # 提取表格行
    tables = soup.find_all('table')
    for table in tables:
        rows = table.find_all('tr')
        current_card = ''
        for row in rows:
            cols = row.find_all(['td', 'th'])
            if len(cols) < 4:
                continue
            
            texts = [c.get_text(strip=True) for c in cols]
            
            # 检测卡分组标题
            strongs = row.find_all('strong')
            if strongs:
                m = re.search(r'\((\d{4})\)', strongs[0].get_text())
                if m:
                    current_card = m.group(1)
                    continue
            
            # 交易行: 日期 | 日期 | 描述 | 金额
            if len(texts) >= 4:
                trans_d, post_d, desc, amt = texts[0], texts[1], texts[2], texts[3]
                
                # 验证格式
                amt_m = re.search(r'-?[\d,]+\.\d{2}', str(amt))
                if not amt_m:
                    continue
                
                amount = float(amt_m.group().replace(',', ''))
                
                # 推断交易类型
                if amount < 0:
                    ttype = '还款/退款'
                else:
                    ttype = '消费/支出'
                
                transactions.append({
                    'bank_code': 'PAB', 'bank_name': '平安银行',
                    'cardholder': cardholder or '吴华辉', 'card_last4': current_card or '',
                    'trans_date': trans_d, 'post_date': post_d,
                    'description': desc, 'amount': amount, 'currency': 'CNY',
                    'trans_type': ttype, 'bill_month': '', 'source': 'qq_email'
                })
    
    return pd.DataFrame(transactions)


def parse_ceb_html(html_text, cardholder=None):
    """光大银行 HTML 解析 (charset=gb2312, 紫色主题)"""
    soup = BeautifulSoup(html_text, 'html.parser')
    transactions = []
    
    rows = soup.find_all('tr')
    for row in rows:
        cols = row.find_all(['td', 'th'])
        if len(cols) < 5:
            continue
        
        texts = [re.sub(r'\s+', ' ', c.get_text(strip=True)) for c in cols]
        
        # 光大格式: 交易日 | 记账日 | 卡号 | 交易说明 | 金额
        if len(texts) >= 5:
            tdate, pdate, card, desc, amt = texts[:5]
            
            amt_clean = str(amt).strip()
            is_deposit = '(存入)' in amt_clean
            
            # 清理金额
            amt_val = re.sub(r'[^\d.\-\s]', '', amt_clean).strip()
            if not amt_val:
                continue
            
            try:
                amount = float(amt_val)
                if is_deposit:
                    amount = -abs(amount)
            except ValueError:
                continue
            
            if abs(amount) < 0.01:  # 过滤零值
                continue
            
            ttype = '还款/存入' if amount < 0 else '消费/支出'
            
            transactions.append({
                'bank_code': 'CEB', 'bank_name': '光大银行',
                'cardholder': cardholder or '吴华辉', 'card_last4': card.replace('*', '')[:4],
                'trans_date': tdate, 'post_date': pdate,
                'description': desc, 'amount': round(amount, 2),
                'currency': 'CNY', 'trans_type': ttype,
                'bill_month': '', 'source': 'qq_email'
            })
    
    return pd.DataFrame(transactions)


def parse_cmbc_html(html_text, cardholder=None):
    """民生银行 HTML 解析 (Base64 GB18030 编码)"""
    soup = BeautifulSoup(html_text, 'html.parser')
    text = soup.get_text(separator='\n')
    transactions = []
    
    # 民生银行 td 格式: 5列 (金额|卡号|交易日|记账日|描述)
    tds = soup.find_all('td')
    td_texts = [re.sub(r'\s+', ' ', t.get_text(strip=True)) for t in tds if t.get_text(strip=True)]
    
    # 按行重组（每5个td一行）
    cols_per_row = 5
    for i in range(0, len(td_texts) - cols_per_row + 1, cols_per_row):
        row = td_texts[i:i+cols_per_row]
        
        # 验证是否是交易行（第3列是日期 MM/DD 格式）
        if not re.match(r'^\d{2}/\d{2}$', str(row[2])):
            continue
        
        # 验证第1列是金额
        amt_str = str(row[0]).strip()
        if not re.match(r'^-?[\d,]+\.\d{2}$', amt_str):
            continue
        
        amount = float(amt_str.replace(',', ''))
        if abs(amount) < 0.01:
            continue
        
        ttype = '还款/入账' if amount < 0 else '消费/支出'
        
        transactions.append({
            'bank_code': 'CMBC', 'bank_name': '民生银行',
            'cardholder': cardholder or '吴华辉', 'card_last4': str(row[1])[:4],
            'trans_date': str(row[2]), 'post_date': str(row[3]),
            'description': str(row[4]), 'amount': amount,
            'currency': 'CNY', 'trans_type': ttype,
            'bill_month': '', 'source': 'qq_email'
        })
    
    return pd.DataFrame(transactions)


def parse_czb_html(html_text, cardholder=None):
    """浙商银行 HTML 解析 (QP UTF-8 编码)"""
    soup = BeautifulSoup(html_text, 'html.parser')
    transactions = []
    
    # 浙商格式: 表格行
    rows = soup.find_all('tr')
    for row in rows:
        cols = row.find_all(['td', 'th'])
        if len(cols) < 4:
            continue
        
        texts = [re.sub(r'\s+', ' ', c.get_text(strip=True)) for c in cols]
        
        # 浙商格式: 交易日 | 记账日 | 交易说明 | 金额 | 卡号
        if len(texts) >= 4:
            # 找金额列（含数字和可能的负号）
            amt_idx = None
            for idx, t in enumerate(texts):
                clean_t = t.strip()
                if re.match(r'^-?[\d,]+\.\d{2}$', clean_t) and abs(float(clean_t.replace(',',''))) >= 0.01:
                    amt_idx = idx
                    break
            
            if amt_idx is None:
                continue
            
            amount = float(texts[amt_idx].replace(',', ''))
            
            # 确定其他字段位置
            ttype = '还款/存入' if amount < 0 else '消费/支出'
            
            # 取前几个非金额字段作为日期和描述
            non_amt_fields = [t for i, t in enumerate(texts) if i != amt_idx]
            card = ''
            if len(non_amt_fields) >= 4:
                tdate, post_d, desc, card = non_amt_fields[0], non_amt_fields[1], non_amt_fields[2], non_amt_fields[-1]
            elif len(non_amt_fields) >= 3:
                tdate, post_d, desc = non_amt_fields[0], non_amt_fields[1], non_amt_fields[2]
            
            transactions.append({
                'bank_code': 'CZB', 'bank_name': '浙商银行',
                'cardholder': cardholder or '吴华辉', 'card_last4': card[:4],
                'trans_date': tdate, 'post_date': post_d,
                'description': desc, 'amount': amount,
                'currency': 'CNY', 'trans_type': ttype,
                'bill_month': '', 'source': 'qq_email'
            })
    
    return pd.DataFrame(transactions)


def parse_boc_mineru(mineru_text, fmt='md', cardholder=None):
    """中国银行 MinerU 解析结果处理"""
    transactions = []
    
    lines = mineru_text.split('\n')
    in_transactions = False
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # 检测交易区域
        if '交易' in line and ('明细' in line or '摘要' in line):
            in_transactions = True
            continue
        if in_transactions and ('本期应还' in line or '最低还款' in line or 
                                 line.startswith('*')):
            in_transactions = False
            continue
        
        if not in_transactions:
            continue
        
        # 中行格式: 日期 | 交易说明 | 存入金额 | 支出金额
        parts = re.split(r'\s{2,}', line)
        if len(parts) >= 3:
            # 尝试提取金额
            deposit = 0
            expense = 0
            
            for part in parts:
                m = re.match(r'[¥￥]?([\d,]+\.?\d*)', part)
                if m:
                    val = float(m.group(1).replace(',', ''))
                    
            transactions.append({
                'bank_code': 'BOC', 'bank_name': '中国银行',
                'cardholder': cardholder or '吴华辉', 'card_last4': '',
                'trans_date': '', 'post_date': '',
                'description': line, 'amount': 0,
                'currency': 'CNY', 'trans_type': '',
                'bill_month': '', 'source': 'mineru'
            })
    
    return pd.DataFrame(transactions)


def parse_bank_via_skill(bank_code, bank_config, count=3):
    """
    通过现有 Skill 的脚本拉取并解析
    返回标准 DataFrame
    """
    skill_dir = bank_config['skill_dir']
    skill_path = os.path.join(os.path.expanduser('~'), '.workbuddy', 'skills', skill_dir)
    scripts_dir = os.path.join(skill_path, 'scripts')
    
    # 兼容：有些skill的脚本直接在skill根目录，不在scripts子目录
    if not os.path.exists(scripts_dir) and not os.path.exists(os.path.join(skill_path, 'scripts')):
        scripts_dir = skill_path
    
    # 获取脚本名（支持自定义）
    fetch_name = bank_config.get('fetch_script', 'fetch-bill.js')
    parse_name = bank_config.get('parse_script', 'parse-bill.py')
    
    # 1. 先拉取邮件
    fetch_js = os.path.join(scripts_dir, fetch_name)
    # 也尝试在skill根目录找
    if not os.path.exists(fetch_js):
        fetch_js = os.path.join(skill_path, fetch_name)
        
    if os.path.exists(fetch_js):
        log(f"  正在拉取 {bank_config['name']} 最近{count}个月...")
        fetch_cwd = scripts_dir if os.path.isdir(scripts_dir) else skill_path
        stdout, stderr, rc = run_node(fetch_js, str(count), fetch_cwd)
        time.sleep(2)
    else:
        log(f"  ⚠️ 拉取脚本不存在: {fetch_js}")
    
    # 2. 解析账单
    parse_py = os.path.join(scripts_dir, parse_name)
    if not os.path.exists(parse_py):
        parse_py = os.path.join(skill_path, parse_name)
        
    if not os.path.exists(parse_py):
        log(f"  ⚠️ 解析脚本不存在: {parse_py}")
        return pd.DataFrame()
    
    log(f"  正在解析 {bank_config['name']}...")
    parse_cwd = scripts_dir if os.path.isdir(scripts_dir) else skill_path
    stdout, stderr, rc = run_python(parse_py, cwd=parse_cwd)
    
    # 3. 读取生成的Excel
    excel_name = f'{bank_config["name"]}信用卡消费明细.xlsx'
    excel_path = os.path.join(DESKTOP, excel_name)
    
    if os.path.exists(excel_path):
        df = pd.read_excel(excel_path, sheet_name='交易明细')
        
        # 标准化列名映射
        col_map = {}
        for col in df.columns:
            low = col.lower()
            if '交易' in col and ('日期' in col or '日' in col) and '记' not in low:
                col_map[col] = 'trans_date'
            elif '记账' in col or 'post' in low:
                col_map[col] = 'post_date'
            elif '描述' in col or '摘要' in col or '说明' in col:
                col_map[col] = 'description'
            # 优先匹配：结算/入账/统一/最终 → amount
            elif '金额' in col and any(k in col for k in ['结算', '入账', '统一', '最终']):
                col_map[col] = 'amount'
            elif '卡' in col and ('尾' in col or '后' in col or '末' in col):
                col_map[col] = 'card_last4'
            elif '类型' in col or 'type' in low:
                col_map[col] = 'trans_type'
        
        df = df.rename(columns=col_map)
        
        # 补充固定字段
        df['bank_code'] = bank_code
        df['bank_name'] = bank_config['name']
        df['cardholder'] = '吴华辉'
        df['currency'] = 'CNY'
        df['source'] = 'skill'
        df['bill_month'] = ''
        
        # 只保留标准列中存在的列
        existing_std = [c for c in STD_COLS if c in df.columns]
        df = df[existing_std]
        
        log(f"  ✅ {bank_config['name']}: {len(df)} 条记录")
        return df
    else:
        log(f"  ⚠️ Excel未生成: {excel_path}")
        log(f"     stdout: {stdout[:200]}")
        return pd.DataFrame()


def extract_html_from_email_source(email_data):
    """从邮件source中提取HTML正文"""
    source = email_data.get('source', '')
    
    # 直接找HTML部分
    html_match = re.search(r'Content-Type:\s*text/html[^\r\n]*\r?\n(?:.*?Content-Transfer-Encoding[^\r\n]*\r?\n)?\r?\n([\s\S]*?)(?=--|\r?\n\r?\nContent-Type:)', source, re.I)
    if html_match:
        raw = html_match.group(1)
        # 可能是base64或quoted-printable
        b64_match = re.match(r'\s*([A-Za-z0-9+/=\s]+)', raw.strip())
        if b64_match:
            decoded = decode_base64_content(b64_match.group(1))
            if decoded:
                text, enc = try_encodings(decoded)
                return text
        return raw
    
    # 备用：找 <html> 标签
    html_tag = re.search(r'<html[\s\S]*</html>', source, re.I | re.S)
    if html_tag:
        return html_tag.group(0)
    
    return ''

def extract_base64_from_eml(eml_text, content_type_hint=None):
    """从EML源码中提取附件的base64内容"""
    # 找PDF或其他二进制附件
    patterns = [
        r'Content-Type:\s*application/(?:pdf|octet-stream)[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\s*Content-Transfer-Encoding:\s*base64\r?\n\r?\n([A-Za-z0-9+/=\s]+?)(?=\r?\n--|\Z)',
        r'%PDF-[^\r\n]*',  # 直接找PDF magic
    ]
    
    # 特殊处理：找%PDF标记
    pdf_start = eml_text.find('%PDF')
    if pdf_start >= 0:
        # 找到PDF结束位置
        pdf_end = eml_text.find('\r\n--', pdf_start)
        if pdf_end == -1:
            pdf_end = len(eml_text)
        b64_data = eml_text[pdf_start:pdf_end].strip()
        # 清理可能的非base64字符
        b64_clean = re.sub(r'[^A-Za-z0-9+/=\s]', '', b64_data)
        if b64_clean:
            return base64.b64decode(b64_clean), 'bill.pdf'
    
    for pat in patterns:
        m = re.search(pat, eml_text, re.I | re.S)
        if m:
            data = re.sub(r'\s', '', m.group(1))
            if data:
                return base64.b64decode(data), 'attachment'
    
    return None, None


def parse_bank_manual(bank_code, bank_config, count=3):
    """手动解析银行的HTML/PDF（优先使用本地原始文件）"""
    folder = bank_config['folder']
    bank_type = bank_config.get('type', 'html')
    
    # === 本地文件优先策略 ===
    local_files = {
        'PAB':   ('pingan_raw.html',     'html'),
        'CEB':   ('guangda_raw.html',    'html'),
        'CMBC':  ('minsheng_raw.html',   'html_gb18030'),
        'CZB':   ('zheshang_raw.html',   'html_qp'),
        'BOC':   ('boc_raw.eml',         'pdf_mineru'),  # EML含PDF附件
    }
    
    fname, ftype = local_files.get(bank_code, (None, None))
    
    if fname and os.path.exists(os.path.join(WORKSPACE, fname)):
        # 使用本地已有的原始文件
        log(f"  使用本地文件: {fname}")
        filepath = os.path.join(WORKSPACE, fname)
        
        if bank_code == 'BOC':
            # BOC是EML，需要提取PDF再用MinerU
            with open(filepath, 'rb') as f:
                eml_text = f.read().decode('utf-8', errors='ignore')
            
            pdf_bytes, pdf_name = extract_base64_from_eml(eml_text)
            if pdf_bytes:
                result, fmt = mineru_parse(pdf_bytes, pdf_name or 'boc_bill.pdf')
                if result:
                    df = parse_boc_mineru(result, fmt)
                    if not df.empty:
                        all_records = [df]
        
        else:
            # HTML格式银行 → 用已验证的gen.py脚本生成Excel再读取
            gen_scripts = {
                'PAB':   ('pingan_gen.py',     '平安银行信用卡消费明细.xlsx'),
                'CEB':   ('guangda_gen.py',     '光大银行信用卡消费明细.xlsx'),
                'CMBC':  ('minsheng_gen.py',    '民生银行信用卡消费明细.xlsx'),
            }
            
            gen_script, expected_excel = gen_scripts.get(bank_code, (None, None))
            
            if gen_script and os.path.exists(os.path.join(WORKSPACE, gen_script)):
                log(f"  运行 {gen_script} ...")
                run_python(gen_script)
                
                # 查找生成的Excel（支持多种命名模式）
                import glob as glob_mod
                excel_path = None
                
                # 1. 先尝试预期路径
                if os.path.exists(os.path.join(DESKTOP, expected_excel)):
                    excel_path = os.path.join(DESKTOP, expected_excel)
                
                # 2. 再用glob模糊匹配
                if not excel_path:
                    patterns = [
                        os.path.join(DESKTOP, f'*{bank_config["name"]}*'),
                    ]
                    for pat in patterns:
                        matches = glob_mod.glob(pat)
                        for m in matches:
                            if m.endswith('.xlsx') or m.endswith('.xls'):
                                excel_path = m
                                break
                        if excel_path:
                            break
                
                if excel_path:
                    df = pd.read_excel(excel_path, sheet_name='交易明细')
                    
                    col_map = {}
                    for col in df.columns:
                        low = col.lower()
                        if '交易' in col and ('日期' in col or '日' in col) and '记' not in low:
                            col_map[col] = 'trans_date'
                        elif '记账' in col or 'post' in low:
                            col_map[col] = 'post_date'
                        elif any(k in col for k in ['描述', '摘要', '说明']):
                            col_map[col] = 'description'
                        elif '金额' in col and any(k in col for k in ['入账', '结算', '统一', '人民币']):
                            col_map[col] = 'amount'
                        elif '卡' in col and any(k in col for k in ['尾', '后', '末']):
                            col_map[col] = 'card_last4'
                        # 兜底：如果还没有amount列，找任意含"金额"的列
                    if 'amount' not in [col_map.get(c) for c in df.columns]:
                        for col in df.columns:
                            if '金额' in col:
                                col_map[col] = 'amount'
                                break
                            if '金额' in col:
                                col_map[col] = 'amount'
                    df = df.rename(columns=col_map)
                    
                    df['bank_code'] = bank_code
                    df['bank_name'] = bank_config['name']
                    df['cardholder'] = '吴华辉'
                    df['currency'] = 'CNY'
                    df['source'] = 'local_gen'
                    df['bill_month'] = ''
                    
                    existing_std = [c for c in STD_COLS if c in df.columns]
                    df = df[existing_std]
                    
                    log(f"  ✅ {bank_config['name']}: {len(df)} 条记录 (通过gen.py)")
                    return df
        
        if 'all_records' in dir() and all_records:
            return pd.concat(all_records, ignore_index=True) if len(all_records) > 1 else all_records[0]
    
    # === IMAP在线拉取（备用方案，网络不稳定时可能失败）===
    log(f"  尝试IMAP拉取 {bank_config['name']} 邮件...")
    emails = fetch_email_by_imap(folder, count=count)
    
    if not emails:
        log(f"  ⚠️ 未获取到邮件")
        return pd.DataFrame()
    
    all_records = []
    
    for email_data in emails:
        subject = email_data.get('subject', '')
        log(f"  处理: {subject[:40]}")
        
        if bank_type == 'pdf_mineru':
            # PDF附件 -> MinerU
            source = email_data.get('source', '')
            pdf_bytes, fname = extract_base64_from_eml(source)
            
            if pdf_bytes:
                result, fmt = mineru_parse(pdf_bytes, fname or 'boc_bill.pdf')
                if result:
                    df = parse_boc_mineru(result, fmt)
                    if not df.empty:
                        all_records.append(df)
        else:
            # HTML解析
            source = email_data.get('source', '')
            
            # 先尝试直接从source提取HTML
            html = extract_html_from_email_source(email_data)
            
            # 如果没找到，可能整个body就是HTML
            if not html and '<html' in source.lower():
                # 提取body部分
                body_match = re.search(r'<body[^>]*>([\s\S]*?)</body>', source, re.I | re.S)
                if body_match:
                    html = body_match.group(1)
            
            if not html:
                # 尝试Base64解码
                b64_match = re.search(
                    r'Content-Transfer-Encoding:\s*(?:base64|quoted-printable)\r?\n\r?\n([\s\S]+?)(?=--)',
                    source
                )
                if b64_match:
                    enc_type = 'base64' if 'base64' in b64_match.group(0).lower() else 'qp'
                    raw = b64_match.group(1)
                    
                    if enc_type == 'base64':
                        decoded = decode_base64_content(raw)
                        if decoded:
                            text, enc = try_encodings(decoded)
                            if '<html' in text.lower():
                                html = text
                    else:
                        # QP decode
                        import quopri
                        decoded = quopri.decodestring(raw.encode()).decode(errors='ignore')
                        if '<html' in decoded.lower():
                            html = decoded
            
            if html:
                parser_map = {
                    'html_gb18030': parse_cmbc_html,
                    'html': parse_ceb_html,
                    'html_qp': parse_czb_html,
                }
                
                parser = parser_map.get(bank_type, lambda h, **kw: pd.DataFrame())
                
                # 平安银行用专用parser
                if bank_code == 'PAB':
                    parser = parse_pab_html
                
                df = parser(html, cardholder='吴华辉')
                
                if not df.empty:
                    df['bill_month'] = extract_bill_month(subject)
                    all_records.append(df)
    
    if all_records:
        combined = pd.concat(all_records, ignore_index=True)
        log(f"  ✅ {bank_config['name']}: {len(combined)} 条记录")
        return combined
    else:
        log(f"  ⚠️ 未解析到任何交易记录")
        return pd.DataFrame()


def extract_bill_month(subject):
    """从邮件主题提取账单月份"""
    months = {
        '一月': '01', '二月': '02', '三月': '03', '四月': '04',
        '五月': '05', '六月': '06', '七月': '07', '八月': '08',
        '九月': '09', '十月': '10', '十一月': '11', '十二月': '12',
        '1月': '01', '2月': '02', '3月': '03', '4月': '04',
        '5月': '05', '6月': '06', '7月': '07', '8月': '08',
        '9月': '09', '10月': '10', '11月': '11', '12月': '12',
    }
    for cn, num in months.items():
        if cn in subject:
            year = datetime.now().year
            m = re.search(r'(20\d{2})', subject)
            if m:
                year = int(m.group(1))
            return f"{year}-{num}"
    
    # 也尝试匹配 YYYY-MM 或 YYYYMM
    m = re.search(r'(20\d{2})[-/]?(0?[1-9]|1[0-2])', subject)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    
    return ''


# ============================================================
# 主流程
# ============================================================

def main():
    log("=" * 60)
    log("信用卡账单统一导出器 - 12家银行 最近3个月")
    log("=" * 60)
    
    all_sheets = {}  # bank_code -> DataFrame
    summary_data = []
    
    for bank_code, config in BANKS.items():
        log(f"\n{'─' * 50}")
        log(f">>> [{bank_code}] {config['name']}")
        log(f"{'─' * 50}")
        
        try:
            if 'skill_dir' in config:
                # 有Skill的银行
                df = parse_bank_via_skill(bank_code, config, count=3)
            else:
                # 手动处理的银行
                df = parse_bank_manual(bank_code, config, count=3)
            
            if not df.empty:
                all_sheets[bank_code] = df
                
                total_spending = df[df['amount'] > 0]['amount'].sum() if 'amount' in df.columns else 0
                total_repay = df[df['amount'] < 0]['amount'].sum() if 'amount' in df.columns else 0
                
                summary_data.append({
                    '银行代码': bank_code,
                    '银行名称': config['name'],
                    '记录数': len(df),
                    '消费总额': round(total_spending, 2),
                    '还款总额': round(total_repay, 2),
                    '净额': round(total_spending + total_repay, 2),
                    '持卡人': df['cardholder'].iloc[0] if 'cardholder' in df.columns and len(df) > 0 else '',
                })
            else:
                log(f"  ❌ {config['name']} 无数据")
                summary_data.append({
                    '银行代码': bank_code,
                    '银行名称': config['name'],
                    '记录数': 0,
                    '消费总额': 0,
                    '还款总额': 0,
                    '净额': 0,
                    '持卡人': '',
                })
                
        except Exception as e:
            log(f"  ❌ {config['name']} 异常: {e}")
            import traceback
            traceback.print_exc()
            summary_data.append({
                '银行代码': bank_code,
                '银行名称': config['name'],
                '记录数': 0,
                '消费总额': 0,
                '还款总额': 0,
                '净额': 0,
                '持卡人': f'错误:{str(e)[:30]}',
            })
        
        time.sleep(1)  # 礼貌间隔
    
    # ================================================================
    # 输出汇总Excel
    # ================================================================
    log(f"\n{'=' * 60}")
    log(f"正在写入Excel: {OUTPUT_FILE}")
    
    with pd.ExcelWriter(OUTPUT_FILE, engine='openpyxl') as writer:
        # 汇总sheet
        summary_df = pd.DataFrame(summary_data)
        summary_df.to_excel(writer, sheet_name='00_总览', index=False)
        
        # 各银行sheet
        for bank_code, df in all_sheets.items():
            sheet_name = f"{bank_code}_{BANKS[bank_code]['name']}"[:31]
            df.to_excel(writer, sheet_name=sheet_name, index=False)
    
    log(f"\n✅ 完成！共处理 {len(all_sheets)} 家银行")
    log(f"📁 输出: {OUTPUT_FILE}")
    
    # 打印汇总表
    log("\n" + "=" * 80)
    log("汇总:")
    log("=" * 80)
    print(summary_df.to_string(index=False))


if __name__ == '__main__':
    main()
