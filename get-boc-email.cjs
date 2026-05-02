/**
 * 拉取中国银行原始账单邮件（含PDF附件）
 */
"use strict";
const { ImapFlow } = require("imapflow");
const fs = require("fs");

async function go() {
  const c = new ImapFlow({
    host: "imap.qq.com",
    port: 993,
    secure: true,
    auth: { user: process.env.QQ_EMAIL_ACCOUNT || "17501073747@qq.com", pass: process.env.QQ_EMAIL_AUTH_CODE || "xqkrzjzjvzuzbdbc" },
    logger: false,
  });
  await c.connect();
  console.log("IMAP OK\n");

  // === 列出文件夹 ===
  const folders = await c.list();
  console.log("=== 文件夹(含银行) ===");
  function show(node, indent = "") {
    const p = (node.path || "");
    if (p.includes("银行") || p.includes("中国") || p.includes("其他")) {
      console.log(indent + p);
    }
    if (node.children) node.children.forEach(ch => show(ch, indent + "  "));
  }
  show(folders);

  // === 中国银行 ===
  const lock = await c.mailboxOpen("其他文件夹/中国银行", { readOnly: true });
  console.log("\n中国银行:", lock.exists, "封");

  if (lock.exists > 0) {
    const m = await c.fetchOne(lock.exists, { source: true, envelope: true });
    console.log("最新:", m.envelope.subject);
    console.log("大小:", m.source.length, "bytes");

    fs.writeFileSync("boc_raw.eml", m.source);
    console.log("boc_raw.eml saved");

    const src = m.source.toString();

    // 找PDF
    if (/pdf/i.test(src)) {
      console.log("\n发现PDF标记!");
      
      const pdfRe = /Content-Type:\s*application\/pdf[^;]*[\r\n]+(?:.*?[\r\n]+)*?Content-Transfer-Encoding:\s*base64[\r\n]+\r?\n([\s\S]*?)(?:\r?\n--)/gi;
      let match, idx = 0;
      while ((match = pdfRe.exec(src)) !== null) {
        const data = Buffer.from(match[1].replace(/\s/g, ""), "base64");
        const fn = `boc_statement_${++idx}.pdf`;
        fs.writeFileSync(fn, data);
        console.log(fn, data.length, "bytes");
      }

      if (idx === 0) {
        // 备用：按filename找
        const altRe = /name="?([^"]+\.pdf)"?[\s\S]*?Content-Transfer-Encoding:\s*base64[\r\n]+\r?\n([\s\S]*?)(?=\r?\n--)/gi;
        while ((match = altRe.exec(src)) !== null) {
          const data2 = Buffer.from(match[2].replace(/\s/g, ""), "base64");
          fs.writeFileSync(`boc_${++idx}.pdf`, data2);
          console.log(`boc_${idx}.pdf`, data2.length, "bytes");
        }
      }

      if (idx === 0) {
        console.log("提取失败，前5000字符:");
        console.log(src.substring(0, 5000));
        
        // 打印关键行
        src.split("\n").forEach((line, i) => {
          if (/(attachment|pdf|filename|content-type|boundary|encoding)/i.test(line) && i < 200)
            console.log("L" + i + ":".padEnd(6), line.trim().substring(0, 140));
        });
      }
    } else {
      console.log("\n无PDF标记，前3000:");
      console.log(src.substring(0, 3000));
    }
  } else {
    console.log("空文件夹");
  }

  await c.logout();
  console.log("\ndone");
}
go().catch(e => { console.error("FATAL:", e.message?.substring(0, 200)); process.exit(1); });
