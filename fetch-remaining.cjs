/**
 * 拉取民生+浙商原始账单邮件 v3
 * 用 fetch 按序号拉取，绕过 search 的 bug
 */
"use strict";
const { ImapFlow } = require("imapflow");
const fs = require("fs");

async function go() {
  const c = new ImapFlow({
    host: "imap.qq.com",
    port: 993,
    secure: true,
    auth: { user: process.env.QQ_EMAIL_ACCOUNT, pass: process.env.QQ_EMAIL_AUTH_CODE },
    logger: false,
  });
  await c.connect();
  console.log("✅ 连接成功\n");

  // === 民生银行 ===
  let lock = await c.mailboxOpen("其他文件夹/民生银行", { readOnly: true });
  console.log("📂 民生:", lock.exists, "封");
  
  if (lock.exists > 0) {
    // 直接用序号范围获取最后一封
    const m = await c.fetchOne(lock.exists, { source: true, envelope: true });
    console.log("   最新:", m.envelope.subject);
    fs.writeFileSync(
      "minsheng_raw.html",
      "=== 民生银行信用卡电子账单 ===\n" +
      '发件人: "' + (m.envelope.from[0]?.name || "") + '" <' + (m.envelope.from[0]?.address || "") + ">\n" +
      "日期: " + m.envelope.date + "\n" +
      "主题: " + m.envelope.subject + "\n\n--- 完整 HTML ---\n" +
      m.source.toString("utf-8")
    );
    console.log("   ✅ minsheng_raw.html OK (" + (m.source.length / 1024).toFixed(1) + "KB)");
  }

  // === 浙商银行 ===
  lock = await c.mailboxOpen("其他文件夹/浙商银行", { readOnly: true });
  console.log("\n📂 浙商:", lock.exists, "封");

  if (lock.exists > 0) {
    const m = await c.fetchOne(lock.exists, { source: true, envelope: true });
    console.log("   最新:", m.envelope.subject);
    fs.writeFileSync(
      "zheshang_raw.html",
      "=== 浙商银行信用卡电子账单 ===\n" +
      '发件人: "' + (m.envelope.from[0]?.name || "") + '" <' + (m.envelope.from[0]?.address || "") + ">\n" +
      "日期: " + m.envelope.date + "\n" +
      "主题: " + m.envelope.subject + "\n\n--- 完整 HTML ---\n" +
      m.source.toString("utf-8")
    );
    console.log("   ✅ zheshang_raw.html OK (" + (m.source.length / 1024).toFixed(1) + "KB)");
  }

  await c.logout();
  console.log("\n=== 完成 ===");
}

go().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
