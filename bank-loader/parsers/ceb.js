/**
 * bank-loader/parsers/ceb.js — 光大银行信用卡账单解析器
 *
 * 编码: QP + GB18030 (loader自动处理)
 * 日期: YYYY-MM-DD
 * 金额方向: (存入) 前缀需转负数
 * 注意: 光大可能有多个卡号混合
 */
"use strict";

const bank = {
  code: "CEB",
  name: "光大银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "",
  qqFolder: "其他文件夹/光大银行",
  searchFrom: "cebbank",
  searchQueries: [{ from: "cebbank" }, { subject: "光大信用卡" }],

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

      // 找 YYYY-MM-DD 或 YYYY/MM/DD
      const dates = [];
      for (const cell of cells) {
        const m = cell.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (m) dates.push(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`);
      }
      if (dates.length < 2) continue;

      // 金额：带(存入)/(支出)前后缀
      let amount = null;
      for (const cell of cells) {
        // (存入)或(还款)在前: (存入)2.01
        const m1 = cell.match(/[\(（](存入|还款)[\)）]\s*([\d,]+(?:\.\d{1,2})?)/);
        if (m1) {
          const v = parseFloat(m1[2].replace(/,/g, ""));
          if (v > 0 && v < 5000000) { amount = -v; break; }
        }
        // (支出)在前
        const m2 = cell.match(/[\(（]支出[\)）]\s*([\d,]+(?:\.\d{1,2})?)/);
        if (m2) {
          const v = parseFloat(m2[1].replace(/,/g, ""));
          if (v > 0 && v < 5000000) { amount = v; break; }
        }
        // 存入/支出在后: 数字(存入) 或 数字(支出)
        const m3 = cell.match(/([\d,]+(?:\.\d{1,2})?)\s*[\(（](存入|还款|支出)[\)）]/);
        if (m3) {
          const v = parseFloat(m3[1].replace(/,/g, ""));
          if (v > 0 && v < 5000000) {
            amount = (m3[2] === "存入" || m3[2] === "还款") ? -v : v;
            break;
          }
        }
        // 纯数字含小数点（非卡号）
        const m4 = cell.match(/^(-?\d+\.\d{1,2})$/);
        if (m4) {
          const v = parseFloat(m4[1]);
          if (v > 0 && v < 5000000) { amount = v; break; }
          if (v < 0 && Math.abs(v) < 5000000) { amount = v; break; }
        }
      }
      if (amount === null || Math.abs(amount) > 5000000) continue;

      // 描述
      let desc = "";
      for (const cell of cells) {
        if (/[\u4e00-\u9fff]/.test(cell) && !/^\d{4}-\d{2}-\d{2}$/.test(cell) && !/^[-]?\d/.test(cell)) {
          desc = cell.substring(0, 200);
          break;
        }
      }
      if (!desc) continue;

      trans.push({
        trans_date: dates[0],
        post_date: dates[1],
        description: desc,
        amount: amount,
        card_last4: "",
      });
    }
    return trans;
  },

  _extractBillInfo(html, envelope, transactions) {
    return {
      billDate: null,
      dueDate: null,
      billCycle: null,
      cycleStart: transactions.length > 0 ? transactions[0].trans_date : null,
      cycleEnd: transactions.length > 0 ? transactions[transactions.length - 1].trans_date : null,
      cardLast4: "",
      cardholder: this.defaultCardholder,
    };
  },
};

module.exports = bank;
