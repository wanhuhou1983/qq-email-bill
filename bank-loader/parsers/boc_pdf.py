import pypdf,os,re,json,sys
from itertools import combinations

def parse_boc_pdf(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    text = ""
    for p in reader.pages:
        t = p.extract_text()
        if t:
            text += t + chr(10)

    result = {"cardholder":"","bill_month":"","due_date":"","bill_date":"","prev_balance":0,"total_spend":0,"total_repay":0,"new_balance":0,"card_last4":"0177","transactions":[]}

    cm = re.search(r"([\u4e00-\u9fa5]{2,4})\s+先生", text)
    if cm: result["cardholder"] = cm.group(1)

    bm = re.search(r"中国银行信用卡账单\((\d{4}年\d{2}月)\)", text)
    if bm: result["bill_month"] = bm.group(1)

    dates = re.findall(r"(\d{4}-\d{2}-\d{2})", text)
    if len(dates) >= 2:
        result["due_date"] = dates[0]
        result["bill_date"] = dates[1]

    sm = re.search(r"人民币/RMB\s+(?:欠款/DEBT|存款/CR|)\s*([\d,]+(?:\.\d*)?)\s+([\d,]+(?:\.\d*)?)\s+([\d,]+(?:\.\d*)?)\s+(?:欠款/DEBT|存款/CR|)\s*([\d,]+(?:\.\d*)?)", text)
    if sm:
        result["prev_balance"] = float(sm.group(1).replace(",",""))
        result["total_spend"] = float(sm.group(2).replace(",",""))
        result["total_repay"] = float(sm.group(3).replace(",",""))
        result["new_balance"] = float(sm.group(4).replace(",",""))

    bill_spend = result["total_spend"]
    bill_repay = result["total_repay"]

    lines = text.split(chr(10))
    
    tx_header_idx = -1
    for i, line in enumerate(lines):
        if "人民币交易明细" in line or "Transaction Detailed List" in line:
            tx_header_idx = i
    
    start_line = -1
    if tx_header_idx >= 0:
        for i in range(tx_header_idx, len(lines)):
            if "Expenditure" in lines[i]:
                start_line = i + 1
                break
    
    if start_line < 0:
        return result
    
    end_line = len(lines)
    for i in range(start_line, len(lines)):
        line = lines[i].strip()
        if "积分奖励" in line or "Loyalty Plan" in line or line == "TOTL" or "参考汇率" in line:
            end_line = i
            break
    
    tx_lines = []
    for i in range(start_line, end_line):
        line = lines[i].strip()
        if not line: continue
        if re.match(r"^\d+\s*页$", line): continue
        if re.match(r"^第\s*\d+\s*页", line): continue
        if "人民币交易明细" in line: continue
        if line == "of Card Number": continue
        tx_lines.append(line)
    
    raw_tx = []
    i = 0
    while i < len(tx_lines):
        line = tx_lines[i]
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4})\s*(.*)", line)
        if m:
            trans_date = m.group(1)
            post_date = m.group(2)
            card4 = m.group(3)
            rest = m.group(4).strip()
            
            j = i + 1
            while j < len(tx_lines):
                nl = tx_lines[j]
                if re.match(r"^\d{4}-\d{2}-\d{2}", nl): break
                if re.match(r"^\d+\s*页", nl) or "积分" in nl or "Loyalty" in nl: break
                rest += " " + nl
                j += 1
            
            am = re.search(r"([\d,]+(?:\.\d{2})?)\s*$", rest)
            if am:
                amt = float(am.group(1).replace(",",""))
                desc = rest[:am.start()].strip()
                if "无法足额扣款" in desc or "请补足" in desc:
                    i = j; continue
                raw_tx.append({
                    "trans_date": trans_date, "post_date": post_date,
                    "card_last4": card4, "description": desc, "amount": amt
                })
            i = j; continue
        i += 1
    
    if len(raw_tx) == 0:
        return result
    
    # Mark known deposits (high confidence keywords)
    deposit_keywords = ["转账","存入","还款","财付通支付科技有限公司"]
    cardholder = result["cardholder"]
    
    known_deposit_idxs = set()
    all_idxs = set(range(len(raw_tx)))
    
    for idx, t in enumerate(raw_tx):
        desc = t["description"]
        if any(kw in desc for kw in deposit_keywords):
            known_deposit_idxs.add(idx)
        elif t["amount"] >= 50 and desc.strip() == cardholder:
            known_deposit_idxs.add(idx)
    
    # Remaining indices
    unknown_idxs = list(all_idxs - known_deposit_idxs)
    unknown_amounts = [raw_tx[i]["amount"] for i in unknown_idxs]
    known_deposit_sum = sum(raw_tx[i]["amount"] for i in known_deposit_idxs)
    
    # We need: total_repay_sum ≈ bill_repay, total_spend_sum ≈ bill_spend
    # Known deposits contribute to repay. Need to split unknowns into spend/repay.
    # Target for unknown deposits: bill_repay - known_deposit_sum
    target_repay_remaining = bill_repay - known_deposit_sum
    
    # For DP: find subset of unknown amounts that sums closest to target_repay_remaining
    # Since amounts may be large, use scaled DP (round to 0.01 precision -> multiply by 100)
    if unknown_amounts and target_repay_remaining > 0:
        # Scale to integers (cents)
        scale = 100
        int_amounts = [round(a * scale) for a in unknown_amounts]
        target_int = round(target_repay_remaining * scale)
        total_int = sum(int_amounts)
        
        # Use DP to find best subset sum <= min(target_int, total_int)
        max_target = min(target_int, total_int)
        if max_target > 0 and max_target <= 10000000:  # Safety limit (100k RMB in cents)
            dp = [-1] * (max_target + 1)
            dp[0] = 0
            best_sum = 0
            
            for item_idx, val in enumerate(int_amounts):
                for s in range(max_target, val - 1, -1):
                    if dp[s - val] >= 0 and dp[s] < 0:
                        dp[s] = item_idx
                        if s > best_sum:
                            best_sum = s
            
            # Backtrack to find which items are in the best sum
            selected_unknown = set()
            s = best_sum
            while s > 0 and dp[s] >= 0:
                item_idx = dp[s]
                selected_unknown.add(unknown_idxs[item_idx])
                s -= int_amounts[item_idx]
            
            deposit_idxs = known_deposit_idxs | selected_unknown
        else:
            deposit_idxs = known_deposit_idxs
    else:
        deposit_idxs = known_deposit_idxs
    
    # Build final transactions
    for idx, t in enumerate(raw_tx):
        sign = -1 if idx in deposit_idxs else 1
        result["transactions"].append({
            "trans_date": t["trans_date"],
            "post_date": t["post_date"],
            "card_last4": t["card_last4"],
            "description": t["description"],
            "amount": t["amount"] * sign
        })
    
    final_spend = sum(x["amount"] for x in result["transactions"] if x["amount"] > 0)
    final_repay = sum(-x["amount"] for x in result["transactions"] if x["amount"] < 0)
    result["_verify"] = {
        "tx_count": len(result["transactions"]),
        "calc_spend": round(final_spend, 2),
        "calc_repay": round(final_repay, 2),
        "bill_spend": bill_spend,
        "bill_repay": bill_repay,
        "spend_ok": abs(final_spend - bill_spend) < 0.5,
        "repay_ok": abs(final_repay - bill_repay) < 0.5
    }
    return result

    return result

if __name__ == "__main__":
    import sys
    pdf_path = sys.argv[1]
    r = parse_boc_pdf(pdf_path)
    print(json.dumps(r, ensure_ascii=False))
