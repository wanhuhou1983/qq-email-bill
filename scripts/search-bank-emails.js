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
      const recent = uids.slice(-200);
      const fetch = imap.fetch(recent, { bodies: '' });
      let emails = [];
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, (err, parsed) => {
            if (parsed && parsed.from && parsed.from.text) {
              const from = parsed.from.text.toLowerCase();
              if (from.includes('abchina') || from.includes('农业银行') || from.includes('bankofchina') || from.includes('creditcard')) {
                emails.push({subject: parsed.subject, from: parsed.from.text, date: parsed.date, uid: msg.uid});
              }
            }
          });
        });
      });
      fetch.once('end', () => {
        setTimeout(() => {
          console.log('\n===== 找到银行/信用卡相关邮件 =====');
          console.log('数量:', emails.length);
          emails.forEach((e, i) => console.log(i+1 + '.', e.subject, '\n    发件人:', e.from, '\n    UID:', e.uid, '\n'));
          imap.end();
        }, 3000);
      });
    });
  });
});
imap.connect();
