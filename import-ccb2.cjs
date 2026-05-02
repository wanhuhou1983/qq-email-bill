/**
 * import-ccb2.cjs — 从第二个QQ邮箱(hhwu1983)导入CCB(钱伟琴)
 */
"use strict";
const { ImapFlow } = require("imapflow");
const { Client } = require("pg");
const iconv = require("iconv-lite");

const QQ = { user: "hhwu1983@qq.com", pass: "uihsavyndbpscccc" };
const PG_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres";

const PG = new Client(PG_URI);

function b64decode(raw) {
  const m = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\w+:|\r?\n$)/i);
  if (!m) return null;
  const b64 = m[1].replace(/[^A-Za-z0-9+/=]/g, "");
  return iconv.decode(Buffer.from(b64, "base64"), "utf-8");
}

async function main() {
  await PG.connect();
  const imap = new ImapFlow({ host: "imap.qq.com", port: 993, secure: true, auth: QQ, logger: false });
  await imap.connect();
  await imap.mailboxOpen("INBOX");

  let totalInserted = 0, billCount = 0;

  for (let i = 1; i <= imap.mailbox.exists; i++) {
    const msg = await imap.fetchOne(i, { source: true, envelope: true });
    const subj = msg.envelope?.subject || "";
    if (!subj.includes("建设银行")) continue;

    const raw = msg.source.toString("binary");
    const html = b64decode(raw);
    if (!html) { console.log("跳过:", subj); continue; }

    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    // 提取持卡人
    const nameMatch = text.match(/尊敬的([\u4e00-\u9fff]{2,4})(?:先生|女士)/);
    const cardholder = nameMatch ? nameMatch[1] : "钱伟琴";

    // 提取账单信息
    const cycleMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?至.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let cycleStart = null, cycleEnd = null;
    if (cycleMatch) {
      cycleStart = `${cycleMatch[1]}-${cycleMatch[2].padStart(2,"0")}-${cycleMatch[3].padStart(2,"0")}`;
      cycleEnd = `${cycleMatch[4]}-${cycleMatch[5].padStart(2,"0")}-${cycleMatch[6].padStart(2,"0")}`;
    }

    const dueMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?前还款/);
    let dueDate = null;
    if (dueMatch) dueDate = `${dueMatch[1]}-${dueMatch[2].padStart(2,"0")}-${dueMatch[3].padStart(2,"0")}`;

    const billCycle = cycleEnd ? cycleEnd.slice(0, 7) : null;

    // 解析交易
    const section = text.substring(text.search(/交易明细/) || 0);
    const trans = [];
    const seen = new Set();

    const rowRe = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+([^0-9]+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
    let m;
    while ((m = rowRe.exec(section)) !== null) {
      const amt = parseFloat(m[5].replace(/,/g, ""));
      const desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
      if (!desc || Math.abs(amt) > 5000000) continue;
      const key = `${m[1]}|${amt}|${desc.substring(0, 30)}`;
      if (seen.has(key)) continue; seen.add(key);
      trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: m[3] });
    }

    if (trans.length === 0) { console.log(`  ${subj}: 无交易`); continue; }

    // 入库
    const billR = await PG.query(
      `INSERT INTO credit_card_bills (bank_code,bank_name,cardholder,bill_date,due_date,cycle_start,cycle_end,bill_cycle,account_masked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW() RETURNING id`,
      ["CCB", "建设银行", cardholder, cycleEnd, dueDate, cycleStart, cycleEnd, billCycle, "****" + (trans[0]?.card_last4 || "")]
    );
    const billId = billR.rows[0].id;

    let inserted = 0;
    for (const t of trans) {
      try {
        const r = await PG.query(
          `INSERT INTO credit_card_transactions (bill_id,bank_code,cardholder,card_last4,account_masked,trans_date,post_date,description,amount,currency,trans_type,source,raw_line_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'email_ccb2',$12)
           ON CONFLICT (bank_code,trans_date,post_date,card_last4,description,amount) DO NOTHING`,
          [billId, "CCB", cardholder, t.card_last4, "****" + t.card_last4, t.trans_date, t.post_date, t.description, t.amount, "CNY", t.amount > 0 ? "SPEND" : "REPAY",
           `${t.trans_date}|${t.amount}|${t.description}`]
        );
        if (r.rowCount > 0) inserted++;
      } catch (e) { /* dup */ }
    }

    console.log(`${subj.substring(0,35)}: ${trans.length}条 → ${inserted}新增 [${cardholder}]`);
    totalInserted += inserted;
    billCount++;
  }

  console.log(`\n✅ 完成! ${billCount}个账单, ${totalInserted}条新增`);
  await imap.logout();
  await PG.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
