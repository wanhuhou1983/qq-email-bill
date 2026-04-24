import Imap from 'imap';
import { simpleParser } from 'mailparser';

const account = process.env.QQ_EMAIL_ACCOUNT;
const authCode = process.env.QQ_EMAIL_AUTH_CODE;

if (!account || !authCode) {
  console.error('请设置环境变量 QQ_EMAIL_ACCOUNT 和 QQ_EMAIL_AUTH_CODE');
  process.exit(1);
}

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
        const recent = uids.slice(-100);
        const fetch = imap.fetch(recent, { bodies: '' });
        let emails = [];
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (parsed && parsed.subject) {
                const subj = parsed.subject.toLowerCase();
                if (subj.includes('农业') || subj.includes('银行') || subj.includes('信用卡') || subj.includes('账单')) {
                  emails.push({subject: parsed.subject, from: parsed.from?.text, folder: folderName, uid: msg.uid});
                }
              }
            });
          });
        });
        fetch.once('end', () => {
          setTimeout(() => resolve(emails), 2000);
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
  console.log('\n===== 找到农业银行/信用卡/账单相关邮件 =====');
  allEmails.forEach((e, i) => console.log(i+1 + '.', e.subject, '-', e.from, '- 文件夹:', e.folder, '- UID:', e.uid));
  imap.end();
});

imap.on('error', (err) => console.error('IMAP错误:', err));
imap.connect();
