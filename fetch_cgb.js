const { simpleParser } = require('mailparser');
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

const PROJECT = 'C:\\Users\\linhu\\WorkBuddy\\2026-05-12-task-10\\qq-email-bill';
const OUTPUT_DIR = path.join(PROJECT, 'fetched3');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: {
      user: '85657238@qq.com',
      pass: 'nepaqqspysbncafe'
    },
    logger: false
  });

  await client.connect();
  console.log('Connected');

  const mailbox = '其他文件夹/广发银行';
  const lock = await client.getMailboxLock(mailbox);
  try {
    console.log('Mailbox: ' + mailbox + ', exists: ' + client.mailbox.exists);
    
    // Search all messages
    const searchResult = await client.search({ all: true });
    console.log('Found ' + searchResult.length + ' emails');
    
    if (searchResult.length > 0) {
      const seq = searchResult[searchResult.length - 1]; // latest
      console.log('Latest sequence: ' + seq);
      
      const msg = await client.fetchOne(seq, { source: true, envelope: true });
      const parsed = await simpleParser(msg.source);
      
      const html = parsed.html || '';
      const text = parsed.text || '';
      console.log('Subject: ' + (parsed.subject || '(none)'));
      console.log('Date: ' + (parsed.date || '(none)'));
      console.log('HTML length: ' + html.length);
      console.log('Text length: ' + text.length);
      
      if (html) {
        const hasTable = /<table/i.test(html);
        console.log('Has HTML table: ' + hasTable);
        console.log('\n=== HTML sample (first 2000 chars) ===');
        // Find the table
        const tableStart = html.indexOf('<table');
        if (tableStart >= 0) {
          console.log('Table starts at char ' + tableStart);
          console.log(html.substring(tableStart, tableStart + 2000));
        } else {
          console.log(html.substring(0, 2000));
        }
        
        const outFile = path.join(OUTPUT_DIR, 'cgb_latest.html');
        fs.writeFileSync(outFile, html, 'utf-8');
        console.log('\nSaved to: ' + outFile);
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();
  console.log('Disconnected');
}

main().catch(err => { console.error('Error:', err.message || err); process.exit(1); });
