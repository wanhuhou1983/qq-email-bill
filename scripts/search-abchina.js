import Imap from 'imap';
import { simpleParser } from 'mailparser';

const account = process.env.QQ_EMAIL_ACCOUNT;
const authCode = process.env.QQ_EMAIL_AUTH_CODE;

const imap = new Imap({
  user: account,
  password: authCode,
  host: 'imap.qq.com',
  port: 993,
  tls: true
});

function searchFolder(folderName) {
  return new Promise((resolve) => {
    imap.openBox(folderName, false, (err, box) => {
      if (err) { resolve([]); return; }
      imap.search(['ALL'], (err, uids) => {
        if (err || !uids || uids.length === 0) { resolve([]); return; }
        const all = uids;
        const fetch = imap.fetch(all, { bodies: '' });
        let emails = [];
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (parsed && parsed.from && parsed.from.value) {
                const fromAddr = parsed.from.value[0]?.address || '';
                if (fromAddr.includes('abchina.com.cn') || fromAddr.includes('creditcard')) {
                  emails.push({
                    subject: parsed.subject,
                    from: fromAddr,
                    date: parsed.date,
                    uid: msg.uid,
                    folder: folderName
                  });
                }
              }
            });
          });
        });
        fetch.once('end', () => {
          setTimeout(() => resolve(emails), 3000);
        });
      });
    });
  });
}

imap.once('ready', async () => {
  const folders = ['INBOX', 'Sent Messages', 'Drafts', 'Deleted Messages', 'Junk', '其他文件夹'];
  let allEmails = [];
  for (const folder of folders) {
    console.log('搜索文件夹:', folder);
    const emails = await searchFolder(folder);
    allEmails = allEmails.concat(emails);
  }
  console.log('\n===== 找到农业银行邮件 =====');
  console.log('数量:', allEmails.length);
  allEmails.forEach((e, i) => console.log(i+1 + '.', e.subject, '\n    发件人:', e.from, '\n    文件夹:', e.folder, '\n    UID:', e.uid, '\n    日期:', e.date, '\n'));
  imap.end();
});
imap.connect();
