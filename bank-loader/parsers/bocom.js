/**
 * bank-loader/parsers/bocom.js — 交通银行信用卡账单
 *
 * 编码: Base64 + GBK
 * 日期: MM/DD（从主题推算年份）
 * 格式: 两段式——"还款、退货、费用返还明细"（负） + "消费、取现、其他费用明细"（正）
 * 行: MM/DD MM/DD 卡号4 描述 CNY 金额 CNY 金额
 * 备注：交易金额（Trans.Curr/Amt）和入账金额（Payment.Curr/Amt）都是正数
 *      类型由所在段落决定
 */
"use strict";

const bank = {
  code: "BOCOM", name: "交通银行", defaultCardholder: "吴华辉", defaultCardLast4: "",
  qqFolder: "其他文件夹/交通银行", searchFrom: "bocomm",

  _inferYear(text) {
    // 从邮件主题文本推断年份
    const m = text.match(/\b(20\d{2})\b/);
    if (m) return parseInt(m[1]);
    return new Date().getFullYear();
  },

  parse(html, envelope) {
    // 替换CNY后的换行，便于正则匹配（Gemini方法）
    const processed = html.replace(/CNY\s*\n/g, 'CNY ');
    const text = processed
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[\t\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const year = this._inferYear(text);
    const trans = [];

    // 行正则: MM/DD MM/DD 卡号4 描述 CNY 交易金额 CNY 入账金额
    const rowRe = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\s+(\d{4})\s+(.+?)\s+CNY\s+([\d\.,]+)\s+CNY\s+([\d\.,]+)/g;

    // 辅助：从区块提取行
    const parseSection = (section, isPositive) => {
      rowRe.lastIndex = 0;
      let m;
      while ((m = rowRe.exec(section)) !== null) {
        const tMo = parseInt(m[1]), tDa = parseInt(m[2]);
        const pMo = parseInt(m[3]), pDa = parseInt(m[4]);
        const card = m[5];
        const desc = m[6].replace(/\s+/g, "").substring(0, 200);
        const entryAmt = parseFloat(m[8].replace(/,/g, "")); // 入账金额

        if (!desc || isNaN(entryAmt) || Math.abs(entryAmt) > 5000000) continue;

        // 年份推断：月份>6→上年
        let tY = year, pY = year;
        if (tMo > 6) tY = year - 1;
        if (pMo > 6) pY = year - 1;

        const amount = isPositive ? entryAmt : -entryAmt;
        let transType = isPositive ? "SPEND" : "REPAY";
        if (!isPositive && (desc.includes("退货") || desc.includes("退款"))) transType = "REFUND";

        trans.push({
          trans_date: `${tY}-${String(tMo).padStart(2,"0")}-${String(tDa).padStart(2,"0")}`,
          post_date: `${pY}-${String(pMo).padStart(2,"0")}-${String(pDa).padStart(2,"0")}`,
          description: desc, amount, card_last4: card, trans_type: transType,
        });
      }
    };

    // 提取还款段（负）
    const creditStart = text.indexOf("还款、退货、费用返还明细");
    const debitStart = text.indexOf("消费、取现、其他费用明细");
    const endPhrase = text.indexOf("除以上账单显示交易外");

    if (creditStart >= 0 && debitStart > creditStart) {
      // 找到"Payment Curr/Amt"作为表头结束
      const headerEnd = text.indexOf("Payment Curr/Amt", creditStart);
      const blockEnd = debitStart;
      if (headerEnd >= 0 && headerEnd < blockEnd) {
        const creditBlock = text.substring(headerEnd + "Payment Curr/Amt".length, blockEnd);
        parseSection(creditBlock, false);
      }
    }

    if (debitStart >= 0 && endPhrase > debitStart) {
      const headerEnd = text.indexOf("Payment Curr/Amt", debitStart);
      if (headerEnd >= 0 && headerEnd < endPhrase) {
        const debitBlock = text.substring(headerEnd + "Payment Curr/Amt".length, endPhrase);
        parseSection(debitBlock, true);
      }
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
