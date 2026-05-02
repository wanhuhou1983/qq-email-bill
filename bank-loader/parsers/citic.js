/**
 * bank-loader/parsers/citic.js — 中信银行信用卡账单
 *
 * 编码: QP + GBK
 * 日期: YYYYMMDD（8位无分隔符）
 * 格式: YYYYMMDD YYYYMMDD 卡号 描述 CNY 金额 CNY 金额
 * 卡号: 1696, 持卡人: 吴华辉
 */
"use strict";

const bank = {
  code: "CITIC", name: "中信银行", defaultCardholder: "吴华辉", defaultCardLast4: "1696",
  qqFolder: "其他文件夹/中信银行", searchFrom: "citic",

  parse(html, envelope) {
    const text = html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/[\t\r\n]/g," ").replace(/\s+/g," ").trim();
    const trans = [];
    const seen = new Set();

    const start = text.search(/主卡/);
    const section = start >= 0 ? text.substring(start) : text;

    // YYYYMMDD YYYYMMDD 4位卡号 + 描述 + CNY + 金额...
    const rowRe = /(\d{4})(\d{2})(\d{2})\s+(\d{4})(\d{2})(\d{2})\s+(\d{4})\s+([^0-9]+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
    let m;

    while ((m = rowRe.exec(section)) !== null) {
      const td = `${m[1]}-${m[2]}-${m[3]}`;
      const pd = `${m[4]}-${m[5]}-${m[6]}`;
      const card = m[7];
      const desc = m[8].replace(/\s+/g,"").substring(0,200);
      const amount = parseFloat(m[9].replace(/,/g,""));

      if (!desc || isNaN(amount) || Math.abs(amount) > 5000000) continue;
      const key = `${td}|${amount}|${desc.substring(0,30)}`;
      if (seen.has(key)) continue; seen.add(key);

      trans.push({ trans_date:td, post_date:pd, description:desc, amount, card_last4:card });
    }

    return {
      transactions: trans,
      billInfo: {
        billDate: null, dueDate: null, billCycle: null,
        cycleStart: trans[0]?.trans_date, cycleEnd: trans[trans.length-1]?.trans_date,
        cardLast4: "", cardholder: this.defaultCardholder,
      },
    };
  },
};

module.exports = bank;
