/**
 * batch_fetch.js - Fetch latest email from each bank folder
 * node batch_fetch.js <output_dir>
 */
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const OUTPUT_DIR = process.argv[2] || './fetched_emails';

const BANK_FOLDERS = [
  ["其他文件夹/招商银行", "cmb"],
  ["其他文件夹/交通银行", "bocom"],
  ["其他文件夹/光大银行", "ceb"],
  ["其他文件夹/光大", "ceb"],
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

function extractHtml(raw) {
  // Find text/html part
  const htmlIdx = raw.search(/Content-Type:\s*text\/html/i);
  if (htmlIdx < 0) return null;

  const charsetMatch = raw.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
  const isGBK = charset.includes('gb');

  // Find Content-Transfer-Encoding before this part
  const before = raw.substring(Math.max(0, htmlIdx - 1000), htmlIdx);
  const cteMatch = before.match(/Content-Transfer-Encoding:\s*(\S+)/i);
  const cte = cteMatch ? cteMatch[1].toLowerCase() : '';

  // Extract body after double newline
  let bodyStart = raw.indexOf('\r\n\r\n', htmlIdx);
  if (bodyStart < 0) bodyStart = raw.indexOf('\n\n', htmlIdx);
  if (bodyStart < 0) return null;
  bodyStart = Math.min(bodyStart + 2, raw.length);

  // Find part boundary
  const boundaryMatch = raw.substring(htmlIdx, htmlIdx + 500).match(/boundary="([^"]+)"/i);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;
  let bodyEnd;
  if (boundary) {
    const b1 = raw.indexOf('\r\n--' + boundary, bodyStart);
    const b2 = raw.indexOf('\n--' + boundary, bodyStart);
    bodyEnd = b1 >= 0 ? b1 : b2 >= 0 ? b2 : raw.length;
  } else {
    bodyEnd = raw.length;
  }

  const body = raw.substring(bodyStart, bodyEnd);

  try {
    if (cte === 'quoted-printable') {
      const cleaned = body.replace(/=\r?\n/g, '');
      const latin1 = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)));
      const buf = Buffer.from(latin1, 'binary');
      return isGBK ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
    } else if (cte === 'base64') {
      const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
      const buf = Buffer.from(b64, 'base64');
      return isGBK ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
    } else {
      return isGBK ? iconv.decode(Buffer.from(body, 'binary'), 'gbk') : body;
    }
  } catch(e) {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });

  await imap.connect();
  console.log('Connected\n');

  // Track seen folders to avoid duplicates
  const seen = new Set();
  const results = [];

  for (const [folder, code] of BANK_FOLDERS) {
    if (seen.has(folder)) continue;
    seen.add(folder);

    try {
      const mb = await imap.mailboxOpen(folder);
      if (mb.exists === 0) {
        console.log(`  [${code}] ${folder}: empty`);
        continue;
      }

      // Get latest email
      const uids = await imap.search({ all: true });
      if (uids.length === 0) continue;

      const uid = uids[uids.length - 1];
      const msg = await imap.fetchOne(uid, { source: true, envelope: true });
      const raw = msg.source.toString('binary');
      const html = extractHtml(raw);

      const outFile = path.join(OUTPUT_DIR, `${code}.html`);
      if (html) {
        fs.writeFileSync(outFile, html, 'utf-8');
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, latest=${msg.envelope.date.toISOString().slice(0,10)}, saved (${(html.length/1024).toFixed(0)}KB)`);
        results.push({ code, folder, date: msg.envelope.date, html, file: outFile });
      } else {
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, but NO HTML body`);
      }
    } catch(e) {
      console.log(`  [${code}] ${folder}: ERROR ${e.message}`);
    }
  }

  console.log(`\nFetched ${results.length} emails`);
  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
