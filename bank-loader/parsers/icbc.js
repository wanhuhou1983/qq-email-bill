/**
 * bank-loader/parsers/icbc.js — 工商银行信用卡账单解析器
 *
 * 编码: QP + GBK (loader自动处理)
 * 日期: YYYY-MM-DD
 * 金额: 1.00/RMB, 方向由(支出)/(存入)后缀区分
 * 结构: ---主卡明细--- (8888) → 每行首列为卡号
 *       ---副卡明细--- (2411, 6402) → 每行首列为卡号
 * 注意: 1465 是账户编号，不是实际交易卡号，跳过
 */
"use strict";

const VALID_CARDS = new Set(["8888", "2411", "6402", "3751"]);

// 卡号→持卡人映射
const CARDHOLDER_MAP = {
  "8888": "吴华辉",
  "2411": "吴华辉",
  "6402": "吴华辉",
  "3751": "吴大军",
};

const bank = {
  code: "ICBC",
  name: "工商银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "8888",
  qqFolder: "其他文件夹/工商银行",
  searchFrom: "icbc",
  searchQueries: [],
  skipLast: 1,
  maxEmails: 20,

  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, envelope, transactions);
    return { billInfo, transactions };
  },

  _parseTransactions(html) {
    const trans = [];

    // 按明细区拆分
    const sectionRe = /---([^-]+明细)---([\s\S]*?)(?=---[^-]+明细---|---|$)/g;
    let sm;
    while ((sm = sectionRe.exec(html)) !== null) {
      const sectionName = sm[1]; // "主卡明细" or "副卡明细"
      const sectionHtml = sm[2];

      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(sectionHtml)) !== null) {
        const cells = [];
        const cr = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let c;
        while ((c = cr.exec(rm[1])) !== null) {
          cells.push(c[1].replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length < 6) continue;

        // 首列必须是有效卡号
        const cardRaw = cells[0].replace(/\s/g, "");
        if (!VALID_CARDS.has(cardRaw)) continue;

        // 找两列日期
        const dates = [];
        for (const cell of cells) {
          const m = cell.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (m) dates.push(m[0]);
        }
        if (dates.length < 2) continue;

        // 金额方向：看记账金额列有无(存入)/(还款)
        let amount = null;
        for (const cell of cells) {
          if (cell.includes("(存入)") || cell.includes("(还款)")) {
            const m = cell.match(/([\d,]+(?:\.\d{1,2})?)/);
            if (m) { amount = -Math.abs(parseFloat(m[1].replace(/,/g, ""))); break; }
          } else if (cell.includes("(支出)")) {
            const m = cell.match(/([\d,]+(?:\.\d{1,2})?)/);
            if (m) { amount = Math.abs(parseFloat(m[1].replace(/,/g, ""))); break; }
          }
        }
        // 回退：用交易金额+交易类型判断
        if (amount === null) {
          for (const cell of cells) {
            const m = cell.match(/^([\d,]+(?:\.\d{1,2})?)\/[A-Z]{3,4}$/);
            if (m) {
              const rawAmt = parseFloat(m[1].replace(/,/g, ""));
              const typeStr = cells[3] || "";
              amount = (typeStr.includes("还款") || typeStr.includes("存入") || typeStr.includes("退款"))
                ? -Math.abs(rawAmt) : Math.abs(rawAmt);
              break;
            }
          }
        }
        if (amount === null || amount === 0) continue;

        // 描述 = 交易类型 + 商户名称
        const typeStr = cells[3] || "";
        const merchantStr = (cells[4] || "").replace(/\s+/g, " ").trim();
        const desc = (typeStr + (merchantStr ? "-" + merchantStr : "")).substring(0, 200);
        if (!desc) continue;

        trans.push({
          trans_date: dates[0],
          post_date: dates[1],
          description: desc,
          amount: amount,
          card_last4: cardRaw,
          cardholder: CARDHOLDER_MAP[cardRaw] || bank.defaultCardholder,
        });
      }
    }

    return trans;
  },

  _extractBillInfo(html, envelope, transactions) {
    const billMatch = html.match(/对账单生成日[^0-9]*(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
    let billDate = null;
    if (billMatch) {
      billDate = `${billMatch[1]}-${billMatch[2].padStart(2,"0")}-${billMatch[3].padStart(2,"0")}`;
    }

    const dueMatch = html.match(/到期还款日[^0-9]*(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
    let dueDate = null;
    if (dueMatch) {
      dueDate = `${dueMatch[1]}-${dueMatch[2].padStart(2,"0")}-${dueMatch[3].padStart(2,"0")}`;
    }

    const billCycle = billDate ? billDate.slice(0, 7) : null;

    let cycleStart = null, cycleEnd = null;
    if (transactions && transactions.length > 0) {
      const allDates = transactions.map(t => t.trans_date).filter(Boolean).sort();
      if (allDates.length > 0) { cycleStart = allDates[0]; cycleEnd = allDates[allDates.length - 1]; }
    }

    return { billDate, dueDate, billCycle, cycleStart, cycleEnd, cardLast4: "", cardholder: bank.defaultCardholder };
  },
};

module.exports = bank;
