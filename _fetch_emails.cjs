
"use strict";
const { ImapFlow } = require('imapflow');
const fs = require('fs');

async function main() {
  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: { 
      user: process.env.QQ_EMAIL_ACCOUNT || "85657238@qq.com", 
      pass: process.env.QQ_EMAIL_AUTH_CODE || "nepaqqspysbncafe" 
    },
    logger: false
  });

  await client.connect();
  
  // 打开目标文件夹（在 其他文件夹 下）
  const targetFolder = '"其他文件夹/中国银行"';
  let lock;
  try {
    lock = await client.mailboxOpen(targetFolder, { readOnly: true });
  } catch(e) {
    // 尝试直接打开
    try {
      lock = await client.mailboxOpen('"' + 中国银行 + '"', { readOnly: true });
    } catch(e2) {
      console.log(JSON.stringify({ error: "无法打开文件夹: " + e2.message }));
      await client.logout();
      return;
    }
  }

  const total = lock.exists;
  const take = Math.min(total, parseInt(process.argv[2]) || 3);
  const startSeq = total - take + 1;
  
  const results = [];
  for (let i = startSeq; i <= total; i++) {
    try {
      const msg = await client.fetchOne(i, { source: true, envelope: true, structure: true });
      results.push({
        subject: msg.envelope.subject || '',
        date: msg.envelope.date ? msg.envelope.date.toISOString() : '',
        source: msg.source.toString('utf-8'),
      });
    } catch(e) {
      // skip failed messages
    }
  }

  console.log(JSON.stringify(results));
  await client.logout();
}

main().catch(e => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
