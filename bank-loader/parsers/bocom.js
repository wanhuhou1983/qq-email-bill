/**
 * bank-loader/parsers/bocom.js — 交通银行信用卡账单
 *
 * 编码: Base64 + GBK
 * 日期: MM/DD（需推断年份）
 * 格式: 两段（还款 + 消费），每行 MM/DD MM/DD 卡号 描述 金额
 * 持卡人: 吴华辉
 */
"use strict";

const bank = {
  code: "BOCOM", name: "交通银行", defaultCardholder: "吴华辉", defaultCardLast4: "",
  qqFolder: "其他文件夹/交通银行", searchFrom: "bocomm",

  parse(html, envelope) {
    const text = html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/[\t\r\n]/g," ").replace(/\s+/g," ").trim();
    const trans = [];
    const seen = new Set();

    // 从"本期账务说明"或"消费支出"后开始
    const start = text.search(/消费|支出|本期账务说明|明细/);
    const section = start >= 0 ? text.substring(start) : text;

    // 年份推断：按月份确定
    let year = new Date().getFullYear();
    const cycMatch = text.match(/Statement Cycle\s*(\d{4})\/\d{2}\/\d{2}/);
    if (cycMatch) year = parseInt(cycMatch[1]);

    // 模式: MM/DD MM/DD 4位卡号 描述 金额
    const rowRe = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\s+(\d{4})\s+([^0-9]+?)\s+(-?\d[\d,]*\.?\d*)/g;
    let m;

    while ((m = rowRe.exec(section)) !== null) {
      const tM = parseInt(m[1]), tD = parseInt(m[2]);
      const pM = parseInt(m[3]), pD = parseInt(m[4]);
      const card = m[5];
      const desc = m[6].replace(/\s+/g,"").substring(0,200);
      const amount = parseFloat(m[7].replace(/,/g,""));

      if (!desc || isNaN(amount) || Math.abs(amount) > 5000000) continue;

      // 年份推断
      let tY = year, pY = year;
      if (tM > 6) tY = year - 1;  // 7-12月→上年
      if (pM > 6) pY = year - 1;

      const fmt = (y,mo,d) => `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const key = `${fmt(tY,tM,tD)}|${amount}|${card}|${desc.substring(0,30)}`;
      if (seen.has(key)) continue; seen.add(key);

      trans.push({
        trans_date: fmt(tY,tM,tD), post_date: fmt(pY,pM,pD),
        description: desc, amount, card_last4: card,
      });
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
