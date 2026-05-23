/**
 * list_folders.js - List all QQ IMAP folders
 */
const { ImapFlow } = require('imapflow');

async function main() {
  const imap = new ImapFlow({
    host: 'imap.qq.com', port: 993, secure: true,
    auth: { user: '85657238@qq.com', pass: 'nepaqqspysbncafe' },
    logger: false,
  });

  await imap.connect();
  const folders = await imap.list();
  
  for (const f of folders) {
    try {
      const cnt = (await imap.mailboxOpen(f.path)).exists;
      console.log(`${String(cnt).padStart(4)} | ${f.path}`);
    } catch(e) {
      console.log(`  ?? | ${f.path}`);
    }
  }

  await imap.logout();
}

main().catch(e => { console.error(e); process.exit(1); });
