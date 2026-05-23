/**
 * save_one_email.js - 从指定QQ邮箱文件夹保存最新一封邮件的HTML
 * 用法: node save_one_email.js <文件夹> <搜索关键词> <输出文件>
 * 例:   node save_one_email.js "其他文件夹/招商银行" "信用卡" test_cmb.html
 */
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const iconv = require('iconv-lite');

const targetFolder = process.argv[2];
const keyword = process.argv[3] || '';
const outputFile = process.argv[4] || 'test_email.html';

if (!targetFolder) {
  console.error('Usage: node save_one_email.js <folder> [keyword] [output.html]');
  process.exit(1);
}

async function main() {
  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });

  await imap.connect();
  console.log('Connected');

  await imap.mailboxOpen(targetFolder);
  console.log(`Folder: ${targetFolder} (${imap.mailbox.exists} messages)`);

  let results = [];
  if (keyword) {
    try { results = await imap.search({ subject: keyword }); } catch(e) {}
    if (results.length === 0) {
      try { results = await imap.search({ from: keyword }); } catch(e) {}
    }
  }
  if (results.length === 0) {
    results = await imap.search({ all: true });
  }

  if (results.length === 0) {
    console.log('No emails found');
    await imap.logout();
    return;
  }

  const uid = results[results.length - 1];
  console.log(`Fetching UID: ${uid} (of ${results.length} total)`);

  const msg = await imap.fetchOne(uid, { source: true, envelope: true });
  console.log(`Subject: ${msg.envelope.subject}`);
  console.log(`Date: ${msg.envelope.date}`);

  const raw = msg.source.toString('binary');

  // Extract HTML body
  let html = null;

  // Find text/html part
  const htmlIdx = raw.search(/Content-Type:\s*text\/html/i);
  if (htmlIdx >= 0) {
    const header = raw.substring(Math.max(0, htmlIdx - 500), htmlIdx + 500);
    const charsetMatch = raw.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
    const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
    const isGBK = charset.includes('gb');

    const cteMatch = header.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const cte = cteMatch ? cteMatch[1].toLowerCase() : '';

    // Extract body after headers
    const bodyStart = raw.indexOf('\r\n\r\n', htmlIdx);
    if (bodyStart < 0) {
      const bodyStart2 = raw.indexOf('\n\n', htmlIdx);
    }
    if (bodyStart >= 0) {
      let bodyEnd = raw.indexOf('\r\n--', bodyStart);
      if (bodyEnd < 0) bodyEnd = raw.length;
      const body = raw.substring(bodyStart + 4, bodyEnd);

      if (cte === 'quoted-printable') {
        const cleaned = body.replace(/=\r?\n/g, '');
        const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)));
        const buf = Buffer.from(latin1, 'binary');
        html = isGBK ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
      } else if (cte === 'base64') {
        const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
        const buf = Buffer.from(b64, 'base64');
        html = isGBK ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
      } else {
        html = isGBK ? iconv.decode(Buffer.from(body, 'binary'), 'gbk') : body;
      }
    }
  }

  // Fallback: find <html> tag
  if (!html) {
    const m = raw.match(/<html[\s\S]*?<\/html>/i);
    if (m) html = m[0];
  }

  if (html) {
    fs.writeFileSync(outputFile, html, 'utf-8');
    console.log(`\nSaved: ${outputFile} (${Buffer.byteLength(html, 'utf-8')} bytes)`);
  } else {
    console.log('\nNo HTML body found, saving raw email');
    fs.writeFileSync(outputFile + '.raw', msg.source);
  }

  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
