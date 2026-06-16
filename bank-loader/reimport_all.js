"use strict";
const fs = require("fs"), path = require("path"), { Client } = require("pg");
const iconv = require("iconv-lite");
const BASE = "C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails";
const PG = { host: "127.0.0.1", port: 5432, database: "family_finance", user: "postgres", password: "Quant@2026!" };

// ==================== BANK CONFIGS ====================

const BANKS = {

  // CEB 光大银行 — Base64+UTF8, HTML table
  CEB: {
    name: "光大银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary: 上期欠款 Opening Balance X 本期欠款 Closing Balance Y
      var sm = text.match(/上期欠款\s*Opening\s*Balance[^0-9]*?([\d,]+\.?\d*)/i);
      var em = text.match(/本期欠款\s*Closing\s*Balance[^0-9]*?([\d,]+\.?\d*)/i);
      var prevBal = sm ? parseFloat(sm[1].replace(/,/g,"")) : null;
      var stmtBal = em ? parseFloat(em[1].replace(/,/g,"")) : null;
      // Transactions
      var ti = text.indexOf("交易明细"); if (ti < 0) ti = text.indexOf("Transaction");
      if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { prevBalance: prevBal, statementBalance: stmtBal }, rawRowCount: rawCount } };
    },
  },

  // PAB 平安银行 — Base64+UTF8
  PAB: {
    name: "平安银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary: 本期应还金额 X 最低还款额 Y
      var bm = text.match(/本期应还金额[^0-9]*?([\d,]+\.?\d*)/);
      var stmtBal = bm ? parseFloat(bm[1].replace(/,/g,"")) : null;
      // Total spend and repay from 合计
      var tsm = text.match(/合计[^0-9]*?￥\s*(-?[\d,]+\.\d{2})/g);
      var totalSpend = null, totalRepay = null;
      if (tsm && tsm.length >= 2) {
        var v1 = parseFloat(tsm[0].replace(/[^\d.-]/g,"").replace(/,/g,""));
        var v2 = parseFloat(tsm[1].replace(/[^\d.-]/g,"").replace(/,/g,""));
        totalSpend = Math.abs(v1 > 0 ? v1 : v2);
        totalRepay = Math.abs(v1 < 0 ? v1 : v2);
      }
      // Transactions
      var ti = text.indexOf("交易明细"); if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { statementBalance: stmtBal, totalSpend, totalRepay }, rawRowCount: rawCount } };
    },
  },

  // BOCOM 交通银行 — Base64+UTF8
  BOCOM: {
    name: "交通银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary from BOCOM table format
      var prevBal = null, stmtBal = null;
      var pm = text.match(/上期应还款[^0-9]*?￥\s*([\d,]+\.\d{2})/);
      if (pm) prevBal = parseFloat(pm[1].replace(/,/g,""));
      var bm = text.match(/本期应还款[^0-9]*?￥\s*([\d,]+\.\d{2})/);
      if (bm) stmtBal = parseFloat(bm[1].replace(/,/g,""));
      // Transactions — BOCOM uses CN Y instead of CNY sometimes
      var ti = text.indexOf("交易明细"); if (ti < 0) ti = text.indexOf("记账日期");
      if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+(?:CNY|CN Y|RMB)\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { prevBalance: prevBal, statementBalance: stmtBal }, rawRowCount: rawCount } };
    },
  },

  // CITIC 中信银行 — Base64+UTF8
  CITIC: {
    name: "中信银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary: 本期应还款额 RMB X 最低还款额 RMB Y
      var bm = text.match(/本期应还款额[^0-9]*RMB\s*([\d,]+\.\d{2})/i);
      var stmtBal = bm ? parseFloat(bm[1].replace(/,/g,"")) : null;
      var mm = text.match(/最低还款额[^0-9]*RMB\s*([\d,]+\.\d{2})/i);
      var minPay = mm ? parseFloat(mm[1].replace(/,/g,"")) : null;
      // Transactions — CITIC uses RMB
      var ti = text.indexOf("交易明细"); if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+(?:CNY|RMB)\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { statementBalance: stmtBal, minPayment: minPay }, rawRowCount: rawCount } };
    },
  },

  // CMBC 民生银行 — Base64+UTF8, image-heavy
  CMBC: {
    name: "民生银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // CMBC is image-based, try to extract text
      var ti = text.indexOf("交易明细"); if (ti < 0) ti = text.indexOf("记账日");
      if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+(?:CNY|RMB)\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, rawRowCount: rawCount } };
    },
  },

  // CGB 广发银行 — Base64+UTF8
  CGB: {
    name: "广发银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary: 本期应还总额 X 最低还款额 Y
      var bm = text.match(/本期应还总额[^0-9]*?([\d,]+\.\d{2})/);
      var stmtBal = bm ? parseFloat(bm[1].replace(/,/g,"")) : null;
      // Transactions
      var ti = text.indexOf("交易明细"); if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+(?:CNY|RMB)\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { statementBalance: stmtBal }, rawRowCount: rawCount } };
    },
  },

  // CZB 浙商银行 — Base64+UTF8
  CZB: {
    name: "浙商银行",
    defaultCardholder: "吴华辉",
    decode(raw) {
      const idx = raw.indexOf("base64"); if (idx < 0) return null;
      const bp = raw.substring(idx); let bl = bp.indexOf("\r\n\r\n"); if (bl < 0) bl = bp.indexOf("\n\n");
      const b64 = bp.substring(bl+2).replace(/[^A-Za-z0-9+\/=]/g, ""); while (b64.length%4) b64 += "=";
      try { return Buffer.from(b64, "base64").toString("utf-8"); } catch(e) { return null; }
    },
    parse(html) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var nm = text.match(/尊敬的([\u4e00-\u9fa5]{2,4})(?:先生|女士)/);
      var cardholder = nm ? nm[1] : this.defaultCardholder;
      // Summary: CZB uses 本期应还金额 New Balance
      var bm = text.match(/本期应还金额\s*New\s*Balance[^0-9]*?[￥\u00a5\uffe5]\s*([\d,]+\.\d{2})/);
      if (!bm) bm = text.match(/本期应还[^0-9]*?([\d,]+\.?\d*)/);
      var stmtBal = bm ? parseFloat(bm[1].replace(/,/g,"")) : null;
      // Transactions
      var ti = text.indexOf("交易明细"); if (ti < 0) return { transactions: [], billInfo: { cardholder } };
      var section = text.substring(ti);
      var re = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.+?)\s+(?:CNY|RMB)\s+(-?\d[\d,]*\.?\d*)/g;
      var trans = [], seen = new Set(), rawCount = 0;
      var m;
      while ((m = re.exec(section)) !== null) {
        var desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
        var amt = parseFloat(m[5].replace(/,/g, ""));
        if (!desc || Math.abs(amt) > 10000000) continue;
        rawCount++;
        var cardLast4 = m[3];
        var key = m.index + "|" + cardLast4 + "|" + amt.toFixed(2);
        if (seen.has(key)) continue; seen.add(key);
        trans.push({ trans_date: m[1], post_date: m[2], description: desc, amount: amt, card_last4: cardLast4, cardholder, trans_type: amt < 0 ? "REPAY" : "SPEND" });
      }
      var cycle = trans.length > 0 ? trans[0].trans_date.substring(0,7) : null;
      return { transactions: trans, billInfo: { billDate: null, dueDate: null, billCycle: cycle, cycleStart: trans.length>0?trans[0].trans_date:null, cycleEnd: trans.length>0?trans[trans.length-1].trans_date:null, cardLast4: "", cardholder, summary: { statementBalance: stmtBal }, rawRowCount: rawCount } };
    },
  },
};

