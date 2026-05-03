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

// 卡号→持卡人映射
const CARDHOLDER_MAP = {
  "8042": "吴华辉",
  "2769": "吴华辉",
  "8761": "吴大军",
};

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

    // 格式: (可选● 类型) YYMMDD YYMMDD 卡号 描述 金额/CNY 入账金额/CNY
    // 同一分类下后续交易行不带●前缀
    // 类型映射：消费→SPEND，退货→REFUND，还款→REPAY，取现→WITHDRAW，利息/手续费/分期→FEE
    const typeMap = { "消费": "SPEND", "退货": "REFUND", "还款": "REPAY", "取现": "WITHDRAW" };
    const rowRe = /(?:●\s+((?:还款|消费|退货|取现|利息|年费|手续费|分期))\s+)?(\d{2})(\d{2})(\d{2})\s+(\d{2})(\d{2})(\d{2})\s+(\d{4}|(?:\d{4})附)\s+(.+?)\s+(-?\d[\d,]*\.?\d*)\/CNY\s+(-?\d[\d,]*\.?\d*)\/CNY/g;
    let m;

    while ((m = rowRe.exec(text)) !== null) {
      const rawType = m[1]; // 类型关键词：消费/退货/还款/取现/利息/年费/手续费/分期
      const tY = parseInt(m[2]) + 2000, tM = parseInt(m[3]), tD = parseInt(m[4]);
      const pY = parseInt(m[5]) + 2000, pM = parseInt(m[6]), pD = parseInt(m[7]);
      const cardRaw = m[8];
      const desc = m[9].replace(/\s+/g, "").substring(0, 200);
      const settleAmt = parseFloat(m[11].replace(/,/g, ""));

      if (!desc || isNaN(settleAmt) || Math.abs(settleAmt) > 5000000) continue;

      // 农行符号规则（统一规则：消费=正, 还款/退款/存入=负）：
      //   消费/取现：原文为负 → 取反变正
      //   还款/退款/存入：原文为正 → 取反变负
      //   所有类型统一取反，无特例
      const transType = rawType ? (typeMap[rawType] || "FEE") : null;
      // null类型时根据描述推断
      let finalType = transType;
      if (!finalType) {
        if (desc.includes("退货") || desc.includes("退款")) finalType = "REFUND";
        else if (desc.includes("还款") || desc.includes("还")) finalType = "REPAY";
        else if (settleAmt < 0) finalType = "SPEND";  // 支出
        else finalType = "REPAY";  // 正数=还款
      }
      const amount = -settleAmt;

      const td = `${tY}-${String(tM).padStart(2, "0")}-${String(tD).padStart(2, "0")}`;
      const pd = `${pY}-${String(pM).padStart(2, "0")}-${String(pD).padStart(2, "0")}`;
      const cardLast4 = cardRaw.replace("附", "");
      const cardholder = CARDHOLDER_MAP[cardLast4] || bank.defaultCardholder;

      trans.push({
        trans_date: td, post_date: pd, description: desc,
        amount, card_last4: cardLast4,
        cardholder: cardholder,
        trans_type: finalType,
      });
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
