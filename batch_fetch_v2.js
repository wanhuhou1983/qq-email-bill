/**
 * batch_fetch.js v2 - Proper MIME email HTML extraction
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

/** Decode quoted-printable */
function decodeQP(text) {
  return text
    .replace(/=\r?\n/g, '')  // Remove soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Decode base64 to buffer */
function decodeB64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  return Buffer.from(clean, 'base64');
}

/** Check if string looks like base64 (starts with valid base64 patterns) */
function looksLikeBase64(s) {
  const clean = s.replace(/[\s\r\n]/g, '');
  return /^[A-Za-z0-9+/]{20,}=*$/.test(clean) && clean.length > 100;
}

/** Check if string is already HTML */
function looksLikeHTML(s) {
  return /<(!DOCTYPE|html|head|body|table|div|p\b|br\b|a\b)/i.test(s.substring(0, 500));
}

/** Decode charset */
function decodeCharset(buf, charset) {
  charset = (charset || 'utf-8').toLowerCase().replace(/["']/g, '');
  if (charset === 'utf-8' || charset === 'utf8') return buf.toString('utf-8');
  if (charset === 'ascii') return buf.toString('ascii');
  try {
    if (iconv.encodingExists(charset)) return iconv.decode(buf, charset);
  } catch(e) {}
  return buf.toString('utf-8');
}

/** Extract HTML body from raw email source */
function extractHtml(raw) {
  const lines = raw.split(/\r?\n/);
  
  // Find text/html part boundaries
  let htmlStart = -1, htmlEnd = lines.length;
  let cte = '';
  let charset = 'utf-8';
  let boundary = null;
  let partDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    
    // Detect boundary
    const bm = l.match(/^--([^\s]+)/);
    if (bm) {
      if (!boundary) boundary = bm[1];
      if (l.includes('--' + boundary + '--')) {
        if (partDepth > 0) { htmlEnd = i; break; }
        if (!boundary) { htmlEnd = i; break; }
      }
    }
    
    // Found text/html
    if (/^Content-Type:\s*text\/html/i.test(l)) {
      htmlStart = i;
      const cm = l.match(/charset\s*=\s*"?([a-z0-9_-]+)"?/i);
      if (cm) charset = cm[1].toLowerCase();
      
      // Check for boundary in this or next lines
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const bm2 = lines[j].match(/boundary="([^"]+)"/i);
        if (bm2) { boundary = bm2[1]; break; }
      }
      
      // Look for Content-Transfer-Encoding in preceding lines
      for (let j = Math.max(0, i - 10); j < i; j++) {
        const ctm = lines[j].match(/^Content-Transfer-Encoding:\s*(\S+)/i);
        if (ctm) { cte = ctm[1].toLowerCase(); break; }
      }
    }
    
    // CTE may be on next line after Content-Type
    if (htmlStart >= 0 && i === htmlStart + 1) {
      const ctm = l.match(/^Content-Transfer-Encoding:\s*(\S+)/i);
      if (ctm) cte = ctm[1].toLowerCase();
    }
    
    // Find body start (blank line after headers)
    if (htmlStart >= 0 && htmlEnd === lines.length && l.trim() === '' && partDepth === 0) {
      // This blank line is the body separator
      const bodyLines = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l2 = lines[j];
        // Check if we hit a boundary
        if (boundary && /^--/.test(l2)) break;
        bodyLines.push(l2);
      }
      
      if (bodyLines.length > 0) {
        const rawBody = bodyLines.join('\n');
        
        // Try to decode
        let decoded = null;
        
        if (cte === 'base64') {
          try {
            const buf = decodeB64(rawBody);
            decoded = decodeCharset(buf, charset);
          } catch(e) {}
        } else if (cte === 'quoted-printable' || rawBody.includes('=3D') || rawBody.includes('=') && /=[0-9A-F]{2}/i.test(rawBody)) {
          decoded = decodeQP(rawBody);
          // If decoded looks like base64, double-decode
          if (looksLikeBase64(decoded)) {
            try {
              const buf2 = decodeB64(decoded);
              decoded = decodeCharset(buf2, charset);
            } catch(e) {}
          }
        } else if (looksLikeBase64(rawBody)) {
          try {
            const buf = decodeB64(rawBody);
            decoded = decodeCharset(buf, charset);
          } catch(e) {}
        } else {
          decoded = rawBody;
        }
        
        if (decoded && (looksLikeHTML(decoded) || decoded.includes('<table') || decoded.includes('￥') || decoded.includes('尊敬的'))) {
          return decoded;
        }
        
        // One more try: if decoded is still base64-like
        if (decoded && looksLikeBase64(decoded.replace(/\s/g, ''))) {
          try {
            const buf2 = decodeB64(decoded.replace(/\s/g, ''));
            decoded = decodeCharset(buf2, charset);
            if (looksLikeHTML(decoded)) return decoded;
          } catch(e) {}
        }
      }
    }
  }
  
  // Last resort: search entire document for <html> tag
  const htmlm = raw.match(/<html[\s\S]*?<\/html>/i);
  if (htmlm) {
    // Might be QP encoded
    let h = htmlm[0];
    if (h.includes('=3D') || /=[0-9A-F]{2}/i.test(h)) {
      h = decodeQP(h);
    }
    return h;
  }
  
  return null;
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

      const uids = await imap.search({ all: true });
      if (uids.length === 0) continue;

      const uid = uids[uids.length - 1];
      const msg = await imap.fetchOne(uid, { source: { simple: false }, envelope: true });
      const raw = msg.source.toString('binary');
      const html = extractHtml(raw);

      const outFile = path.join(OUTPUT_DIR, `${code}.html`);
      if (html) {
        fs.writeFileSync(outFile, html, 'utf-8');
        const hasData = html.includes('<table') || html.includes('￥') || html.includes('CNY') || html.includes('card');
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, latest=${msg.envelope.date.toISOString().slice(0,10)}, saved (${(html.length/1024).toFixed(0)}KB)${hasData ? '' : ' ⚠️ no table found'}`);
        results.push({ code, folder, date: msg.envelope.date, html, file: outFile });
      } else {
        console.log(`  [${code}] ${folder}: ${mb.exists} msgs, NO HTML extracted`);
        // Save raw for debugging
        fs.writeFileSync(outFile + '.raw', msg.source);
      }
    } catch(e) {
      console.log(`  [${code}] ${folder}: ERROR ${e.message}`);
    }
  }

  console.log(`\nFetched ${results.length} emails`);
  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
