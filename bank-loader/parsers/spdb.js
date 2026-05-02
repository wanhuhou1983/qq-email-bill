/**
 * bank-loader/parsers/spdb.js — 浦发银行信用卡账单解析器
 *
 * 来源: 本地XLS文件（QQ邮箱无浦发邮件）
 * 格式: 交易日期|记账日期|交易摘要|卡号末四位|卡片类型|币种|交易金额|原始金额
 * 日期: YYYYMMDD（8位无分隔符）
 * 金额: 正=消费, 负=还款（符号已正确）
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const PYTHON = path.join(__dirname, "..", "..", ".venv", "Scripts", "python.exe");

const bank = {
  code: "SPDB",
  name: "浦发银行",
  defaultCardholder: "吴华辉",
  defaultCardLast4: "2659",
  qqFolder: null,  // 无QQ邮箱自动导入，通过Web上传

  /** 从本地XLS文件解析 */
  parseFromFile(filePath) {
    const r = spawnSync(PYTHON, ["-c", `
import pandas as pd, sys, json
df = pd.read_excel("${filePath.replace(/\\/g, '/')}", header=None)
trans = []
for i in range(1, len(df)):
    row = df.iloc[i]
    try:
        td = str(int(row[0]))
        pd_ = str(int(row[1]))
        desc = str(row[2])[:200]
        card = str(int(row[3]))
        amt = float(row[6])
        if len(td) == 8 and len(pd_) == 8:
            td_f = td[:4]+"-"+td[4:6]+"-"+td[6:8]
            pd_f = pd_[:4]+"-"+pd_[4:6]+"-"+pd_[6:8]
            trans.append({"trans_date":td_f,"post_date":pd_f,"description":desc,"amount":amt,"card_last4":card})
    except: pass
print(json.dumps(trans, ensure_ascii=False))
`]);
    if (r.error || r.status !== 0) return [];
    return JSON.parse(r.stdout.toString());
  },

  parse(html, envelope) {
    // 浦发不通过HTML解析
    return { transactions: [], billInfo: {} };
  },
};

module.exports = bank;
