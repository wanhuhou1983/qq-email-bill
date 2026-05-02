/**
 * bank-loader/parsers/ccb.js — 建设银行信用卡账单解析器
 *
 * 编码: Base64 + UTF-8 (loader自动处理)
 * 格式: 交易日 | 记账日 | 卡号后4 | 描述 | 币种/金额 | 币种/金额
 * 金额: CNY 21.80 或 CNY -6,901.82（负号在金额前）
 * 持卡人: 赵健伟
 */
"use strict";

const bank = {
  code: "CCB",
  name: "建设银行",
  defaultCardholder: "赵健伟",
  defaultCardLast4: "6258",
  qqFolder: "其他文件夹/建设银行",
  searchFrom: "ccb",
  searchQueries: [{ from: "ccb" }, { subject: "建设银行信用卡" }, { from: "vip.ccb.com" }],

  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, envelope, transactions);
    return { billInfo, transactions };
  },

  _parseTransactions(html) {
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[\t\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const trans = [];
    const seen = new Set();

    // 交易明细区
    const idx = text.search(/交易明细/);
    if (idx < 0) return trans;
    const section = text.substring(idx);

    // 格式: YYYY-MM-DD YYYY-MM-DD 4位数字 描述 CNY 金额 CNY 金额
    // 金额可以带负号: -6,901.82
    const rowRe = /(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+([^0-9]+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
    let m;

    while ((m = rowRe.exec(section)) !== null) {
      const transDate = m[1];
      const postDate = m[2];
      const cardLast4 = m[3];
      const desc = m[4].trim().replace(/\s+/g, "").substring(0, 200);
      const amount = parseFloat(m[5].replace(/,/g, ""));

      if (!desc || Math.abs(amount) > 5000000) continue;

      const key = `${transDate}|${amount}|${desc}|${cardLast4}`;
      if (seen.has(key)) continue;
      seen.add(key);

      trans.push({
        trans_date: transDate,
        post_date: postDate,
        description: desc,
        amount: amount,
        card_last4: cardLast4,
      });
    }

    return trans;
  },

  _extractBillInfo(html, envelope, transactions) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

    // 自动识别持卡人: "尊敬的钱伟琴 女士" 或 "尊敬的赵健伟先生"（可能有空格）
    const nameMatch = text.match(/尊敬的([\u4e00-\u9fff]{2,4})\s*(?:先生|女士)/);
    const cardholder = nameMatch ? nameMatch[1] : this.defaultCardholder;

    // 账单周期: 2026年03月22日 至 2026年04月21日
    const cycleMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?至.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let cycleStart = null, cycleEnd = null;
    if (cycleMatch) {
      cycleStart = `${cycleMatch[1]}-${cycleMatch[2].padStart(2, "0")}-${cycleMatch[3].padStart(2, "0")}`;
      cycleEnd = `${cycleMatch[4]}-${cycleMatch[5].padStart(2, "0")}-${cycleMatch[6].padStart(2, "0")}`;
    }

    // 还款日: 2026年05月10日
    const dueMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?前还款/);
    let dueDate = null;
    if (dueMatch) dueDate = `${dueMatch[1]}-${dueMatch[2].padStart(2, "0")}-${dueMatch[3].padStart(2, "0")}`;

    // 账单日 = cycleEnd
    const billDate = cycleEnd;
    const billCycle = billDate ? billDate.slice(0, 7) : null;

    return { billDate, dueDate, billCycle, cycleStart, cycleEnd, cardLast4: "", cardholder };
  },
};

module.exports = bank;
