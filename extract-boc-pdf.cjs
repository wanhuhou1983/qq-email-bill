/**
 * 从 boc_raw.eml 中提取 octet-stream 附件（实际是PDF）
 */
"use strict";
const fs = require("fs");

const eml = fs.readFileSync("boc_raw.eml", "utf-8");

// 找 octet-stream 的 base64 块
const re = /Content-Type:\s*application\/octet-stream[\s\S]*?Content-Transfer-Encoding:\s*base64[\r\n]+\r?\n([\s\S]+?)(?=\r?\n------=_Part_)/i;
const match = eml.match(re);

if (match) {
  const pdfData = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  const fn = "boc_statement.pdf";
  fs.writeFileSync(fn, pdfData);
  console.log(`PDF已保存: ${fn} (${pdfData.length} bytes)`);
  
  // 检查是不是真正的PDF
  console.log("文件头:", pdfData.slice(0, 10).toString());
} else {
  console.log("未找到octet-stream块");
}
