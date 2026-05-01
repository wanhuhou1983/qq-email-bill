import Imap from 'imap';

const account = process.env.QQ_EMAIL_ACCOUNT;
const authCode = process.env.QQ_EMAIL_AUTH_CODE;

const imap = new Imap({
  user: account,
  password: authCode,
  host: 'imap.qq.com',
  port: 993,
  tls: true
});

function listAllBoxes(path, depth) {
  return new Promise((resolve) => {
    imap.getBoxes(path, (err, boxes) => {
      if (err || !boxes) { resolve([]); return; }
      let results = [];
      Object.keys(boxes).forEach(name => {
        results.push('  '.repeat(depth) + name);
        if (boxes[name].children) {
          Object.keys(boxes[name].children).forEach(sub => {
            results.push('  '.repeat(depth+1) + '↳ ' + sub);
          });
        }
      });
      resolve(results);
    });
  });
}

imap.once('ready', async () => {
  console.log('===== 邮箱文件夹完整列表 =====');
  const boxes = await listAllBoxes('', 0);
  boxes.forEach(b => console.log(b));
  imap.end();
});
imap.connect();
