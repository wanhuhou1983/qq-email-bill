/**
 * bank_shared.js — 通用解析工具
 * 共享给多家格式相近的银行（bocom, cgb, citic, cmb）
 */
"use strict";

/**
 * 从HTML纯文本中提取交易行
 * 支持: YYYY-MM-DD DD 或 YYYY/MM/DD / DD 格式的日期
 * 支持多组日期模式
 */
function extractTransactions(html, dateFormats) {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\t\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const trans = [];
  const seen = new Set();

  // 找交易区
  const terms = ["交易明细", "人民币账户", "消费明细", "记账日", "企业账户"];
  let start = 0;
  for (const t of terms) {
    const i = text.search(new RegExp(t));
    if (i >= 0) { start = i; break; }
  }
  const section = text.substring(start);

  // 多种日期+金额模式
  for (const fmt of dateFormats || ["yyyy-mm-dd", "yyyy/mm/dd"]) {
    const dateRe = fmt === "yyyy-mm-dd"
      ? /(\d{4})-(\d{2})-(\d{2})\s+(\d{4})-(\d{2})-(\d{2})/g
      : /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{4})\/(\d{2})\/(\d{2})/g;

    // 先试带描述后金额的完整模式: DATE DATE 描述 金额
    const rowRe = fmt === "yyyy-mm-dd"
      ? /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+([^0-9-]+?)\s+(-?\d[\d,]*\.?\d*)/g
      : /(\d{4}\/\d{2}\/\d{2})\s+(\d{4}\/\d{2}\/\d{2})\s+([^0-9-]+?)\s+(-?\d[\d,]*\.?\d*)/g;

    let m;
    while ((m = rowRe.exec(section)) !== null) {
      const td = m[1].replace(/\//g, "-");
      const pd = m[2].replace(/\//g, "-");
      const desc = m[3].replace(/\s+/g, "").substring(0, 200);
      const amount = parseFloat(m[4].replace(/,/g, ""));
      if (!desc || isNaN(amount) || Math.abs(amount) > 5000000 || Math.abs(amount) < 0.001) continue;
      const key = `${td}|${amount}|${desc.substring(0, 40)}`;
      if (seen.has(key)) continue; seen.add(key);
      trans.push({ trans_date: td, post_date: pd, description: desc, amount, card_last4: "" });
    }
    if (trans.length > 0) break;
  }

  return trans;
}

function makeBank(cfg) {
  const dateFormats = cfg.dateFormats || ["yyyy-mm-dd", "yyyy/mm/dd"];
  return {
    code: cfg.code,
    name: cfg.name,
    defaultCardholder: cfg.cardholder || "吴华辉",
    defaultCardLast4: cfg.cardLast4 || "",
    qqFolder: cfg.qqFolder,
    searchFrom: cfg.searchFrom,
    searchQueries: cfg.searchQueries,
    skipLast: cfg.skipLast || 0,
    maxEmails: cfg.maxEmails || 50,

    parse(html, envelope) {
      const transactions = extractTransactions(html, dateFormats);
      const billInfo = {
        billDate: null, dueDate: null, billCycle: null,
        cycleStart: transactions[0]?.trans_date || null,
        cycleEnd: transactions[transactions.length - 1]?.trans_date || null,
        cardLast4: "", cardholder: this.defaultCardholder,
      };
      return { billInfo, transactions };
    },
  };
}

module.exports = { extractTransactions, makeBank };
