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

imap.once('ready', () => {
  imap.openBox('INBOX', false, (err, box) => {
    if (err) { console.error(err); imap.end(); return; }
    imap.search(['ALL'], (err, uids) => {
      if (err) { console.error(err); imap.end(); return; }
      console.log('总邮件数:', uids.length);
      const recent = uids.slice(-100);
      const fetch = imap.fetch(recent, { bodies: '' });
      let emails = [];
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, (err, parsed) => {
            if (parsed && parsed.subject) {
              const subj = parsed.subject.toLowerCase();
              if (subj.includes('农业') || subj.includes('银行') || subj.includes('信用卡') || subj.includes('账单')) {
                emails.push({subject: parsed.subject, from: parsed.from?.text, date: parsed.date, uid: msg.uid});
              }
            }
          });
        });
      });
      fetch.once('end', () => {
        setTimeout(() => {
          console.log('找到农业银行/信用卡/账单相关邮件:', emails.length);
          emails.forEach((e, i) => console.log(i+1 + '.', e.subject, '-', e.from, '- UID:', e.uid));
          imap.end();
        }, 3000);
      });
    });
  });
});
imap.connect();
