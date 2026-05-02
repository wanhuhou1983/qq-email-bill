"use strict";
const { ImapFlow } = require("imapflow");
const { Client } = require("pg");
const fs = require("fs");

const AUTH = { user: "85657238@qq.com", pass: "nepaqqspysbncafe" };
const PG_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres";
const BANK_CODE = "CZB", BANK_NAME = "浙商银行", CARDHOLDER = "吴华辉", CARD_LAST4 = "2171";

/** QP 解码：字节 → Latin-1 → Buffer → UTF-8 */
function decodeQP(qp) {
  const cleaned = qp.replace(/=\r?\n/g, "");                    // 软换行
  const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(latin1, "binary").toString("utf-8");       // 还原真正的 UTF-8
}

/** 从原始邮件中提取 HTML 并 QP 解码 */
function extractHtml(raw) {
  // 找到 QP 编码的 HTML 部分
  // 浙商银行的邮件: Content-Type: text/html; charset=UTF-8 后跟 QP 编码
  const m = raw.match(/Content-Type: text\/html;[\s\S]*?charset=UTF-8[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--(?:\r?\n|$)|\r?\n$)/i);
  if (!m) return null;
  return decodeQP(m[1]);
}

/** 从解码后的 HTML 中解析交易明细 */
function parseTransactions(html) {
  const trans = [];
  // 浙商银行: 日期8位 YYYYMMDD
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, "").trim());
    }
    // 浙商交易明细: 5列 (交易日, 记账日, 摘要, 金额, 卡号末4)
    if (cells.length < 4) continue;

    // 找两个 8位YMD日期
    const dates = cells.filter(c => /^\d{8}$/.test(c));
    if (dates.length < 2) continue;

    // 找金额（含¥符号和可能的负号）
    let amt = null;
    for (const c of cells) {
      // ¥ -10000.00 或 ¥ 5.00 或 -¥ 10000.00
      const m2 = c.match(/[¥￥]\s*(-?\d[\d,]*\.?\d*)|(-?\d[\d,]*\.?\d*)\s*[¥￥]/);
      if (m2) {
        const valStr = (m2[1] || m2[2]).replace(/,/g, "").trim();
        const val = parseFloat(valStr);
        if (Math.abs(val) > 0 && Math.abs(val) < 5000000) {
          amt = val;
          break;
        }
      }
    }
    // 没有¥符号的金额格式
    if (amt === null) {
      for (const c of cells) {
        const m3 = c.match(/^(-?\d[\d,]*\.?\d{0,2})$/);
        if (m3) {
          const val = parseFloat(m3[1].replace(/,/g, ""));
          if (Math.abs(val) > 0 && Math.abs(val) < 5000000) {
            amt = val;
            break;
          }
        }
      }
    }

    // 找描述（含中文且不是日期/金额/卡号）
    let desc = "";
    for (const c of cells) {
      if (/[\u4e00-\u9fff]/.test(c) && !/^\d{8}$/.test(c) && c.length > 3) {
        const clean = c.replace(/[¥￥].*$/, "").trim();
        if (clean.length > 2) { desc = clean.substring(0, 200); break; }
      }
    }

    // 找卡号末4
    let cardLast4 = CARD_LAST4;
    for (const c of cells) {
      if (/^\d{4}$/.test(c) && c !== dates[0] && c !== dates[1] && c !== CARD_LAST4) {
        cardLast4 = c;
      }
      if (/^\d{4}$/.test(c) && c === CARD_LAST4) {
        cardLast4 = CARD_LAST4;
      }
    }

    // YYYYMMDD → YYYY-MM-DD
    function fmtDate(d) {
      if (!d || d.length < 8) return null;
      return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    }

    if (dates.length >= 2 && amt !== null && desc) {
      trans.push({
        trans_date: fmtDate(dates[0]),
        post_date: fmtDate(dates[1]),
        description: desc,
        amount: amt,
        card_last4: cardLast4,
      });
    }
  }

  return trans;
}