// ==================== MAIN ====================

async function processBank(code) {
  const cfg = BANKS[code];
  if (!cfg) { console.log("No config for " + code); return; }
  const dir = path.join(BASE, code);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".eml")).sort();
  console.log("\n=== " + code + " " + cfg.name + " (" + files.length + " files) ===");

  const pg = new Client(PG); await pg.connect();
  await pg.query("DELETE FROM credit_card_transactions WHERE bank_code='" + code + "'");
  await pg.query("DELETE FROM credit_card_bills WHERE bank_code='" + code + "'");

  let totalTxns = 0, totalBills = 0, warns = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf-8");
    const html = cfg.decode(raw);
    if (!html) { console.log("  SKIP " + f.substring(0,10) + " (decode)"); continue; }
    const r = cfg.parse(html);
    if (r.transactions.length === 0) { console.log("  SKIP " + f.substring(0,10) + " (0 txns)"); continue; }
    const bi = r.billInfo, txns = r.transactions;
    const cycle = bi.billCycle || (txns[0].trans_date.substring(0,7));
    const s = bi.summary || {};

    const br = await pg.query(
      "INSERT INTO credit_card_bills(bank_code,bank_name,cardholder,bill_date,bill_cycle,cycle_start,cycle_end,statement_balance,min_payment,prev_balance,new_charges,payments,raw_email_uid) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",
      [code, cfg.name, bi.cardholder, bi.billDate, cycle, bi.cycleStart, bi.cycleEnd,
       s.statementBalance, s.minPayment, s.prevBalance, s.totalSpend, s.totalRepay,
       "email-"+code+"-"+f.substring(0,6)]
    );
    const billId = br.rows[0].id;

    for (const t of txns) {
      await pg.query(
        "INSERT INTO credit_card_transactions(bill_id,bank_code,cardholder,card_last4,trans_date,post_date,description,amount,trans_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [billId, code, t.cardholder, t.card_last4, t.trans_date, t.post_date, t.description, t.amount, t.trans_type || "SPEND"]
      );
    }

    const spend = txns.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    const repay = txns.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0);
    var ok = true;
    if (s.totalSpend != null && Math.abs(spend - s.totalSpend) > 0.03) ok = false;
    if (s.totalRepay != null && Math.abs(repay - s.totalRepay) > 0.03) ok = false;
    // B logic: 本期 = 上期 + spend - repay
    if (s.prevBalance != null && s.statementBalance != null) {
      var expected = Math.round((s.prevBalance + spend - repay) * 100) / 100;
      if (Math.abs(s.statementBalance - expected) > 1.0) ok = false;
    }
    const rw = bi.rawRowCount && bi.rawRowCount !== txns.length ? " LOST=" + (bi.rawRowCount - txns.length) : "";
    if (!ok || rw) warns++;
    console.log("  " + (ok && !rw ? "[OK]" : "[WARN]") + " Bill " + billId + ": " + bi.cardholder + " " + cycle + " - " + txns.length + " txns s=" + spend.toFixed(2) + " r=" + repay.toFixed(2) + rw);
    totalTxns += txns.length; totalBills++;
  }
  console.log(code + ": " + totalBills + " bills, " + totalTxns + " txns, " + warns + " warns");
  await pg.end();
}

async function main() {
  const codes = ["CEB","PAB","BOCOM","CITIC","CMBC","CGB","CZB"];
  for (const code of codes) {
    await processBank(code);
  }
  console.log("\n=== ALL DONE ===");
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
