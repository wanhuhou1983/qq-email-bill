/**
 * bank-loader/parsers/icbc.js — 工商银行信用卡账单解析器
 *
 * 编码: QP + GBK (loader自动处理)
 * 日期: YYYY-MM-DD
 * 金额: 1.00/RMB, 方向由(支出)/(存入)后缀区分
 * 结构: 纯文本行格式，从"人民币(本位币) 交 易 明 细"到"工 银i 豆 信 息"
 * 每行: 卡号 YYYY-MM-DD YYYY-MM-DD 交易类型 描述 金额/RMB 金额/RMB(支出|存入)
 */
"use strict";

const VALID_CARDS = new Set(["8888", "2411", "6402", "1465", "3751"]);

const CARDHOLDER_MAP = {
  "8888": "吴华辉", "2411": "吴华辉", "6402": "吴华辉",
  "1465": "吴华辉", "3751": "吴大军",
};

const bank = {
  code: "ICBC", name: "工商银行", defaultCardholder: "吴华辉", defaultCardLast4: "8888",
  qqFolder: "其他文件夹/工商银行", searchFrom: "icbc", skipLast: 1, maxEmails: 20,

  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, envelope, transactions);
    return { billInfo, transactions };
  },

  _parseTransactions(html) {
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[\t\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 定位交易明细区域
    const start = text.indexOf("人民币(本位币) 交 易 明 细");
    const end = text.indexOf("工 银i 豆 信 息");
    if (start < 0) return [];
    const section = end > start ? text.substring(start, end) : text.substring(start);

    const trans = [];

    // 每行: 卡号 YYYY-MM-DD YYYY-MM-DD 交易类型 描述 金额/RMB 金额/RMB(支出|存入)
    const rowRe = /(\d{4})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\/RMB\s+([\d,]+\.\d{2})\/RMB\((存入|支出)\)/g;
    let m;

    while ((m = rowRe.exec(section)) !== null) {
      const card = m[1];
      if (!VALID_CARDS.has(card)) continue;

      const transDate = m[2], postDate = m[3];
      const typeStr = m[4].replace(/\s+/g, " ").trim();
      const amountRaw = parseFloat(m[5].replace(/,/g, ""));
      const direction = m[7]; // 存入 or 支出

      // 金额方向：(存入)=负, (支出)=正
      const amount = direction === "存入" ? -amountRaw : amountRaw;

      // 从交易类型+描述中提取商户名
      let desc = typeStr.substring(0, 200);
      if (!desc) continue;

      // 交易类型
      let transType = "SPEND";
      if (typeStr.includes("还款")) transType = "REPAY";
      else if (typeStr.includes("退款")) transType = "REFUND";
      else if (typeStr.includes("刷卡金")) transType = "REFUND";
      else if (typeStr.includes("银联入账")) transType = "REPAY";
      else if (typeStr.includes("年费减免")) transType = "REFUND";
      else if (direction === "存入") transType = "REPAY";

      trans.push({
        trans_date: transDate, post_date: postDate,
        description: desc, amount,
        card_last4: card,
        cardholder: CARDHOLDER_MAP[card] || bank.defaultCardholder,
        trans_type: transType,
      });
    }

    return trans;
  },

  _extractBillInfo(html, envelope, transactions) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const billMatch = text.match(/对账单生成日[^0-9]*(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
    let billDate = billMatch ? `${billMatch[1]}-${billMatch[2].padStart(2,"0")}-${billMatch[3].padStart(2,"0")}` : null;
    const dueMatch = text.match(/到期还款日[^0-9]*(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
    let dueDate = dueMatch ? `${dueMatch[1]}-${dueMatch[2].padStart(2,"0")}-${dueMatch[3].padStart(2,"0")}` : null;
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
