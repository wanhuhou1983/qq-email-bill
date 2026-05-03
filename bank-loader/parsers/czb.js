/**
 * bank-loader/parsers/czb.js — 浙商银行信用卡账单解析器
 *
 * 编码: Quoted-Printable (UTF-8)
 * 日期: YYYYMMDD（8位无分隔符）
 * 金额: ¥ 5.00 / ¥ -10000.00（负号在¥前）
 * 列: 交易日 | 记账日 | 交易摘要 | 交易金额 | 卡号末四位
 */
"use strict";

const bank = {
  code: "CZB",
  name: "浙商银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "2171",
  qqFolder: "其他文件夹/浙商银行",
  searchFrom: "czbank",
  searchQueries: [{ from: "czbank" }, { subject: "对账单" }],

  /**
   * 解析HTML为标准化数据
   * @param {string} html — 已解码的UTF-8 HTML
   * @param {object} envelope — 邮件元信息
   * @returns {{ billInfo: object, transactions: array }}
   */
  parse(html, envelope) {
    const transactions = this._parseTransactions(html);
    const billInfo = this._extractBillInfo(html, transactions);

    return { billInfo, transactions };
  },

  /** 解析交易明细行 */
  _parseTransactions(html) {
    const trans = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(html)) !== null) {
      const cells = [];
      const cr = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cr.exec(rowMatch[1])) !== null) {
        cells.push(c[1].replace(/<[^>]+>/g, "").trim());
      }
      if (cells.length < 4) continue;

      // 找两个8位YMD日期
      const dates = cells.filter((c) => /^\d{8}$/.test(c));
      if (dates.length < 2) continue;

      // 找金额：¥ -9,000.00 或 -9,000.00 或 ¥ 5.00
      let amt = null;
      for (const c of cells) {
        // 带¥前缀
        const m1 = c.match(/[¥￥]\s*(-?\d[\d,]*\.?\d*)/);
        if (m1) {
          const val = parseFloat(m1[1].replace(/,/g, ""));
          if (Math.abs(val) > 0 && Math.abs(val) < 5000000) { amt = val; break; }
        }
        // 纯数字（无¥前缀）
        const m2 = c.match(/^(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$/);
        if (m2) {
          const val = parseFloat(m2[1].replace(/,/g, ""));
          if (Math.abs(val) > 0 && Math.abs(val) < 5000000) { amt = val; break; }
        }
      }
      if (amt === null) continue;

      // 找描述（含中文且非日期/金额，至少2字）
      let desc = "";
      for (const c of cells) {
        if (
          /[\u4e00-\u9fff]/.test(c) &&
          !/^\d{8}$/.test(c) &&
          c.length >= 2 &&
          !/^[¥￥\s\d.,-]+$/.test(c)
        ) {
          desc = c.substring(0, 200);
          break;
        }
      }
      if (!desc) continue;

      // 找卡号末4
      let cardLast4 = this.defaultCardLast4;
      for (const c of cells) {
        if (/^\d{4}$/.test(c) && c !== dates[0] && c !== dates[1]) {
          cardLast4 = c;
        }
      }

      // YYYYMMDD → YYYY-MM-DD
      const fmt = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

      // 交易类型
      let transType;
      if (amt > 0) {
        transType = "SPEND";
        if (desc.includes("利息")) transType = "INSTALLMENT_INT";
        if (desc.includes("摊消") || desc.includes("本金")) transType = "INSTALLMENT_PRIN";
      } else {
        transType = desc.includes("还款") ? "REPAY" : "REFUND";
      }

      trans.push({
        trans_date: fmt(dates[0]),
        post_date: fmt(dates[1]),
        description: desc,
        amount: amt,
        card_last4: cardLast4,
        trans_type: transType,
      });
    }

    return trans;
  },

  /** 提取账单信息 */
  _extractBillInfo(html, transactions) {
    // 从账户信息表提取：信用额度、最低还款额、账单日、到期还款日
    const dates = [];
    const dateRe = /<td[^>]*>(\d{8})<\/td>/g;
    let m;
    while ((m = dateRe.exec(html)) !== null) {
      if (!dates.includes(m[1])) dates.push(m[1]);
    }

    const fmt = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

    // 找"账单日"和"到期还款日"后面的日期
    let billDate = null;
    let dueDate = null;

    const billMatch = html.match(/账单日[\s\S]*?<td[^>]*>(\d{8})<\/td>/);
    if (billMatch) billDate = fmt(billMatch[1]);

    const dueMatch = html.match(/到期还款日[\s\S]*?<td[^>]*>(\d{8})<\/td>/);
    if (dueMatch) dueDate = fmt(dueMatch[1]);

    // 账期=账单日所在的月份
    const billCycle = billDate ? billDate.slice(0, 7) : null;

    // 从交易日期推断cycle范围
    let cycleStart = null, cycleEnd = null;
    if (transactions && transactions.length > 0) {
      const allDates = transactions.map((t) => t.trans_date).sort();
      cycleStart = allDates[0];
      cycleEnd = allDates[allDates.length - 1];
    }

    return {
      billDate,
      dueDate,
      billCycle,
      cycleStart,
      cycleEnd,
      cardLast4: this.defaultCardLast4,
      cardholder: this.defaultCardholder,
    };
  },
};

module.exports = bank;
