/**
 * import-spdb.cjs — 导入浦发银行本地XLS文件
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const parser = require("./bank-loader/parsers/spdb");

const FOLDER = "C:/Users/linhu/Downloads/浦发银行";
const PG = new Client("postgresql://postgres:DB_PASSWORD@localhost:5432/postgres");

async function main() {
  await PG.connect();

  const files = fs.readdirSync(FOLDER).filter(f => f.endsWith(".xls")).sort();
  console.log("找到", files.length, "个文件\n");

  let totalInserted = 0, fileCount = 0;

  for (const f of files) {
    const fp = path.join(FOLDER, f);
    const transactions = parser.parseFromFile(fp);
    if (!transactions || transactions.length === 0) {
      console.log(`  ${f}: 无交易`);
      continue;
    }

    // 从文件名提取账期
    const fm = f.match(/(\d{4})(\d{2})/);
    const billCycle = fm ? `${fm[1]}-${fm[2]}` : null;
    const billDate = transactions[transactions.length - 1]?.post_date || null;

    console.log(`${f.substring(0,30)}: ${transactions.length}条`);

    // 入库
    const billR = await PG.query(
      `INSERT INTO credit_card_bills (bank_code,bank_name,cardholder,bill_date,bill_cycle,cycle_start,cycle_end,account_masked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (bank_code,bill_date,account_masked) DO UPDATE SET updated_at=NOW() RETURNING id`,
      ["SPDB","浦发银行","吴华辉", billDate, billCycle,
       transactions[0].trans_date, transactions[transactions.length-1].trans_date,
       "****"+(transactions[0]?.card_last4||"")]
    );
    const billId = billR.rows[0].id;

    let inserted = 0;
    for (const t of transactions) {
      try {
        const r = await PG.query(
          `INSERT INTO credit_card_transactions (bill_id,bank_code,cardholder,card_last4,account_masked,trans_date,post_date,description,amount,currency,trans_type,source,raw_line_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'file_spdb',$12)
           ON CONFLICT (bank_code,trans_date,post_date,card_last4,description,amount) DO NOTHING`,
          [billId,"SPDB","吴华辉",t.card_last4,"****"+t.card_last4,
           t.trans_date,t.post_date,t.description,t.amount,"CNY",
           t.amount > 0 ? "SPEND" : "REPAY",
           `${t.trans_date}|${t.amount}|${t.description}`]
        );
        if (r.rowCount > 0) inserted++;
      } catch(e) {}
    }
    console.log(`  → ${inserted}条新增\n`);
    totalInserted += inserted;
    fileCount++;
  }

  console.log(`✅ 完成! ${fileCount}个文件, ${totalInserted}条新增`);
  await PG.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
