/**
 * bank-loader/parsers/cmbc.js — 民生银行信用卡账单解析器
 *
 * 编码: Base64 + gb2312 (loader自动处理)
 * 格式: 纯文本模式，从"交易明细"区提取
 *   交易行: MM/DD MM/DD 描述 金额 卡号末4
 *   消 费 为区段头，后续行无类型前缀
 *   还 款 为区段头，后续行无类型前缀
 *   金额正=消费, 负=还款/存入
 */
"use strict";

const bank = {
  code: "CMBC",
  name: "民生银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "",
  qqFolder: "其他文件夹/民生银行",
  searchFrom: "cmbc",

  parse(html, envelope) {
    const billCycle = this._extractBillCycle(html);
    const year = billCycle ? parseInt(billCycle.slice(0, 4)) : new Date().getFullYear();
    const transactions = this._parseTransactions(html, year, billCycle);
    const billInfo = {
      billDate: null,
      dueDate: null,
      billCycle,
      cycleStart: transactions.length > 0 ? transactions[0].trans_date : null,
      cycleEnd: transactions.length > 0 ? transactions[transactions.length - 1].trans_date : null,
      cardLast4: "",
      cardholder: this.defaultCardholder,
    };
    return { billInfo, transactions };
  },

  _parseTransactions(html, year, billCycle) {
    const trans = [];
    const seen = new Set();

    // 提取纯文本
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[\t\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 截取交易明细区（从"交易明细"到"END"或"账单说明"）
    const start = text.search(/交易明细/);
    if (start < 0) return trans;
    const end = text.search(/-+END-+|账单说明|温馨提示|历史交易/);
    const section = end > start ? text.substring(start, end) : text.substring(start);

    // 提取所有行: MM/DD MM/DD 描述 金额 卡号末4
    // 金额可能为负（-731.64）或正（0.01）
    // 描述不能包含 MM/DD 模式，用 (?:(?!\d{1,2}/\d{1,2}).)* 来确保
    const rowRe = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\s+([^\d]+?)\s+(-?\d[\d,]*\.?\d*)\s+(\d{4})/g;
    let m;

    // 将当前账单的月份作为基准判断年份
    // 当前账单月份作为年份推断基准
    const billMonth = billCycle ? parseInt(billCycle.split('-')[1]) : 12;

    while ((m = rowRe.exec(section)) !== null) {
      const transMo = parseInt(m[1]);
      const transDa = parseInt(m[2]);
      const postMo = parseInt(m[3]);
      const postDa = parseInt(m[4]);
      const desc = m[5].replace(/\s+/g, "").replace(/[()（）]/g, "").substring(0, 200);
      const amount = parseFloat(m[6].replace(/,/g, ""));
      const cardLast4 = m[7];

      if (!desc || Math.abs(amount) > 5000000) continue;

      // 年份推断: 月份 > 账期月份 → 上年
      let txYear = year, postYear = year;
      if (transMo > billMonth && billMonth < 6) txYear = year - 1;
      if (postMo > billMonth && billMonth < 6) postYear = year - 1;

      const fmt = (y, mo) => (mo > 12 ? null : `${y}-${String(mo).padStart(2, "0")}`);
      const transDate = `${txYear}-${String(transMo).padStart(2, "0")}-${String(transDa).padStart(2, "0")}`;
      const postDate = `${postYear}-${String(postMo).padStart(2, "0")}-${String(postDa).padStart(2, "0")}`;

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

  _extractBillCycle(html) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const cm = text.match(/您\s*(\d{4})\s*年\s*(\d{1,2})\s*月对账单/);
    if (cm) return `${cm[1]}-${cm[2].padStart(2, "0")}`;
    const cm2 = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*电子对账单/);
    if (cm2) return `${cm2[1]}-${cm2[2].padStart(2, "0")}`;
    // fallback: 正文中的日期
    const cm3 = text.match(/(\d{4})\/\d{2}\/\d{2}\s+(\d{4})\/\d{2}\/\d{2}/);
    return null;
  },
};

module.exports = bank;
