/**
 * bank-loader/loader.js — 信用卡账单导入通用框架
 *
 * 工作原理：
 *   1. 根据银行配置连接QQ邮箱IMAP
 *   2. 拉取邮件→检测编码→解码
 *   3. 调对应 parser 解析HTML→标准化数据
 *   4. 自动入库PG（账单头+交易明细）
 *
 * 用法：node bank-loader/loader.js <银行代码>
 * 示例：node bank-loader/loader.js czb
 */
"use strict";

const { ImapFlow } = require("imapflow");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const iconv = require("iconv-lite");

// ============ 全局配置 ============

const IMAP_AUTH = {
  user: "85657238@qq.com",
  pass: "nepaqqspysbncafe",
};

const PG_URI = "postgresql://postgres:DB_PASSWORD@localhost:5432/postgres";

// ============ 编码解码工具 ============

const decoders = {
  /** Quoted-Printable → UTF-8 */
  qp(raw) {
    const cleaned = raw.replace(/=\r?\n/g, "");
    const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    return Buffer.from(latin1, "binary").toString("utf-8");
  },

  /** Base64 → UTF-8 */
  base64(raw, charset = "utf-8") {
    const m = raw.match(/Content-Transfer-Encoding: base64/i);
    if (!m) return raw;
    // 提取base64正文
    const b64 = raw.replace(/.*?\r?\n\r?\n/s, "").replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(b64, "base64").toString(charset);
  },

  /** 普通 UTF-8 */
  utf8(raw) {
    return raw;
  },

  /** 自动检测并解码 email 中的 HTML */
  /** QP解码（原始字节） */
  _qpToBuffer(qp) {
    const cleaned = qp.replace(/=\r?\n/g, "");
    const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(latin1, "binary");
  },

  /** 从raw中提取QP编码的HTML并解码 */
  _decodeQP(raw, charset = "utf-8") {
    const m = raw.match(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--(?:\r?\n|$)|\r?\n$)/i);
    if (m) {
      const buf = this._qpToBuffer(m[1]);
      return iconv.decode(buf, charset);
    }
    // 无boundary时：Content-Type后取所有内容
    const idx = raw.search(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n/i);
    if (idx >= 0) {
      const body = raw.substring(idx);
      const bodyMatch = body.match(/\r?\n\r?\n([\s\S]*)$/);
      if (bodyMatch) {
        const buf = this._qpToBuffer(bodyMatch[1]);
        return iconv.decode(buf, charset);
      }
    }
    return null;
  },

  decodeEmail(raw) {
    // 检测 charset
    const csMatch = raw.match(/charset\s*=\s*["\']?([a-z0-9_-]+)/i);
    const charset = csMatch ? csMatch[1].toLowerCase() : "utf-8";
    const isGBK = charset.includes("gb") || charset.includes("gb2312") || charset.includes("gb18030");

    // 检测编码：找 text/html 附近的 Content-Transfer-Encoding
    const htmlIdx = raw.search(/Content-Type:\s*text\/html/i);
    const nearHtml = htmlIdx >= 0 ? raw.substring(htmlIdx, Math.min(raw.length, htmlIdx + 500)) : raw;
    const cte = (nearHtml.match(/Content-Transfer-Encoding:\s*(\S+)/i) || [])[1]?.toLowerCase();
    const isQP = cte === "quoted-printable";
    const isB64 = cte === "base64";

    // Base64 （优先于 QP 检测，因为 base64 内容也含 =）
    if (isB64) {
      const m = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--(?:\r?\n|$)|\r?\n\w+:\s|\r?\n$)/i);
      if (m) {
        const b64 = m[1].replace(/[^A-Za-z0-9+/=]/g, "");
        try {
          const enc = isGBK ? "gbk" : charset;
          return iconv.decode(Buffer.from(b64, "base64"), enc);
        } catch (e) {}
      }
      // fallback: 从Content-Type后面直接取
      const idx = raw.search(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n/i);
      if (idx >= 0) {
        const body = raw.substring(idx).match(/\r?\n\r?\n([\s\S]*?)$/);
        if (body) {
          const b64 = body[1].replace(/[^A-Za-z0-9+/=]/g, "");
          try { return iconv.decode(Buffer.from(b64, "base64"), isGBK ? "gbk" : charset); } catch (e) {}
        }
      }
    }

    // QP
    if (isQP) {
      const result = this._decodeQP(raw, isGBK ? "gbk" : "utf-8");
      if (result) return result;
    }

    // fallback: 直接取 text/html 后内容试试
    const rawBody = nearHtml.match(/\r?\n\r?\n([\s\S]*?)$/);
    if (rawBody) {
      const cleaned = rawBody[1].replace(/=\r?\n/g, "");
      if (/=[0-9A-Fa-f]{2}/.test(cleaned)) {
        const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        return iconv.decode(Buffer.from(latin1, "binary"), isGBK ? "gbk" : charset);
      }
    }

    // fallback base64 (没有编码头但有 base64 特征)
    const b64FallbackMatch = nearHtml.match(/\r?\n\r?\n([A-Za-z0-9+/=]{100,})/);
    if (b64FallbackMatch) {
      try { return iconv.decode(Buffer.from(b64FallbackMatch[1], "base64"), charset); } catch (e) {}
    }

    // 直接HTML标签
    const htmlMatch = raw.match(/<html[\s\S]*?<\/html>/i);
    if (htmlMatch) return htmlMatch[0];

    return raw;
  },
};

