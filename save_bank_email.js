/**
 * save_bank_email.js - 保存指定银行的最新一封邮件HTML到文件
 * 用法: node save_bank_email.js <银行关键词> <输出文件>
 * 例:   node save_bank_email.js cmbchina test_cmb.html
 */
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

const account = process.env.QQ_EMAIL_ACCOUNT || "85657238@qq.com";
const authCode = process.env.QQ_EMAIL_AUTH_CODE || "nepaqqspysbncafe";
const bankKeyword = process.argv[2];
const targetFolder = process.argv[3];
const outputFile = process.argv[4] || 'test_email.html';

if (!bankKeyword) {
  console.error('Usage: node save_bank_email.js <keyword> <output.html>');
  process.exit(1);
}

// 加载 .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^(\w+)=(.+)/);
    if (m) process.env[m[1]] = m[1] === 'QQ_EMAIL_AUTH_CODE' ? m[2] : process.env[m[1]] || m[2];
  }
}

async function main() {
  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: process.env.QQ_EMAIL_ACCOUNT || account, pass: process.env.QQ_EMAIL_AUTH_CODE || authCode },
    logger: false,
  });

  await imap.connect();
  console.log('Connected to IMAP');

  // Try bank-specific folder first, then INBOX
  // Use specified folder directly
  const folder = targetFolder;
  try {
    await imap.mailboxOpen(folder);
  } catch (e) {
    console.error(`Cannot open folder: ${folder} - ${e.message}`);
    await imap.logout();
    return;
  }
  console.log(`Folder: ${folder} (${imap.mailbox.exists} messages)`);

  for (const folder of folders) {
    try {
      await imap.mailboxOpen(folder);
    } catch (e) {
      continue;
    }
    console.log(`Folder: ${folder} (${imap.mailbox.exists} messages)`);

    let results = [];
    // Try subject search
    try { results = await imap.search({ subject: bankKeyword }); } catch(e) {}
    // Try from search
    if (results.length === 0) {
      try { results = await imap.search({ from: bankKeyword }); } catch(e) {}
    }
    // Fallback: get all in this folder
    if (results.length === 0) {
      console.log(`  No keyword match, taking ALL emails from this folder`);
      try { results = await imap.search({ all: true }); } catch(e) {}
    }
    if (results.length === 0) {
      console.log(`  No emails in ${folder}`);
      await imap.logout();
      return;
    }

    // Get the latest email
    const uid = results[results.length - 1];
    console.log(`  Latest UID: ${uid} (total: ${results.length})`);

    const msg = await imap.fetchOne(uid, { source: true, envelope: true });
    console.log(`  Subject: ${msg.envelope.subject}`);
    console.log(`  Date: ${msg.envelope.date}`);

    const raw = msg.source.toString('binary');

    // Extract HTML body from raw email
    let html = null;

    // Try quoted-printable
    const qpMatch = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--(?:\r?\n|$))/i);
    if (qpMatch) {
      const charsetMatch = raw.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
      const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';

      let body = qpMatch[1];
      // Check encoding
      const cteMatch = raw.substring(Math.max(0, raw.indexOf('text/html') - 300),
                                      raw.indexOf('text/html') + 100)
                             .match(/Content-Transfer-Encoding:\s*(\S+)/i);
      const cte = cteMatch ? cteMatch[1].toLowerCase() : '';

      if (cte === 'quoted-printable') {
        const cleaned = body.replace(/=\r?\n/g, '');
        const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)));
        const buf = Buffer.from(latin1, 'binary');
        if (charset.includes('gb') || charset.includes('gb2312') || charset.includes('gb18030')) {
          const iconv = require('iconv-lite');
          html = iconv.decode(buf, 'gbk');
        } else {
          html = buf.toString('utf-8');
        }
      } else if (cte === 'base64') {
        const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
        const buf = Buffer.from(b64, 'base64');
        if (charset.includes('gb')) {
          const iconv = require('iconv-lite');
          html = iconv.decode(buf, 'gbk');
        } else {
          html = buf.toString('utf-8');
        }
      } else {
        html = body;
      }
    }

    // Fallback: try HTML tag
    if (!html) {
      const htmlTag = raw.match(/<html[\s\S]*?<\/html>/i);
      if (htmlTag) html = htmlTag[0];
    }

    if (html) {
      fs.writeFileSync(outputFile, html, 'utf-8');
      const size = Buffer.byteLength(html, 'utf-8');
      console.log(`\nSaved HTML to: ${outputFile} (${size} bytes)`);
    } else {
      console.log('\nCould not extract HTML from email');
      // Save raw for debugging
      fs.writeFileSync(outputFile + '.raw', msg.source, 'binary');
      console.log(`Saved raw email to: ${outputFile}.raw`);
    }

    await imap.logout();
    return;
  }

  console.log('No emails found for this bank in any folder');
  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
