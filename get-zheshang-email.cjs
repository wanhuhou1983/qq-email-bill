/**
 * 从QQ邮箱获取浙商银行信用卡账单最新原始HTML
 */
"use strict";
const { ImapFlow } = require("imapflow");

async function main() {
  const client = new ImapFlow({
    host: "imap.qq.com",
    port: 993,
    secure: true,
    auth: { user: process.env.QQ_EMAIL_ACCOUNT, pass: process.env.QQ_EMAIL_AUTH_CODE },
    logger: false,
  });

  await client.connect();
  
  // 列出文件夹
  const folders = await client.list();
  console.log("=== QQ邮箱文件夹列表 ===");
  for (const f of folders) console.log(`  ${f.path}`);
  
  // 在"其他"文件夹查找浙商银行
  let targetFolder = null;
  for (const f of folders) {
    if (f.path.includes("其他") || f.path.includes("Other")) { targetFolder = f; break; }
  }

  if (!targetFolder) {
    console.log("\n未找到'其他'文件夹，搜索全部...");
    for (const f of folders) {
      if (!f.path.startsWith("INBOX") && !f.path.includes("已删") && !f.path.includes("垃圾") && !f.path.includes("Drafts")) {
        targetFolder = f; break;
      }
    }
  }
  
  let lock = await client.mailboxOpen(targetFolder ? targetFolder.path : "其他");
  console.log(`\n打开: ${targetFolder?.path || "其他"} (${lock.exists} 封)`);

  // 搜索浙商银行
  const messages = await client.search({
    from: "czbank",
    subject: "对账单"
  });
  console.log(`找到浙商银行账单: ${messages.length} 封`);

  if (messages.length === 0) { 
    console.log("\n未找到浙商银行账单邮件"); 
    await client.logout(); 
    return; 
  }

  // 取最新一封
  const latest = messages[messages.length - 1];
  const msg = await client.fetchOne(latest, { source: true, envelope: true });
  
  const fs = require("fs");
  const html = msg.source.toString("utf-8");
  fs.writeFileSync("zheshang_raw.html", `=== 浙商信用卡电子账单（${new Date(msg.envelope.date).toISOString().split("T")[0]}） ===\n发件人: "${msg.envelope.from[0]?.name}" <${msg.envelope.from[0]?.address}>\n日期: ${msg.envelope.date}\n\n--- 完整 HTML ---\n${html}`);

  console.log(`\n✅ 已保存: zheshang_raw.html (${(html.length/1024).toFixed(1)}KB)`);
  console.log(`主题: ${msg.envelope.subject}`);
  await client.logout();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
