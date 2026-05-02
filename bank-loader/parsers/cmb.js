/**
 * bank-loader/parsers/cmb.js — 招商银行信用卡账单解析器
 *
 * 编码: QP + UTF-8 (loader自动处理)
 * 格式: 大段压缩HTML，交易用TABLE呈现
 *       日期 MMDD (4位)，金额 ¥ 前缀
 */
"use strict";

const bank = {
  code: "CMB", name: "招商银行", defaultCardholder: "吴华辉", defaultCardLast4: "8022",
  qqFolder: "其他文件夹/招商银行", searchFrom: "cmbchina",
  searchQueries: [{ from: "cmbchina" }, { subject: "招商银行信用卡" }],

  parse(html, envelope) {
    // 在 > 后加换行，使HTML可分行处理
    const broken = html.replace(/>/g, ">\n");
    const noJS = broken
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    const text = noJS
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[\t\r\n]+/g, "\n")
      .replace(/\n\s+\n/g, "\n")
      .trim();

    const lines = text.split("\n").map(l => l.trim()).filter(l => l);
    const trans = [];
    const seen = new Set();

    // 年份推断
    let year = new Date().getFullYear();
    for (const l of lines) {
      const m = l.match(/(\d{4})\/\d{2}\/\d{2}\s*-\s*\d{2}\/\d{2}\/\d{2}/);
      if (m) { year = parseInt(m[1]); break; }
    }

    // 遍历：找 4 位日期 (MMDD) → 后面跟描述和 ¥ 金额
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // 跳过非日期行
      if (!/^\d{4}$/.test(l)) continue;
      const n = parseInt(l);
      if (n < 101 || n > 1231) continue;
      const tM = Math.floor(n / 100), tD = n % 100;
      if (tM < 1 || tM > 12 || tD < 1 || tD > 31) continue;

      // 找金额 (从当前行往后找 5 行内是否有 ¥)
      let amount = null, desc = "";
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const am = lines[j].match(/[¥￥]\s*(-?\d[\d,]*\.?\d*)/);
        if (am) {
          amount = parseFloat(am[1].replace(/,/g, ""));
          break;
        }
        // 也可能是纯数字金额（不带¥）
        const am2 = lines[j].match(/^(-?\d+\.\d{2})$/);
        if (am2) {
          amount = parseFloat(am2[1]);
          break;
        }
      }
      if (amount === null || Math.abs(amount) > 5000000) continue;

      // 描述：日期行后面的中文内容
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/[\u4e00-\u9fff]/.test(lines[j]) && !lines[j].startsWith("¥") && !/^\d+\.\d+$/.test(lines[j])) {
          desc = lines[j].replace(/^\d{4}/, "").trim().substring(0, 200);
          break;
        }
      }
      if (!desc) continue;

      // 年份推断
      let tY = year;
      if (tM > 6) tY = year - 1;
      const td = `${tY}-${String(tM).padStart(2, "0")}-${String(tD).padStart(2, "0")}`;

      // 去重
      const key = `${td}|${amount}|${desc.substring(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      trans.push({ trans_date: td, post_date: td, description: desc, amount, card_last4: "" });
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
