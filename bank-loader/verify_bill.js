/**
 * bank-loader/verify_bill.js — 账单自我校对模块 v3
 *
 * 基于实际邮件HTML验证 (fetched_emails目录)
 *
 * 三种账务逻辑:
 *   A. 直接合计: ICBC, PAB, CITIC
 *   B. 递推公式: BOCOM, CCB, CEB, CGB, CZB
 *   X. 图片账单: ABC, CMBC
 *
 * 注意: 邮件HTML中的金额标记可能是:
 *   - 全角￥ U+FFE5
 *   - 半角¥ U+00A5 (&yen; 解码后)
 *   - 纯数字 (RMB/CNY 前缀)
 * 正则统一用 [¥￥] 或直接匹配数字模式
 */

"use strict";

function cleanText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&yen;/g, "¥")
    .replace(/&#65509;/g, "￥")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAmt(text, pattern) {
  var m = text.match(pattern);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

var Y = "[\u00a5\uffe5]";
var AMT = "([\d,]+(?:\.?\d*))";

var verifiers = {
  // ============ ABC ============
  ABC: {
    extractSummary: function(html) {
      var text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#xA;/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      var result = {};
      var sumStart = text.indexOf("\u8d26\u52a1\u8bf4\u660e"); // 账务说明
      if (sumStart >= 0) {
        var sumText = text.substring(sumStart, sumStart + 600);
        var parts = sumText.split("\u4eba\u6c11\u5e01(CNY)"); // 人民币(CNY)
        if (parts.length > 1) {
          var nums = parts[1].match(/[\d,]+(?:\.[\d]+)?/g);
          if (nums && nums.length >= 7) {
            result.newCharge = parseFloat(nums[4].replace(/,/g, ""));
            result.payments = parseFloat(nums[5].replace(/,/g, ""));
            result.statementBalance = parseFloat(nums[0].replace(/,/g, ""));
          }
        }
      }
      return result;
    },
    logic: "A"
  },

  // ============ BOCOM ============
  BOCOM: {
    extractSummary: function(html) {
      var text = cleanText(html);
      return {
        statementBalance: extractAmt(text, new RegExp("本期应还款[^0-9]*" + Y + "\s*" + AMT)),
        prevBalance: extractAmt(text, new RegExp("上期应还款[^0-9]*" + Y + "\s*" + AMT)),
        minPayment: extractAmt(text, new RegExp("最低应还款[^0-9]*" + Y + "\s*" + AMT)),
      };
    },
    logic: "B",
  },

  // ============ CCB ============
  CCB: {
    extractSummary: function(html) {
      var text = cleanText(html);
      var prevBalance = extractAmt(text, /上期账单余额[^0-9]*?([\d,]+\.\d{2})/);
      var statementBalance = extractAmt(text, /应还款额\/溢缴款[^0-9]*?(-?[\d,]+\.\d{2})/);
      var minPayment = extractAmt(text, /最低还款额[^0-9]*?([\d,]+\.\d{2})/);
      if (!statementBalance) {
        statementBalance = extractAmt(text, /本期全部应还款额[^0-9]*?([\d,]+\.\d{2})/);
      }
      return { prevBalance: prevBalance, statementBalance: statementBalance, minPayment: minPayment };
    },
    logic: "B",
  },

  // ============ CEB ============
  CEB: {
    extractSummary: function(html) {
      var text = cleanText(html);
      return {
        prevBalance: extractAmt(text, /上期欠款\s*Opening\s*Balance[^0-9]*?([\d,]+\.?\d*)/i),
        statementBalance: extractAmt(text, /本期欠款\s*Closing\s*Balance[^0-9]*?([\d,]+\.?\d*)/i),
      };
    },
    logic: "CEB",
  },

  // ============ CGB ============
  CGB: {
    extractSummary: function(html) {
      var text = cleanText(html);
      var result = {};
      // Match formula: 3010.78 = 2942.97 - 2961.97 + ...
      var eq = text.match(/(\d[\d,]*\.\d{2})\s*=\s*(\d[\d,]*\.\d{2})\s*-\s*(\d[\d,]*\.\d{2})/);
      if (eq) {
        result.statementBalance = parseFloat(eq[1].replace(/,/g, ''));
        result.prevBalance = parseFloat(eq[2].replace(/,/g, ''));
        result.prevPayment = parseFloat(eq[3].replace(/,/g, ''));
      }
      return result;
    },
    logic: "B",
  },

  // ============ CITIC ============
  CITIC: {
    extractSummary: function(html) {
      var text = cleanText(html);
      return {
        statementBalance: extractAmt(text, new RegExp("本期应还款额[^0-9]*RMB\s*" + AMT, "i")),
        minPayment: extractAmt(text, new RegExp("最低还款额[^0-9]*RMB\s*" + AMT, "i")),
      };
    },
    logic: "A",
  },

  // ============ CMBC ============
  CMBC: { extractSummary: function() { return {}; }, logic: "X" },

  // ============ CZB ============
  CZB: {
    extractSummary: function(html) {
      var text = cleanText(html);
      var result = {};
      var cl = text.match(/信用额度[^0-9]*?([\d,]+)\s+([\d,]+\.?\d*)/);
      if (cl) {
        result.creditLimit = parseFloat(cl[1].replace(/,/g, ""));
        result.minPayment = parseFloat(cl[2].replace(/,/g, ""));
      }
      var fm = text.match(/本期应还金额\s*New\s*Balance[^0-9]*?/);
      if (fm) {
        var rest = text.substring(fm.index, fm.index + 300);
        var amounts = rest.match(/[\u00a5\uffe5]\s*[\d,]+\.\d{2}/g);
        if (amounts && amounts.length >= 4) {
          result.statementBalance = parseFloat(amounts[0].replace(/[^\d.]/g, "").replace(/,/g, ""));
          result.prevBalance = parseFloat(amounts[1].replace(/[^\d.]/g, "").replace(/,/g, ""));
        }
      }
      return result;
    },
    logic: "B",
  },

  // ============ ICBC ============
  ICBC: {
    extractSummary: function(html) {
      var text = cleanText(html);
      var result = {};
      var sum = text.match(/合计[^0-9]*?(-?[\d,]+\.\d{2})\/RMB[^0-9]*?([\d,]+\.\d{2})\/RMB/);
      if (sum) {
        result.totalRepay = Math.abs(parseFloat(sum[1].replace(/,/g, "")));
        result.totalSpend = parseFloat(sum[2].replace(/,/g, ""));
      }
      result.statementBalance = extractAmt(text, new RegExp("本期应还款额[^0-9]*RMB\s*" + AMT, "i"));
      return result;
    },
    logic: "A",
  },

  // ============ PAB ============
  PAB: {
    extractSummary: function(html) {
      var text = cleanText(html);
      var result = {};
      var re = new RegExp("合计\\s*[：:]\\s*" + Y + "\\s*(-?[\\d,]+\\.\\d{2})", "g");
      var m;
      while ((m = re.exec(text)) !== null) {
        var v = parseFloat(m[1].replace(/,/g, ""));
        if (v > 0) result.totalSpend = v;
        else result.totalRepay = Math.abs(v);
      }
      result.statementBalance = extractAmt(text, /本期应还金额[^0-9]*?([\d,]+\.?\d*)/);
      return result;
    },
    logic: "B",
  },
};

function verifyBill(bankCode, html, transactions, billInfo) {
  var v = verifiers[bankCode.toUpperCase()];
  if (!v) return { ok: true, skipped: true, note: "no verifier for " + bankCode };

  var summary = v.extractSummary(html);
  // Parser-extracted summary takes priority over verify_bill extraction
  if (billInfo && billInfo.summary) {
    for (var k in billInfo.summary) {
      if (billInfo.summary[k] != null) summary[k] = billInfo.summary[k];
    }
  }

  var calc = { totalSpend: 0, totalRepay: 0, transactionCount: transactions.length };
  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    if (t.amount > 0) calc.totalSpend += t.amount;
    else calc.totalRepay += Math.abs(t.amount);
  }
  calc.totalSpend = Math.round(calc.totalSpend * 100) / 100;
  calc.totalRepay = Math.round(calc.totalRepay * 100) / 100;
  calc.net = Math.round((calc.totalSpend - calc.totalRepay) * 100) / 100;

  var warnings = [];
  var TOL = 0.02;

  if (v.logic === "A") {
    // ABC uses newCharge/payments; other banks use totalSpend/totalRepay
    var sSpend = summary.newCharge != null ? summary.newCharge : summary.totalSpend;
    var sRepay = summary.payments != null ? summary.payments : summary.totalRepay;
    if (sSpend != null) {
      var d = Math.abs(sSpend - calc.totalSpend);
      if (d > TOL)
        warnings.push("消费合计: 账单=" + sSpend + " 计算=" + calc.totalSpend + " 差" + d.toFixed(2));
    }
    if (sRepay != null) {
      var d = Math.abs(sRepay - calc.totalRepay);
      if (d > TOL)
        warnings.push("还款合计: 账单=" + sRepay + " 计算=" + calc.totalRepay + " 差" + d.toFixed(2));
    }
    if (billInfo && billInfo.rawRowCount != null && billInfo.rawRowCount !== calc.transactionCount) {
      warnings.push("笔数异常: 原始行=" + billInfo.rawRowCount + " 入库=" + calc.transactionCount + " 丢失=" + (billInfo.rawRowCount - calc.transactionCount));
    }
  } else if (v.logic === "CEB") {
    // CEB: exclude installment from spend (already in prevBalance)
    var cebSpend=0,cebRepay=0;
    for(var i=0;i<transactions.length;i++){
      var t=transactions[i];
      if(t.description.indexOf("\u5206\u671f")>=0)continue;
      if(t.amount>0)cebSpend+=t.amount;
      else cebRepay+=Math.abs(t.amount);
    }
    cebSpend=Math.round(cebSpend*100)/100;cebRepay=Math.round(cebRepay*100)/100;
    if(summary.prevBalance!=null&&summary.statementBalance!=null){
      var expected=Math.round((summary.prevBalance+cebSpend-cebRepay)*100)/100;
      var d=Math.abs(summary.statementBalance-expected);
      if(d>1.0)warnings.push("CEB: "+summary.prevBalance+" +"+cebSpend+" -"+cebRepay+" ="+expected+" vs"+summary.statementBalance+" d="+d.toFixed(2));
    }
  } else if (v.logic === "B") {
    if (summary.prevBalance != null && summary.statementBalance != null) {
      var expected = Math.round((summary.prevBalance + calc.totalSpend - calc.totalRepay) * 100) / 100;
      var d = Math.abs(summary.statementBalance - expected);
      if (d > 1.0)
        warnings.push(
          "递推: 上期=" + summary.prevBalance + " +消费=" + calc.totalSpend +
          " -还款=" + calc.totalRepay + " =" + expected +
          " vs应还=" + summary.statementBalance + " 差" + d.toFixed(2)
        );
    } else if (summary.statementBalance != null) {
      if (Math.abs(calc.net) > 0 && Math.abs(summary.statementBalance) > 0) {
        var d = Math.abs(summary.statementBalance - calc.net);
        if (d > 100)
          warnings.push("净额: 应还=" + summary.statementBalance + " 消费-还款=" + calc.net + " 差" + d.toFixed(2));
      }
    }
  }

  return {
    ok: warnings.length === 0,
    summary: summary,
    calculated: calc,
    warnings: warnings,
    logic: v.logic,
  };
}

module.exports = { verifiers: verifiers, verifyBill: verifyBill };
