/**
 * batch_fetch_v3.js - Use mailparser for robust email HTML extraction
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = process.argv[2] || './fetched3';
const BANK_FOLDERS = [
  ["其他文件夹/招商银行", "cmb"],
  ["其他文件夹/交通银行", "bocom"],
  ["其他文件夹/光大银行", "ceb"],
  ["其他文件夹/工商银行", "icbc"],
  ["其他文件夹/建设银行", "ccb"],
  ["其他文件夹/农业银行", "abc"],
  ["其他文件夹/中国银行", "boc"],
  ["其他文件夹/中信银行", "citic"],
  ["其他文件夹/平安银行", "pab"],
  ["其他文件夹/广发银行", "cgb"],
  ["其他文件夹/民生银行", "cmbc"],
  ["其他文件夹/浙商银行", "czb"],
  ["其他文件夹/浦发银行", "spdb"],
  ["其他文件夹/宁波银行", "nbc"],
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });

  await imap.connect();
  console.log('Connected\n');

  const seen = new Set();

  for (const [folder, code] of BANK_FOLDERS) {
    if (seen.has(folder)) continue;
    seen.add(folder);

    try {
      const mb = await imap.mailboxOpen(folder);
      if (mb.exists === 0) {
        console.log(`  [${code}] ${folder}: empty`);
        continue;
      }

      const uids = await imap.search({ all: true });
      if (uids.length === 0) continue;

      const uid = uids[uids.length - 1];
      const msg = await imap.fetchOne(uid, { source: true, envelope: true });
      
      // Use mailparser
      const parsed = await simpleParser(msg.source);
      const html = parsed.html;
      
      const outFile = path.join(OUTPUT_DIR, `${code}.html`);
      let hasTable = false;
      if (html) {
        hasTable = html.toLowerCase().includes('<table');
        fs.writeFileSync(outFile, html, 'utf-8');
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, latest=${msg.envelope.date.toISOString().slice(0,10)}, HTML=${(html.length/1024).toFixed(0)}KB${hasTable ? '' : ' ⚠️'}`);
      } else {
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, latest=${msg.envelope.date.toISOString().slice(0,10)}, no HTML`);
        // Save text body as fallback
        if (parsed.text) {
          fs.writeFileSync(outFile + '.txt', parsed.text, 'utf-8');
          console.log(`    Text fallback: ${(parsed.text.length/1024).toFixed(0)}KB`);
        }
      }
    } catch(e) {
      console.log(`  [${code}] ${folder}: ERROR ${e.message}`);
    }
  }

  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
