/**
 * bank-loader/parsers/cmb.js — 招商银行信用卡账单解析器
 *
 * 编码: QP + UTF-8
 * 格式: 每字段单独一行，分组结构：
 *   还款: [MMDD] [描述] [¥金额] [卡号] [交易金额]
 *   消费: [MMDD] [MMDD] [描述] [¥金额] [卡号] [CN] [交易金额]
 */
"use strict";

const CARDHOLDER_MAP = {
  "1251": "吴华辉", "8022": "吴华辉", "1481": "吴华辉", "0696": "吴华辉",
};

const bank = {
  code: "CMB", name: "招商银行", defaultCardholder: "吴华辉", defaultCardLast4: "8022",
  qqFolder: "其他文件夹/招商银行", searchFrom: "cmbchina",
  searchQueries: [{ from: "cmbchina" }, { subject: "招商银行信用卡" }],

  parse(html, envelope) {
    const year = this._inferYear(html);
    const text = html
      .replace(/>/g, ">\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&yen;/g, "¥")
      .replace(/[\t\r\n]+/g, "\n")
      .replace(/\n\s+\n/g, "\n")
      .trim();

    const lines = text.split("\n").map(l => l.trim()).filter(l => l);
    const trans = [];
    let section = "";

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l === "还款") { section = "repay"; continue; }
      if (l === "消费") { section = "spend"; continue; }

      // 找MMDD日期
      if (!/^\d{4}$/.test(l)) continue;
      const n = parseInt(l);
      if (n < 101 || n > 1231) continue;

      if (section === "spend") {
        // 消费：第一行是交易日，下一行是记账日
        if (i + 5 >= lines.length) continue;
        const postDate = lines[i + 1];
        if (!/^\d{4}$/.test(postDate)) continue;
        const desc = lines[i + 2] || "";
        const amtLine = lines[i + 3] || "";
        const amtMatch = amtLine.match(/[¥￥]\s*(-?\d[\d,]*\.?\d*)/);
        const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : null;
        const cardLast4 = lines[i + 4] || "";
        if (!desc || amount === null || Math.abs(amount) > 5000000) continue;

        const fmt = (d) => {
          const mo = parseInt(d.slice(0,2)), day = parseInt(d.slice(2,4));
          let y = year; if (mo > 6) y = year - 1;
          return `${y}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        };

        let transType = amount < 0 ? "REPAY" : "SPEND";
        if (desc.includes("免年费")) transType = "REFUND";

        trans.push({
          trans_date: fmt(l), post_date: fmt(postDate),
          description: desc, amount, card_last4: cardLast4,
          cardholder: CARDHOLDER_MAP[cardLast4] || bank.defaultCardholder,
          trans_type: transType,
        });
        i += 5; continue;
      }

      if (section === "repay") {
        // 还款：MMDD → 描述 → ¥金额 → 卡号 → 交易金额
        if (i + 4 >= lines.length) continue;
        const desc = lines[i + 1] || "";
        const amtLine = lines[i + 2] || "";
        const amtMatch = amtLine.match(/[¥￥]\s*(-?\d[\d,]*\.?\d*)/);
        const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : null;
        const cardLast4 = lines[i + 3] || "";
        if (!desc || amount === null || Math.abs(amount) > 5000000) continue;

        const fmt = (d) => {
          const mo = parseInt(d.slice(0,2)), day = parseInt(d.slice(2,4));
          let y = year; if (mo > 6) y = year - 1;
          return `${y}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        };

        trans.push({
          trans_date: fmt(l), post_date: fmt(l),
          description: desc, amount, card_last4: cardLast4,
          cardholder: CARDHOLDER_MAP[cardLast4] || bank.defaultCardholder,
          trans_type: "REPAY",
        });
        i += 4; continue;
      }
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

  _inferYear(html) {
    const m = html.match(/(\d{4})\/\d{2}\/\d{2}\s*-\s*\d{2}\/\d{2}\/\d{2}/);
    return m ? parseInt(m[1]) : new Date().getFullYear();
  },
};

module.exports = bank;
