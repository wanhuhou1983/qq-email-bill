"use strict";
const { ImapFlow } = require("imapflow");
const fs = require("fs");
const iconv = require("iconv-lite");

const AUTH = { user: "85657238@qq.com", pass: "nepaqqspysbncafe" };

// QP解码返回原始Buffer
function decodeQPToBuffer(qp) {
  const cleaned = qp.replace(/=\r?\n/g, "");
  const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return Buffer.from(latin1, "binary");
}

async function main() {
  const imap = new ImapFlow({ host: "imap.qq.com", port: 993, secure: true, auth: AUTH, logger: false });
  await imap.connect();
  await imap.mailboxOpen("其他文件夹/工商银行");

  // 取最新账单（第7封）
  const msg = await imap.fetchOne(7, { source: true });
  const raw = msg.source.toString("binary"); // 用binary保持原始字节

  // 找QP编码的HTML部分
  const m = raw.match(/Content-Type: text\/html;[\s\S]*?charset=GBK[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--(?:\r?\n|$)|\r?\n$)/i);
  if (!m) {
    console.log("❌ 未找到HTML部分");
    // 打印原始邮件前500字
    console.log(raw.substring(0, 500));
    await imap.logout();
    return;
  }

  const qpContent = m[1];
  console.log(`QP编码内容: ${qpContent.length} 字符`);

  // QP → 原始字节 → GBK解码
  const buf = decodeQPToBuffer(qpContent);
  console.log(`解码后Buffer: ${buf.length} 字节`);
  const decoded = iconv.decode(buf, "GBK");
  console.log(`GBK解码后: ${decoded.length} 字符`);

  fs.writeFileSync("icbc_decoded.html", decoded);
  console.log("\n✅ 已保存 icbc_decoded.html");

  // 打印前2000字看看结构
  console.log("\n=== 内容预览 ===\n", decoded.substring(0, 2000));

  await imap.logout();
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
