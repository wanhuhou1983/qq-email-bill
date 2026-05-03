/**
 * bank-loader/parsers/cgb.js — 广发银行信用卡账单解析器
 *
 * 编码: QP + GBK (loader自动处理)
 * 格式: HTML表格，列：交易日期 | 记账日 | 摘要(类型前缀) | 交易金额 | 币种 | 入账金额 | 币种
 * 摘要前缀: (消费)→SPEND, (赠送)→REFUND, (还款)→REPAY, (退款)→REFUND
 */
"use strict";

const bank = {
  code: "CGB", name: "广发银行", defaultCardholder: "吴华辉", defaultCardLast4: "",
  qqFolder: "其他文件夹/广发银行", searchFrom: "cgb",
  searchQueries: [{ from: "cgb" }, { subject: "广发信用卡" }],

  parse(html, envelope) {
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
      if (cells.length < 4) continue;

      // 找两列 YYYY-MM-DD 或 YYYY/MM/DD
      const dates = [];
      for (const cell of cells) {
        const m = cell.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (m) dates.push(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`);
      }
      if (dates.length < 2) continue;

      // 金额（入账金额列优先，交易金额次之）
      let amount = null;
      for (const cell of cells) {
        const m = cell.match(/^(-?\d[\d,]*\.?\d*)$/);
        if (m) {
          const v = parseFloat(m[1].replace(/,/g, ""));
          if (Math.abs(v) < 5000000) {
            amount = v;
          }
        }
      }
      if (amount === null) continue;

      // 描述（含中文且非日期/金额的列，优先取摘要列）
      let desc = "";
      for (const cell of cells) {
        if (/[\u4e00-\u9fff]/.test(cell) && !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(cell) && !/^-?\d/.test(cell) && cell !== "人民币") {
          desc = cell.substring(0, 200);
          break;
        }
      }
      if (!desc || desc === "人民币") continue;

      // 交易类型：从描述前缀判断
      let transType = "SPEND";
      if (desc.startsWith("(赠送)") || desc.startsWith("（赠送）")) transType = "REFUND";
      else if (desc.startsWith("(还款)") || desc.startsWith("（还款）")) transType = "REPAY";
      else if (desc.startsWith("(退款)") || desc.startsWith("（退款）")) transType = "REFUND";
      else if (amount < 0) transType = "REPAY";

      trans.push({
        trans_date: dates[0], post_date: dates[1],
        description: desc, amount,
        card_last4: "",
        trans_type: transType,
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
