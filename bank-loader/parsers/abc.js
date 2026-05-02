/**
 * bank-loader/parsers/abc.js — 农业银行信用卡账单解析器
 *
 * 编码: Base64 + UTF-8 (loader自动处理)
 * 日期: YYMMDD (6位无分隔符)
 * 格式: ● 类型 YYMMDD YYMMDD 卡号 描述 金额/CNY 入账金额/CNY
 * ⚠️ 农行符号相反: 消费记负(-3.54/CNY) → 取反(+3.54)
 *                       还款记正(1.00/CNY)  → 取反(-1.00)
 * 持卡人: 吴华辉
 * 卡号: 8042(主卡), 2769附(副卡)
 */
"use strict";

const bank = {
  code: "ABC",
  name: "农业银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "8042",
  qqFolder: "其他文件夹/农业银行",
  searchFrom: "abchina",
  searchQueries: [{ from: "abchina" }, { from: "creditcard.abchina.com.cn" }, { subject: "农业银行" }],

  parse(html, envelope) {
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#xA;/g, " ")
      .replace(/[\t\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const trans = [];
    const seen = new Set();

    // 格式: ● 类型 YYMMDD YYMMDD 卡号 描述 金额/CNY 入账金额/CNY
    const rowRe = /●\s+(还款|消费|退货|取现|利息|年费|手续费|分期)\s+(\d{2})(\d{2})(\d{2})\s+(\d{2})(\d{2})(\d{2})\s+(\d{4}|(\d{4})附)\s+([^0-9]+?)\s+(-?\d[\d,]*\.?\d*)\/CNY\s+(-?\d[\d,]*\.?\d*)\/CNY/g;
    let m;

    while ((m = rowRe.exec(text)) !== null) {
      const txType = m[1];
      const tY = parseInt(m[2]) + 2000, tM = parseInt(m[3]), tD = parseInt(m[4]);
      const pY = parseInt(m[5]) + 2000, pM = parseInt(m[6]), pD = parseInt(m[7]);
      const cardRaw = m[8];
      const desc = m[10].replace(/\s+/g, "").substring(0, 200);
      const settleAmt = parseFloat(m[12].replace(/,/g, ""));

      if (!desc || isNaN(settleAmt) || Math.abs(settleAmt) > 5000000) continue;

      // 农行符号规则：消费=负(-) → 取正(+); 还款=正(+) → 取负(-)
      // 直接用入账金额并取反
      const amount = -settleAmt;

      const td = `${tY}-${String(tM).padStart(2, "0")}-${String(tD).padStart(2, "0")}`;
      const pd = `${pY}-${String(pM).padStart(2, "0")}-${String(pD).padStart(2, "0")}`;
      const cardLast4 = cardRaw.replace("附", "");

      const key = `${td}|${amount}|${desc.substring(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      trans.push({ trans_date: td, post_date: pd, description: desc, amount, card_last4: cardLast4 });
    }

    return {
      transactions: trans,
      billInfo: {
        billDate: null, dueDate: null, billCycle: null,
        cycleStart: trans[0]?.trans_date, cycleEnd: trans[trans.length - 1]?.trans_date,
        cardLast4: "", cardholder: this.defaultCardholder,
      },
    };
  },
};

module.exports = bank;