// ============ PG 工具 ============

const PG = {
  _conn: null,
  async connect() {
    this._conn = new Client(PG_URI);
    await this._conn.connect();
  },
  async query(sql, params) {
    return this._conn.query(sql, params);
  },
  async end() {
    if (this._conn) await this._conn.end();
  },

  /** 插入或更新账单头，返回 bill_id */
  async upsertBill(bank, billInfo, emailUid) {
    const {
      billDate, dueDate,
      cycleStart, cycleEnd, billCycle,
      cardLast4, cardholder, statementBalance, minPayment,
    } = billInfo;

    const r = await this.query(
      `INSERT INTO credit_card_bills
       (bank_code, bank_name, cardholder, bill_date, due_date,
        cycle_start, cycle_end, bill_cycle, account_masked,
        statement_balance, min_payment, raw_email_uid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (bank_code, bill_date, account_masked) DO UPDATE
         SET updated_at=NOW()
       RETURNING id`,
      [
        bank.code, bank.name, cardholder || bank.defaultCardholder,
        billDate || cycleEnd, dueDate,
        cycleStart, cycleEnd, billCycle || (billDate ? billDate.slice(0, 7) : null),
        `****${cardLast4 || bank.defaultCardLast4}`,
        statementBalance, minPayment, emailUid,
      ]
    );
    return r.rows[0].id;
  },

  /** 批量插入交易明细（去重） */
  async insertTransactions(billId, bank, transactions) {
    let inserted = 0;
    for (const t of transactions) {
      const tt = this._detectType(t.amount, t.description);
      try {
        const r = await this.query(
          `INSERT INTO credit_card_transactions
           (bill_id, bank_code, cardholder, card_last4, card_type, account_masked,
            trans_date, post_date, description, category,
            amount, currency, trans_type, is_installment, source, raw_line_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'email',$15)
           ON CONFLICT (bank_code, trans_date, post_date, card_last4, description, amount) DO NOTHING`,
          [
            billId, bank.code, t.cardholder || bank.defaultCardholder,
            t.card_last4 || bank.defaultCardLast4, "",
            `****${t.card_last4 || bank.defaultCardLast4}`,
            t.trans_date, t.post_date, t.description, "",
            t.amount, "CNY", tt, false,
            `${t.trans_date}|${t.amount}|${t.description}`,
          ]
        );
        if (r.rowCount > 0) inserted++;
      } catch (e) {
        // ignore dup
      }
    }
    return inserted;
  },

  /** 交易类型自动判断 */
  _detectType(amount, desc) {
    const d = (desc || "").toLowerCase();
    if (amount < 0) {
      if (d.includes("还款")) return "REPAY";
      if (d.includes("退款") || d.includes("退货") || d.includes("返还")) return "REFUND";
      if (d.includes("调整") || d.includes("冲正")) return "ADJUST";
      return "DEPOSIT";
    } else {
      if (d.includes("分期") && (d.includes("本金") || d.includes("摊") || d.includes("每期"))) return "INSTALLMENT_PRIN";
      if (d.includes("分期") && (d.includes("利息") || d.includes("手续费"))) return "INSTALLMENT_INT";
      if (d.includes("年费") || d.includes("滞纳金")) return "FEE";
      if (d.includes("取现") || d.includes("预借")) return "CASH_ADVANCE";
      return "SPEND";
    }
  },

  /** 验证导入结果（独立连接） */
  async verify(bankCode) {
    const c = new Client(PG_URI);
    await c.connect();
    const r = await c.query(
      "SELECT COUNT(*) FROM credit_card_transactions WHERE bank_code=$1", [bankCode]
    );
    const r2 = await c.query(
      "SELECT COUNT(*) FROM credit_card_bills WHERE bank_code=$1", [bankCode]
    );
    await c.end();
    return { transactions: r.rows[0].count, bills: r2.rows[0].count };
  },
};

// ============ 导入流程 ============

