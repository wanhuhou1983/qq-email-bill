const { ImapFlow } = require('imapflow');

async function main() {
  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: { user: process.env.QQ_EMAIL_ACCOUNT, pass: process.env.QQ_EMAIL_AUTH_CODE },
  });

  await client.connect();

  // List folders to find 民生银行
  const { folders } = await client.list();
  console.log('=== 文件夹列表 ===');
  for (const f of folders) {
    if (f.name.includes('民生') || f.path.includes('minsheng') || f.path.includes('cmbc') || f.name.includes('其他')) {
      console.log(`FOUND: ${f.path} (${f.name})`);
    }
  }

  // Try "其他" folder first
  let lock = await client.mailboxOpen('"其他文件夹"');
  console.log(`\n=== 其他文件夹: ${lock.exists} 封邮件 ===`);

  // Search for 民生
  let msgs = await client.search({ from: '民生', subject: '账单' });
  console.log(`搜索 "from=民生 + subject=账单": ${msgs.length} 封`);
  
  if (msgs.length > 0) {
    const latest = msgs[msgs.length - 1];
    console.log(`取最新: UID=${latest}`);
    
    const msg = await client.fetchOne(latest, { source: true, envelope: true });
    console.log(`发件人: ${msg.envelope.from[0]?.address}`);
    console.log(`日期: ${msg.envelope.date?.toISOString()}`);
    console.log(`主题: ${msg.envelope.subject}`);

    // Save raw HTML
    const fs = require('fs');
    fs.writeFileSync(
      'minsheng_raw.html',
      `=== 民生信用卡电子账单 ===\n发件人: "${msg.envelope.from[0]?.name}" <${msg.envelope.from[0]?.address}>\n日期: ${msg.envelope.date?.toISOString()}\n\n--- 完整 HTML ---\n${msg.source.toString('utf-8')}`
    );
    console.log('\n已保存: minsheng_raw.html');
  }

  // Also try broader search
  if (msgs.length === 0) {
    msgs2 = await client.search({ subject: ['民生', '对账'] });
    console.log(`\n备搜 "subject包含民生/对账": ${msgs2.length} 封`);
    for (const uid of msgs2) {
      const m = await client.fetchOne(uid, { envelope: true });
      console.log(`  UID=${uid}: [${m.envelope.date}] ${m.envelope.subject}`);
    }
  }

  // Try direct 民生 folder
  try {
    lock2 = await client.mailboxOpen('"民生银行"', { readOnly: true });
    console.log(`\n=== 民生银行文件夹: ${lock2.exists} 封 ===`);
  } catch(e) {
    console.log(`\n民生银行文件夹不存在或无法打开`);
  }

  await client.logout();
}

main().catch(console.error);
