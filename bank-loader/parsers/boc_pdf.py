
import sys, json
import pdfplumber

pdf_path = sys.argv[1]
result = {"transactions": []}

with pdfplumber.open(pdf_path) as doc:
    for page in doc.pages:
        tables = page.extract_tables()
        for table in tables:
            for row in table:
                if not row: continue
                cells = [c.strip() if c else "" for c in row]
                # 找含中文的交易行: 最少6列, 第一列含日期YYYY-MM-DD
                if len(cells) >= 6:
                    try:
                        td = cells[0].strip()
                        pd = cells[1].strip()
                        card = cells[2].strip()
                        desc = cells[3].strip()
                        deposit = cells[4].strip()
                        expenditure = cells[5].strip()
                        if td.count("-") == 2 and len(td) == 10:
                            # 确定金额
                            amt = 0
                            if expenditure:
                                amt = float(expenditure.replace(",",""))
                            elif deposit:
                                amt = -float(deposit.replace(",",""))
                            if amt != 0:
                                result["transactions"].append({
                                    "trans_date": td, "post_date": pd,
                                    "card_last4": card, "description": desc,
                                    "amount": amt
                                })
                    except: pass

print(json.dumps(result, ensure_ascii=False))
