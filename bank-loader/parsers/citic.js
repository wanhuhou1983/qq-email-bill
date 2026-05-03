/**
 * bank-loader/parsers/citic.js — 中信银行信用卡账单
 *
 * 编码: QP + GBK
 * 日期: YYYYMMDD（8位无分隔符）
 * 格式: YYYYMMDD YYYYMMDD 卡号 描述 CNY trxAmt CNY setlAmt
 * 卡号: 1696, 持卡人: 吴华辉
 * 注意：交易明细在"主卡"到"【温馨提示】"之间，纯文本行格式
 */
"use strict";

const bank = {
  code: "CITIC", name: "中信银行", defaultCardholder: "吴华辉", defaultCardLast4: "1696",
  qqFolder: "其他文件夹/中信银行", searchFrom: "citic",

  parse(html, envelope) {
    const text = html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/[\t\r\n]/g," ").replace(/\s+/g," ").trim();
    const trans = [];

    const start = text.search(/主卡/);
    const end = text.search(/【温馨提示】/);
    const section = start >= 0 ? (end > start ? text.substring(start, end) : text.substring(start)) : text;

    // YYYYMMDD YYYYMMDD 4位卡号 描述 CNY trxAmt CNY setlAmt
    const rowRe = /(\d{4})(\d{2})(\d{2})\s+(\d{4})(\d{2})(\d{2})\s+(\d{4})\s+(.+?)\s+CNY\s+(-?\d[\d,]*\.?\d*)\s+CNY\s+(-?\d[\d,]*\.?\d*)/g;
    let m;

    while ((m = rowRe.exec(section)) !== null) {
      const td = `${m[1]}-${m[2]}-${m[3]}`;
      const pd = `${m[4]}-${m[5]}-${m[6]}`;
      const card = m[7];
      const desc = m[8].replace(/\s+/g,"").substring(0,200);
      const amount = parseFloat(m[10].replace(/,/g,"")); // 记账金额 Setl.Amt

      if (!desc || isNaN(amount) || Math.abs(amount) > 5000000) continue;

      // 交易类型：正=消费，负=还款/入账
      let transType = "SPEND";
      if (amount < 0) {
        if (desc.includes("还款")) transType = "REPAY";
        else if (desc.includes("返") || desc.includes("退款")) transType = "REFUND";
        else transType = "REPAY"; // 银联入账等还款
      }

      trans.push({
        trans_date: td, post_date: pd, description: desc,
        amount, card_last4: card, trans_type: transType,
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
