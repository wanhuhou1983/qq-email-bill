/**
 * bank-loader/parsers/boc.js - BOC bill parser
 *
 * BOC sends PDF bills. Uses boc_pdf.py (pypdf) to extract.
 * Verification: Logic B (prevBalance + spend - repay = newBalance)
 * Cardholder: from PDF "NAME 先生"
 * Card: 0177
 *
 * VERIFY:
 *   Summary: prevBalance + totalSpend - totalRepay = newBalance
 *   Transaction sign: DP-based optimization against summary totals
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PYTHON_SCRIPT = path.join(__dirname, "boc_pdf.py");

const bank = {
  code: "BOC",
  name: "中国银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "0177",
  qqFolder: "其他文件夹/中国银行",
  searchFrom: "boc",
  searchQueries: [{ from: "boc" }, { subject: "中国银行信用卡" }],

  /**
   * Parse BOC PDF bill and return standardized format.
   * @param {string} pdfPath - Path to PDF file
   * @returns {{ transactions: Array, billInfo: Object }}
   */
  parsePDF(pdfPath) {
    const r = spawnSync("python", [PYTHON_SCRIPT, pdfPath], {
      encoding: "utf-8",
      timeout: 30000,
    });

    if (r.error || r.status !== 0) {
      console.error("BOC PDF parse error:", r.error || r.stderr);
      return { transactions: [], billInfo: {} };
    }

    let data;
    try {
      data = JSON.parse(r.stdout.toString());
    } catch (e) {
      console.error("BOC JSON parse error:", e.message);
      return { transactions: [], billInfo: {} };
    }

    // Convert to standard format
    const transactions = (data.transactions || []).map((t) => ({
      trans_date: t.trans_date,
      post_date: t.post_date,
      description: t.description,
      amount: t.amount,
      card_last4: t.card_last4 || this.defaultCardLast4,
    }));

    const billInfo = {
      billDate: data.bill_date,
      dueDate: data.due_date,
      billCycle: data.bill_month
        ? data.bill_month.replace("年", "-").replace("月", "")
        : null,
      statementBalance: data.new_balance,
      prevBalance: data.prev_balance,
      totalSpend: data.total_spend,
      totalRepay: data.total_repay,
      cardLast4: data.card_last4 || this.defaultCardLast4,
      cardholder: data.cardholder || this.defaultCardholder,
    };

    return { transactions, billInfo };
  },

  /**
   * Parse HTML/email (fallback, BOC uses PDF)
   */
  parse(html, envelope) {
    return { transactions: [], billInfo: {} };
  },
};

module.exports = bank;
