import Imap from 'imap';
import { simpleParser } from 'mailparser';
import fs from 'fs';

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
  imap.openBox('其他文件夹/农业银行', false, (err, box) => {
    if (err) { console.error(err); imap.end(); return; }
    
    // 获取最新一封邮件
    imap.search(['ALL'], (err, uids) => {
      if (err) { console.error(err); imap.end(); return; }
      const latestUid = uids[uids.length - 1];
      console.log('最新邮件UID:', latestUid);
      
      const fetch = imap.fetch(latestUid, { bodies: '' });
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, (err, parsed) => {
            if (err) { console.error(err); imap.end(); return; }
            
            console.log('主题:', parsed.subject);
            console.log('发件人:', parsed.from?.text);
            console.log('日期:', parsed.date);
            
            // 保存HTML到文件
            if (parsed.html) {
              fs.writeFileSync('latest-creditcard-bill.html', parsed.html, 'utf-8');
              console.log('\n已保存HTML到 latest-creditcard-bill.html');
            } else {
              console.log('\n没有HTML内容');
              if (parsed.text) {
                fs.writeFileSync('latest-creditcard-bill.txt', parsed.text, 'utf-8');
                console.log('已保存纯文本到 latest-creditcard-bill.txt');
              }
            }
            imap.end();
          });
        });
      });
      fetch.once('error', (err) => console.error(err));
    });
  });
});

imap.on('error', (err) => console.error(err));
imap.connect();
