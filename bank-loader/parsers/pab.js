/**
 * bank-loader/parsers/pab.js — 平安银行信用卡账单解析器
 *
 * 编码: QP + GBK (loader自动处理)
 * 格式: 交易日 | 记账日 | 摘要 | 金额(¥)
 * 金额: ¥ 10.94 / ¥ -2.00（负号在¥后）
 */
"use strict";

const bank = {
  code: "PAB",
  name: "平安银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "",
  qqFolder: "其他文件夹/平安银行",
  searchFrom: "pingan",

  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, envelope, transactions);
    return { billInfo, transactions };
  },

  _parseTransactions(html) {
    const trans = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(html)) !== null) {
      const cells = [];
      const cr = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cr.exec(rm[1])) !== null) {
        cells.push(c[1].replace(/<[^>]+>/g, "").trim());
      }
      if (cells.length < 3) continue;

      // 找两列 YYYY-MM-DD
      const dates = cells.filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c));
      if (dates.length < 2) continue;

      // 卡号后四位（4位数字，非日期）
      let cardLast4 = "";
      for (const cell of cells) {
        if (/^\d{4}$/.test(cell) && !/^\d{4}-\d{2}-\d{2}$/.test(cell)) {
          cardLast4 = cell; break;
        }
      }

      // 金额: ¥ 10.94 或 ¥ -2.00
      let amount = null;
      for (const cell of cells) {
        const m = cell.match(/(?:[¥￥]|&yen;)\s*(-?\d[\d,]*\.?\d*)/);
        if (m) {
          amount = parseFloat(m[1].replace(/,/g, ""));
          break;
        }
      }
      if (amount === null || Math.abs(amount) > 5000000) continue;

      // 描述 = 找有中文且非日期/金额的列
      let desc = "";
      for (const cell of cells) {
        if (cell.length > 2 && !/^\d{4}-\d{2}-\d{2}$/.test(cell) && !cell.includes("¥") && !cell.includes("&yen;") && !/^\d{4}$/.test(cell)) {
          desc = cell.substring(0, 200);
          break;
        }
      }
      if (!desc) continue;

      // 交易类型
      const transType = amount > 0 ? "SPEND" : (desc.includes("退款") ? "REFUND" : "REPAY");

      trans.push({
        trans_date: dates[0], post_date: dates[1],
        description: desc, amount,
        card_last4: cardLast4,
        trans_type: transType,
      });
    }
    return trans;
  },

 _extractBillInfo(html, envelope, transactions) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&yen;/g, "¥").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    
    // Extract formula: ¥530.08 ¥35.94 ¥35.94 ¥530.46 ¥0.38 ¥0.00
    // Indices: 0=本期应还, 1=上期账单, 2=上期还款, 3=本期消费, 4=调整, 5=利息
    const summary = {};
    const formulaRe = /¥\s*([\d,]+\.\d{2})\s+¥\s*([\d,]+\.\d{2})\s+¥\s*([\d,]+\.\d{2})\s+¥\s*([\d,]+\.\d{2})\s+¥\s*([\d,]+\.\d{2})\s+¥\s*([\d,]+\.\d{2})/;
    const fm = text.match(formulaRe);
    if (fm) {
      summary.statementBalance = parseFloat(fm[1].replace(/,/g, ""));
      summary.prevBalance     = parseFloat(fm[2].replace(/,/g, ""));
      summary.prevPayment     = parseFloat(fm[3].replace(/,/g, ""));
      summary.totalSpend      = parseFloat(fm[4].replace(/,/g, ""));
      summary.adjustment      = parseFloat(fm[5].replace(/,/g, ""));
      summary.interest        = parseFloat(fm[6].replace(/,/g, ""));
    }
    
    return {
      billDate: null,
      dueDate: null,
      billCycle: null,
      cycleStart: transactions.length > 0 ? transactions[0].trans_date : null,
      cycleEnd: transactions.length > 0 ? transactions[transactions.length - 1].trans_date : null,
      cardLast4: "",
      cardholder: this.defaultCardholder,
      summary: summary,
    };
  },

};

module.exports = bank;
