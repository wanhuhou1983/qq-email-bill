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
      const all = uids;
      const fetch = imap.fetch(all, { bodies: '' });
      let emails = [];
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, (err, parsed) => {
            if (parsed && parsed.from && parsed.from.value) {
              const fromAddr = (parsed.from.value[0]?.address || '').toLowerCase();
              emails.push({
                subject: parsed.subject,
                from: fromAddr,
                date: parsed.date
              });
            }
          });
        });
      });
      fetch.once('end', () => {
        setTimeout(() => {
          console.log('\n===== 最近所有邮件发件人 =====');
          emails.forEach((e, i) => console.log(i+1 + '.', e.from, '-', e.subject));
          imap.end();
        }, 3000);
      });
    });
  });
});
imap.connect();
