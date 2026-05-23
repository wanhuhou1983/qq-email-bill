
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');

async function main() {
  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });
  await imap.connect();
  console.log('Connected');
  await imap.mailboxOpen('其他文件夹/工商银行');
  console.log(`Folder: ${imap.mailbox.exists} messages`);
  const uids = await imap.search({ all: true });
  
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    try {
      const msg = await imap.fetchOne(uid, { source: true });
      const parsed = await simpleParser(msg.source);
      const date = (parsed.date || '').toString();
      console.log(`[${i+1}/${uids.length}] UID ${uid}: ${parsed.subject} (${date})`);
      
      let html = parsed.html || '';
      if (!html) {
        // Try to find text body
        html = parsed.text || '';
      }
      
      if (html) {
        const safeSubj = (parsed.subject || 'icbc').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
        const fname = `icbc_uid${uid}_${date.substring(0,10)}_${safeSubj}.html`;
        fs.writeFileSync(fname, html, 'utf-8');
        console.log(`  -> Saved: ${fname} (${Buffer.byteLength(html, 'utf-8')} bytes)`);
      } else {
        console.log(`  -> No HTML/text body`);
        fs.writeFileSync(`icbc_uid${uid}.raw`, msg.source);
      }
    } catch(e) {
      console.error(`UID ${uid} error: ${e.message}`);
    }
  }
  await imap.logout();
}
main().catch(e => { console.error(e); process.exit(1); });