/** 解析账期信息 */
function extractBillDates(html) {
  // 找账号信息表里的日期
  // <td>20260201</td> 账单日
  // <td>20260218</td> 到期还款日
  const cells = html.match(/<td[^>]*>(\d{8})<\/td>/g) || [];
  const allDates = cells.map(c => c.replace(/<\/?td[^>]*>/g, "").trim()).filter(d => /^\d{8}$/.test(d));

  function fmt(d) {
    return d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : null;
  }

  // 通常: 信用额度, 最低还款额, 账单日, 到期日 → 4个cell
  // 账单日 = 周期最后一天（通常）
  let billDate = null, dueDate = null;

  // 找"账单日"后的日期
  const billMatch = html.match(/账单日[\s\S]*?<td[^>]*>(\d{8})<\/td>/);
  if (billMatch) billDate = fmt(billMatch[1]);

  const dueMatch = html.match(/到期还款日[\s\S]*?<td[^>]*>(\d{8})<\/td>/);
  if (dueMatch) dueDate = fmt(dueMatch[1]);

  // 账期：从交易明细的第一条日期到最后一条
  const transDates = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells2 = rowMatch[1].match(/<t[dh][^>]*>(\d{8})<\/t[dh]>/g);
    if (cells2 && cells2.length >= 2) {
      transDates.push(cells2[0].replace(/<[^>]+>/g, "").trim());
    }
  }
  const cycleStart = transDates.length ? fmt(transDates[0]) : null;
  const cycleEnd = transDates.length ? fmt(transDates[transDates.length - 1]) : null;

  return { cycleStart, cycleEnd, billDate, dueDate };
}

async function insertBill(pg, cycleStart, cycleEnd, billDate, dueDate, uid) {
  const r = await pg.query(`
    INSERT INTO credit_card_bills
      (bank_code,bank_name,cardholder,bill_date,due_date,cycle_start,cycle_end,bill_cycle,account_masked,raw_email_uid)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW()
    RETURNING id`,
    [BANK_CODE, BANK_NAME, CARDHOLDER, billDate || cycleEnd, dueDate,
     cycleStart, cycleEnd,
     billDate ? billDate.slice(0, 7) : (cycleEnd ? cycleEnd.slice(0, 7) : null),
     `****${CARD_LAST4}`, uid]);
  return r.rows[0].id;
}

function detectTransType(amount, desc) {
  const d = desc.toLowerCase();
  if (amount < 0) {
    if (d.includes("还款")) return "REPAY";
    if (d.includes("退款")) return "REFUND";
    if (d.includes("调整") || d.includes("冲正")) return "ADJUST";
    return "DEPOSIT";
  } else {
    if (d.includes("分期") && (d.includes("本金") || d.includes("摊") || d.includes("每期"))) return "INSTALLMENT_PRIN";
    if (d.includes("分期") && (d.includes("利息") || d.includes("手续费"))) return "INSTALLMENT_INT";
    if (d.includes("年费") || d.includes("滞纳金")) return "FEE";
    if (d.includes("取现") || d.includes("预借")) return "CASH_ADVANCE";
    return "SPEND";
  }
}

async function insertTrans(pg, billId, t) {
  const tt = detectTransType(t.amount, t.description);
  await pg.query(`
    INSERT INTO credit_card_transactions
      (bill_id,bank_code,cardholder,card_last4,card_type,account_masked,
       trans_date,post_date,description,category,amount,currency,trans_type,is_installment,source,raw_line_text)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'email',$15)
    ON CONFLICT (bank_code,trans_date,post_date,card_last4,description,amount) DO NOTHING`,
    [billId, BANK_CODE, CARDHOLDER, t.card_last4, "", `****${t.card_last4}`,
     t.trans_date, t.post_date, t.description, "",
     t.amount, "CNY", tt, false,
     `${t.trans_date}|${t.amount}|${t.description}`]);
}

