const { ImapFlow } = require('imapflow');
const fs = require('fs');
const iconv = require('iconv-lite');

async function main() {
  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });
  await imap.connect();
  console.log('Connected');
  await imap.mailboxOpen('其他文件夹/工商银行');
  console.log(`Folder has ${imap.mailbox.exists} messages`);
  const uids = await imap.search({ all: true });
  console.log(`Total UIDs: ${uids.length}`);
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    try {
      const msg = await imap.fetchOne(uid, { source: true, envelope: true });
      const subject = msg.envelope.subject || '(no subject)';
      const date = (msg.envelope.date || '').toString();
      console.log(`[${i+1}/${uids.length}] UID ${uid}: ${subject} (${date})`);
      
      // Extract HTML from source
      const raw = msg.source.toString('binary');
      let html = null;
      // Try simple HTML extraction  
      const m = raw.match(/<html[\s\S]*?<\/html>/i);
      if (m) html = m[0];
      
      if (html) {
        const sanitizedSubj = subject.replace(/[<>:"/\\|?*]/g, '_').substring(0, 60);
        const fname = `icbc_uid${uid}_${sanitizedSubj}.html`;
        fs.writeFileSync(fname, html, 'utf-8');
        console.log(`  -> Saved: ${fname} (${Buffer.byteLength(html, 'utf-8')} bytes)`);
      } else {
        console.log(`  -> No HTML found`);
        fs.writeFileSync(`icbc_uid${uid}.raw`, msg.source);
      }
    } catch(e) {
      console.error(`UID ${uid} error: ${e.message}`);
    }
  }
  await imap.logout();
}
main().catch(e => { console.error(e); process.exit(1); });
