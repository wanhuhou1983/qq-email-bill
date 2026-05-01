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
  // 打开农业银行文件夹
  imap.openBox('其他文件夹/农业银行', false, (err, box) => {
    if (err) {
      console.error('打开文件夹失败:', err.message);
      imap.end();
      return;
    }
    console.log('文件夹消息数:', box.messages.total);
    
    // 搜索所有邮件
    imap.search(['ALL'], (err, uids) => {
      if (err) {
        console.error('搜索失败:', err.message);
        imap.end();
        return;
      }
      console.log('总邮件数:', uids.length);
      
      // 获取最近的邮件
      const recent = uids.slice(-50);
      const fetch = imap.fetch(recent, { bodies: '' });
      let emails = [];
      
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, (err, parsed) => {
            if (parsed && parsed.subject) {
              const subj = parsed.subject.toLowerCase();
              // 找信用卡账单
              if (subj.includes('信用卡') || subj.includes('账单') || subj.includes('还款')) {
                emails.push({
                  subject: parsed.subject,
                  from: parsed.from?.text,
                  date: parsed.date,
                  uid: msg.uid,
                  html: parsed.html
                });
              }
            }
          });
        });
      });
      
      fetch.once('end', () => {
        setTimeout(() => {
          console.log('\n===== 找到农业银行信用卡相关邮件 =====');
          console.log('数量:', emails.length);
          emails.forEach((e, i) => console.log(i+1 + '.', e.subject, '\n    UID:', e.uid, '\n    日期:', e.date));
          // 保存HTML用于后续处理
          if (emails.length > 0) {
            console.log('\n最新邮件UID:', emails[emails.length-1].uid);
          }
          imap.end();
        }, 3000);
      });
    });
  });
});

imap.on('error', (err) => console.error('错误:', err));
imap.connect();
