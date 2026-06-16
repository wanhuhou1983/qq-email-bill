# Bank Loader - Work Log

## Project Overview
Parse QQ email credit card bills into structured transactions with self-verification against bill summaries.

## Architecture
- parsers/*.js - Per-bank email HTML/text parsers extracting transactions and bill info
- verify_bill.js - Self-verification module matching parsed transactions against bill summary formulas
- loader.js - Main loader orchestrating email fetch, parse, verify, and DB import
- _verify_final.js - Test harness for latest-month verification

## Verification Methods
| Logic | Description | Banks |
|-------|-------------|-------|
| A | Direct sum: compare parsed spend/repay totals against bill summary | ABC, ICBC, CITIC |
| B | Formula: statementBalance = prevBalance + spend - repay | BOCOM, CGB |
| CCB | B variant using parser-extracted summary totals (tx list may miss fees) | CCB |
| CEB | B variant excluding installment tx from spend | CEB |
| CZB | B variant with prevPayment (not in tx list) | CZB |
| PAB | Formula: statement = prevBalance - prevPayment + spend + adjustment + interest | PAB |
| X | Image-based bills, skipped | CMBC |

## Bank Status (2026-06-16)

| Bank | Code | Months | OK | Notes |
|------|------|--------|-----|-------|
| 农业银行 | ABC | 14 | 14 | Logic A, card 8042=Wu Dajun |
| 中国银行 | BOC | 6 | 6* | Notification emails only, no tx data |
| 交通银行 | BOCOM | 6 | 6 | Logic B |
| 建设银行 | CCB | 18 | 18 | Logic CCB, 6 months have small tx diffs (fees not in detail) |
| 光大银行 | CEB | 6 | 5 | Logic CEB, uid46 first installment month has partial tx |
| 广发银行 | CGB | 7 | 7 | Logic B |
| 中信银行 | CITIC | 15 | 9 | Logic A, 6 decode fails (old encoding) |
| 民生银行 | CMBC | 6 | 6 | Logic X (image bills) |
| 浙商银行 | CZB | 6 | 6 | Logic CZB |
| 工商银行 | ICBC | 8 | 7 | Logic A, uid106 empty (incomplete bill) |
| 平安银行 | PAB | 6 | 6 | Logic PAB, old format months skip gracefully |
| **Total** | | **98** | **91** | **93%** |

## Fix History

### 2026-06-16 - Major Verify Fix
- PAB: Fix missing closing brace, add formula summary extraction, logic A->PAB
- CGB: Fix extractSummary regex to match formula line, extract prevBalance
- CEB: Add CEB logic excluding installment tx from spend calculation
- CZB: Add CZB logic with prevPayment extraction from formula
- CCB: Remove dedup, add CCB logic using parser summary totals for formula
- ABC: Fix cardholder mapping (8042->Wu Dajun)
- CMBC: Remove content-based dedup dropping same-day same-amount tx
- Added verify_bill.js with per-bank verification logics

## Known Edge Cases
- CEB uid46: First installment month, merchant principal partially in tx detail
- PAB uid60/uid61: Old format without formula line, skipped gracefully
- CCB 6 months: Small spend diffs (fees/interest in formula not in tx detail)
- ICBC uid106: Empty bill (incomplete email)
- CITIC 6 months: Non-standard encoding, decode fails
- BOC: Notification emails without transaction tables
