/**
 * bank-loader/parsers/boc.js — 中国银行信用卡账单解析器
 *
 * 特殊处理: 邮件含PDF附件，需pdfplumber提取文本
 * 格式: 存入/支出分两列（都为正数）
 *  存入 → 负(-), 支出 → 正(+)
 * 持卡人: 吴华辉, 卡号: 0177
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PYTHON = path.join(__dirname, "..", "..", ".venv", "Scripts", "python.exe");
const PLUMBER_SCRIPT = path.join(__dirname, "boc_pdf.py");

// 写入pdfplumber解析脚本
function ensureHelper() {
  if (!fs.existsSync(PLUMBER_SCRIPT)) {
    fs.writeFileSync(PLUMBER_SCRIPT, `
import sys, json
import pdfplumber

pdf_path = sys.argv[1]
result = {"transactions": [], "billDate": None, "dueDate": None}

with pdfplumber.open(pdf_path) as doc:
    for page in doc.pages:
        tables = page.extract_tables()
        for table in tables:
            for row in table:
                if not row: continue
                cells = [c.strip() if c else "" for c in row]
                # 提取账单日/到期还款日
                for c in cells:
                    if "到期还款日" in c and len(cells) >= 4:
                        for c2 in cells:
                            if c2.count("-") == 2 and len(c2) == 10:
                                result["dueDate"] = c2
                    if "账单日" in c and len(cells) >= 4:
                        for c2 in cells:
                            if c2.count("-") == 2 and len(c2) == 10:
                                result["billDate"] = c2
                # 找含中文的交易行
                if len(cells) >= 6:
                    try:
                        td = cells[0].strip()
                        pd = cells[1].strip()
                        card = cells[2].strip()
                        desc = cells[3].strip()
                        deposit = cells[4].strip()
                        expenditure = cells[5].strip()
                        if td.count("-") == 2 and len(td) == 10:
                            amt = 0
                            if expenditure:
                                amt = float(expenditure.replace(",",""))
                            elif deposit:
                                amt = -float(deposit.replace(",",""))
                            if amt != 0:
                                result["transactions"].append({
                                    "trans_date": td, "post_date": pd,
                                    "card_last4": card, "description": desc,
                                    "amount": amt
                                })
                    except: pass

print(json.dumps(result, ensure_ascii=False))
`);
  }
}

const bank = {
  code: "BOC",
  name: "中国银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "0177",
  qqFolder: "其他文件夹/中国银行",
  searchFrom: "boc",
  searchQueries: [{ from: "boc" }, { subject: "中国银行信用卡" }],

  parse(html, envelope) {
    // BOC不走HTML解析，通过PDF附件
    // 但loader会传email raw给parser，这里返回空
    // 真正的解析在loader的fetch回调
    return { transactions: [], billInfo: {} };
  },
};

// 扩展: 从email raw中提取PDF并解析
bank.parseFromRaw = function (raw) {
  ensureHelper();
  // 提取PDF附件
  const pdfStart = raw.search(/Content-Type:\s*application\/octet-stream/i);
  if (pdfStart < 0) return null;

  const pdfPart = raw.substring(pdfStart);
  const pdfBody = pdfPart.match(/\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/);
  if (!pdfBody) return null;

  const b64 = pdfBody[1].replace(/[^A-Za-z0-9+/=]/g, "");
  const pdfBuf = Buffer.from(b64, "base64");
  const tmpPath = path.join(__dirname, "..", "..", "_boc_tmp.pdf");
  fs.writeFileSync(tmpPath, pdfBuf);

  // 用pdfplumber解析
  const r = spawnSync(PYTHON, [PLUMBER_SCRIPT, tmpPath]);
  try { fs.unlinkSync(tmpPath); } catch (e) {}
  if (r.error || r.status !== 0) return null;

  const data = JSON.parse(r.stdout.toString());
  const billInfo = {
    billDate: data.billDate,
    dueDate: data.dueDate,
    billCycle: data.billDate ? data.billDate.slice(0, 7) : null,
    cycleStart: data.transactions?.[0]?.trans_date || null,
    cycleEnd: data.transactions?.[data.transactions.length - 1]?.trans_date || null,
    cardLast4: this.defaultCardLast4,
    cardholder: this.defaultCardholder,
  };
  return { transactions: data.transactions, billInfo };
};

module.exports = bank;