async function main() {
  console.log("\n========== 浙商银行导入 ==========\n");

  const imap = new ImapFlow({ host:"imap.qq.com", port:993, secure:true, auth:AUTH, logger:false });
  await imap.connect();
  console.log("✅ IMAP connected");

  const targetFolder = "其他文件夹/浙商银行";
  let lock = await imap.mailboxOpen(targetFolder);
  console.log(`📬 ${targetFolder}: ${lock.exists} 封邮件\n`);

  // 搜索
  let msgs = [];
  try { msgs = await imap.search({ from:"czbank" }); } catch(e) {}
  try { msgs = [...new Set([...msgs, ...await imap.search({ subject:"对账单" })])]; } catch(e) {}
  msgs.sort((a,b)=>Number(a)-Number(b));
  console.log(`找到 ${msgs.length} 封\n`);

  if (msgs.length === 0) { await imap.logout(); return; }

  const pg = new Client(PG_URI);
  pg.connect();

  let totalInserted = 0;

  for (let i = 0; i < msgs.length; i++) {
    const uid = Number(msgs[i]);
    console.log(`[${i+1}/${msgs.length}] UID=${uid}`);

    let msg;
    try { msg = await imap.fetchOne(uid, { source:true, envelope:true }); }
    catch(e) { console.log(`  ⚠ fetch失败: ${e.message}\n`); continue; }

    const raw = msg.source.toString("utf-8");
    console.log(`  主题: ${msg.envelope.subject || ""}`);

    // 解码 QP HTML
    const decodedHtml = extractHtml(raw);
    if (!decodedHtml) { console.log("  ⚠ 无法提取HTML\n"); continue; }

    // 保存调试用
    fs.writeFileSync(`zheshang_email_${i}.html`, decodedHtml);

    // 解析账期
    const { cycleStart, cycleEnd, billDate, dueDate } = extractBillDates(decodedHtml);
    console.log(`  账期: ${cycleStart} ~ ${cycleEnd}`);
    console.log(`  账单日: ${billDate}, 到期: ${dueDate}`);

    // 解析交易
    const transactions = parseTransactions(decodedHtml);
    console.log(`  交易: ${transactions.length} 条`);

    if (transactions.length > 0) {
      for (let j = 0; j < Math.min(3, transactions.length); j++) {
        const t = transactions[j];
        console.log(`    ${t.trans_date} | ${t.amount > 0?"+":""}${t.amount} | ${t.description.substring(0,35)}`);
      }
    }
    if (transactions.length === 0) {
      console.log("  ⚠ 无交易\n");
      continue;
    }

    // 插入账单
    const billId = await insertBill(pg, cycleStart, cycleEnd, billDate, dueDate, `czb-${uid}`);
    console.log(`  账单ID: ${billId}`);

    // 插入交易
    let inserted = 0;
    for (const t of transactions) {
      const r = await pg.query(
        "SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code=$1 AND trans_date=$2 AND post_date=$3 AND card_last4=$4 AND description=$5 AND amount=$6",
        [BANK_CODE, t.trans_date, t.post_date, t.card_last4, t.description, t.amount]);
      if (r.rows[0].count === "0") {
        await insertTrans(pg, billId, t);
        inserted++;
      }
    }
    totalInserted += inserted;
    console.log(`  ✅ 新增 ${inserted} 条\n`);
  }

  pg.end();
  await imap.logout();

  console.log("==================================");
  console.log(`✅ 完成！共处理 ${msgs.length} 封，插入 ${totalInserted} 条`);

  const pg2 = new Client("postgresql://postgres:DB_PASSWORD@localhost:5432/postgres");
  pg2.connect();
  const r = await pg2.query("SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code=$1", [BANK_CODE]);
  console.log(`📊 PG 浙商银行共 ${r.rows[0].count} 条`);
  const r2 = await pg2.query("SELECT COUNT(*) FROM credit_card_bills WHERE bank_code=$1", [BANK_CODE]);
  console.log(`📋 账单头 ${r2.rows[0].count} 条`);
  pg2.end();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
