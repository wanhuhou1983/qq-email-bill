const { verifyBill } = require('./verify_bill');
const fs = require('fs');
const iconv = require('iconv-lite');

function decodeQP(raw, cs) {
  const idx = raw.indexOf('quoted-printable'); if (idx < 0) return null;
  const bp = raw.substring(idx); let bl = bp.indexOf('\r\n\r\n'); if (bl < 0) bl = bp.indexOf('\n\n'); if (bl < 0) return null;
  let body = bp.substring(bl + 2); const end = body.indexOf('\n--'); if (end > 0) body = body.substring(0, end);
  const cleaned = body.replace(/=\r?\n/g, '');
  return iconv.decode(Buffer.from(cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary'), cs);
}
function decodeB64(raw, cs) {
  const idx = raw.indexOf('base64'); if (idx < 0) return null;
  const bp = raw.substring(idx); let bl = bp.indexOf('\r\n\r\n'); if (bl < 0) bl = bp.indexOf('\n\n'); if (bl < 0) return null;
  let b64 = bp.substring(bl + 2).replace(/[^A-Za-z0-9+\/=]/g, ''); while (b64.length % 4) b64 += '=';
  try { const buf = Buffer.from(b64, 'base64'); return cs && !/utf-?8/i.test(cs) ? iconv.decode(buf, cs) : buf.toString('utf-8'); } catch(e) { return null; }
}

const tests = [
  ['BOCOM','C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/BOCOM','GBK','b64'],
  ['CMBC', 'C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/CMBC','GB2312','b64'],
  ['CEB',  'C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/CEB','GB18030','qp'],
  ['PAB',  'C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/PAB','GBK','qp'],
  ['CZB',  'C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/CZB','UTF-8','qp'],
  ['CGB',  'C:/Users/linhu/.openclaw-autoclaw/workspace/fetched_emails/CGB','GBK','b64'],
];

for (const [code, dir, cs, enc] of tests) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.eml')).sort();
  const f = files[files.length - 1];
  const raw = fs.readFileSync(dir + '/' + f, 'utf-8');
  const html = enc === 'qp' ? decodeQP(raw, cs) : decodeB64(raw, cs);
  if (!html) { console.log(code + ': DECODE FAILED'); continue; }
  let result;
  try {
    const bank = require('./parsers/' + code.toLowerCase() + '.js');
    result = bank.parse(html);
  } catch(e) {
    console.log(code + ': PARSE ERROR - ' + e.message.substring(0, 80));
    continue;
  }
  const v = verifyBill(code, html, result.transactions, result.billInfo);
  console.log('=== ' + code + ' ===');
  console.log('  Tx:' + result.transactions.length + '  Spend:' + v.calculated.totalSpend.toFixed(2) + '  Repay:' + v.calculated.totalRepay.toFixed(2));
  console.log('  Cardholder:' + result.billInfo.cardholder);
  console.log('  Warnings:' + JSON.stringify(v.warnings));
  console.log('  OK:' + v.ok);
}
