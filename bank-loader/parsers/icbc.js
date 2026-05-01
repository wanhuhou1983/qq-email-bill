/**
 * bank-loader/parsers/icbc.js — 工商银行信用卡账单解析器
 *
 * 编码: QP + GBK (loader自动处理)
 * 日期: YYYY-MM-DD
 * 金额: 1.00/RMB, 方向由(支出)/(存入)区分
 * 列: 卡号后四位 | 交易日 | 记账日 | 交易类型 | 商户名称/城市 | 交易金额/币种 | 记账金额/币种
 * 多卡: 8888(主卡), 1465
 * 账单日: 每自然月12日~次月11日
 */
"use strict";

const bank = {
  code: "ICBC",
  name: "工商银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "8888",
  qqFolder: "其他文件夹/工商银行",
  searchFrom: "icbc",
  searchQueries: [],
  skipLast: 1,         // 最后一封可能是通知而非账单
  maxEmails: 20,

  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, envelope, transactions);
    return { billInfo, transactions };
  },

  _parseTransactions(html) {
    const trans = [];

    // 找到"主卡明细"或"副卡明细"之后的交易表格
    const sections = html.match(/--[^-]+明细---[\s\S]*?(?=--[^-]+明细---|$)/g) || [];

    for (const section of sections) {
      // 判断卡号: 主卡=8888, 副卡=1465
      const isMain = section.includes("主卡");
      const cardLast4 = isMain ? "8888" : "1465";

      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(section)) !== null) {
        const cells = [];
        const cr = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let c;
        while ((c = cr.exec(rm[1])) !== null) {
          cells.push(c[1].replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length < 6) continue;

        // 找两列日期
        const dates = [];
        for (const cell of cells) {
          const m = cell.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (m) dates.push(m[0]);
        }
        if (dates.length < 2) continue;

        // 金额在倒数第二或第三列（交易金额/币种）
        // 方向看记账金额列: 含(支出)=正, 含(存入)=负
        let amount = null;
        let rawAmount = null;
        let amountCell = "";

        // 找交易金额列（格式: 1.00/RMB）
        for (const cell of cells) {
          const m = cell.match(/^([\d,]+(?:\.\d{1,2})?)\/[A-Z]{3,4}$/);
          if (m) {
            rawAmount = parseFloat(m[1].replace(/,/g, ""));
            break;
          }
        }

        // 找记账金额列（含(支出)或(存入)）
        for (const cell of cells) {
          if (cell.includes("(支出)") || cell.includes("(存入)") || cell.includes("(还款)") || cell.includes("(调整)")) {
            const m = cell.match(/([\d,]+(?:\.\d{1,2})?)/);
            if (m) {
              amountCell = cell;
              // 用记账金额
              if (cell.includes("(存入)") || cell.includes("(还款)")) {
                amount = -Math.abs(parseFloat(m[1].replace(/,/g, "")));
              } else {
                amount = Math.abs(parseFloat(m[1].replace(/,/g, "")));
              }
              break;
            }
          }
        }

        // 如果没找到带方向的，用交易金额 + 交易类型判断
        if (amount === null && rawAmount !== null) {
          const typeCell = cells[3] || ""; // 交易类型列
          if (typeCell.includes("还款") || typeCell.includes("存入")) {
            amount = -Math.abs(rawAmount);
          } else if (typeCell.includes("退款")) {
            amount = -Math.abs(rawAmount);
          } else {
            amount = Math.abs(rawAmount);
          }
        }

        if (amount === null || amount === 0) continue;

        // 描述 = 交易类型 + 商户名称
        const typeStr = cells[3] || "";
        const merchantStr = (cells[4] || "").replace(/\s+/g, " ").trim();
        const desc = merchantStr && !merchantStr.includes(typeStr)
          ? `${typeStr}-${merchantStr}`.substring(0, 200)
          : (merchantStr || typeStr).substring(0, 200);
        if (!desc) continue;

        trans.push({
          trans_date: dates[0],
          post_date: dates[1],
          description: desc,
          amount: amount,
          card_last4: cardLast4,
        });
      }
    }

    // 如果没有按明细区解析成功，直接搜全 HTML 中的交易行
    if (trans.length === 0) {
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(html)) !== null) {
        const cells = [];
        const cr = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let c;
        while ((c = cr.exec(rm[1])) !== null) {
          cells.push(c[1].replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length < 6) continue;

        const dates = cells.filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c));
        if (dates.length < 2) continue;

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

        if (amount === null || amount === 0) continue;

        const typeStr = cells[3] || "";
        const merchantStr = (cells[4] || "").replace(/\s+/g, " ").trim();
        const desc = (typeStr + (merchantStr ? "-" + merchantStr : "")).substring(0, 200);
        if (!desc) continue;

        trans.push({
          trans_date: dates[0],
          post_date: dates[1],
          description: desc,
          amount: amount,
          card_last4: "",
        });
      }
    }

    return trans;
  },

  _extractBillInfo(html, envelope, transactions) {
    // 账单生成日: 2026年04月11日 (HTML中可能是&nbsp;)
    const billDateMatch = html.match(/对账单生成日[^0-9]*(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
    let billDate = null;
    if (billDateMatch) {
      billDate = `${billDateMatch[1]}-${parseInt(billDateMatch[2])}-${parseInt(billDateMatch[3])}`;
    }

    // 到期还款日: 2026年5月5日
    const dueMatch = html.match(/到期还款日[^0-9]*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let dueDate = null;
    if (dueMatch) {
      dueDate = `${dueMatch[1]}-${parseInt(dueMatch[2])}-${parseInt(dueMatch[3])}`;
    }

    // 账期 = 对账单生成日所在的月份
    const billCycle = billDate ? billDate.slice(0, 7) : null;

    // Cycle从交易日期推断
    let cycleStart = null, cycleEnd = null;
    if (transactions && transactions.length > 0) {
      const allDates = transactions.map(t => t.trans_date).filter(Boolean).sort();
      if (allDates.length > 0) {
        cycleStart = allDates[0];
        cycleEnd = allDates[allDates.length - 1];
      }
    }

    return { billDate, dueDate, billCycle, cycleStart, cycleEnd, cardLast4: "", cardholder: bank.defaultCardholder };
  },
};

module.exports = bank;