async function importBank(bank) {
  console.log(`\n========== ${bank.name} 导入 ==========\n`);

  // 1. IMAP连接
  const imap = new ImapFlow({
    host: "imap.qq.com", port: 993, secure: true,
    auth: IMAP_AUTH, logger: false,
  });
  await imap.connect();
  console.log("✅ IMAP connected");

  // 2. 打开文件夹
  const folder = bank.qqFolder;
  await imap.mailboxOpen(folder);
  console.log(`📬 ${folder}: ${imap.mailbox.exists} 封邮件`);

  // 3. 搜索
  let msgs = [];
  for (const search of bank.searchQueries || [{ from: bank.searchFrom }]) {
    try {
      const r = await imap.search(search);
      if (r && r.length) {
        const s = new Set(msgs.map(Number));
        for (const u of r) s.add(Number(u));
        msgs = [...s];
      }
    } catch (e) { /* ignore */ }
  }

  // 如果搜索没结果但文件夹有邮件，按序号取全部（跳过最后N封非账单）
  if (msgs.length === 0 && imap.mailbox.exists > 0) {
    const total = imap.mailbox.exists;
    const skip = bank.skipLast || 0;
    const start = Math.max(1, total - (bank.maxEmails || total) - skip + 1);
    for (let i = start; i <= total - skip; i++) msgs.push(i);
    console.log(`  (搜索无结果，按序号取 ${msgs.length} 封)`);
  }

  msgs.sort((a, b) => Number(a) - Number(b));
  console.log(`🔍 找到 ${msgs.length} 封\n`);

  if (msgs.length === 0) {
    await imap.logout();
    console.log("❌ 无相关邮件");
    return;
  }

  // 4. PG连接
  await PG.connect();
  let totalInserted = 0;

  for (let i = 0; i < msgs.length; i++) {
    const uid = Number(msgs[i]);
    console.log(`[${i + 1}/${msgs.length}] UID=${uid}`);

    // 拉取邮件
    let msg;
    try {
      msg = await imap.fetchOne(uid, { source: true, envelope: true });
    } catch (e) {
      console.log(`  ⚠ fetch失败: ${e.message}\n`);
      continue;
    }

    const raw = msg.source.toString("binary");
    const subject = msg.envelope?.subject || "";
    console.log(`  主题: ${subject}`);

    // 特殊处理: PDF附件银行（如中行BOC）
    let result;
    if (bank.parseFromRaw) {
      try {
        result = bank.parseFromRaw(raw);
      } catch (e) {
        console.log(`  ⚠ PDF解析失败: ${e.message}\n`);
        continue;
      }
      if (!result || !result.transactions) {
        console.log("  ⚠ 无交易或无PDF\n");
        continue;
      }
    } else {
      // 常规HTML解码
      const decodedHtml = decoders.decodeEmail(raw);
      if (!decodedHtml) {
        console.log("  ⚠ 无法解码\n");
        continue;
      }

      try {
        result = bank.parse(decodedHtml, msg.envelope);
      } catch (e) {
        console.log(`  ⚠ 解析失败: ${e.message}\n`);
        continue;
      }
    }

    if (!result || !result.transactions || result.transactions.length === 0) {
      console.log("  ⚠ 无交易\n");
      continue;
    }

    // 打印预览
    console.log(`  账期: ${result.billInfo?.billCycle || "?"}`);
    console.log(`  交易: ${result.transactions.length} 条`);
    for (let j = 0; j < Math.min(3, result.transactions.length); j++) {
      const t = result.transactions[j];
      console.log(
        `    ${t.trans_date} | ${t.amount > 0 ? "+" : ""}${t.amount}` +
        ` | ${(t.description || "").substring(0, 35)}`
      );
    }

    // 入库
    const billId = await PG.upsertBill(
      bank, result.billInfo || {}, `email-${bank.code}-${uid}`
    );
    console.log(`  账单ID: ${billId}`);

    const inserted = await PG.insertTransactions(billId, bank, result.transactions);
    totalInserted += inserted;
    console.log(`  ✅ 新增 ${inserted} 条\n`);
  }

  await imap.logout();
  await PG.end();

  console.log("==================================");
  console.log(`✅ ${bank.name} 完成！新增 ${totalInserted} 条`);

  // 验证
  const v = await PG.verify(bank.code);
  console.log(`📊 PG ${bank.name} 共 ${v.transactions} 条交易, ${v.bills} 个账单`);
}

// ============ 入口 ============

async function main() {
  const bankCode = process.argv[2]?.toLowerCase();
  if (!bankCode) {
    console.log("用法: node bank-loader/loader.js <银行代码>");
    console.log("可用银行:");
    const parsers = fs.readdirSync(path.join(__dirname, "parsers"));
    for (const p of parsers) {
      if (p.endsWith(".js") && p !== "template.js") {
        const bank = require(`./parsers/${p}`);
        console.log(`  ${bank.code}  ${bank.name}`);
      }
    }
    process.exit(1);
  }

  const parserPath = path.join(__dirname, "parsers", `${bankCode}.js`);
  if (!fs.existsSync(parserPath)) {
    console.error(`❌ 未找到 parser: bank-loader/parsers/${bankCode}.js`);
    process.exit(1);
  }

  const bank = require(parserPath);
  if (typeof bank.parse !== "function") {
    console.error(`❌ parser ${bankCode}.js 缺少 parse() 函数`);
    process.exit(1);
  }

  await importBank(bank);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
