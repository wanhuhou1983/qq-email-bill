# Bank Loader Changelog

## 2026-06-16 - Verify Fix Round

### PAB (平安银行)
- Fix missing }; closing brace causing syntax error
- Add _extractBillInfo summary extraction from formula line
- Formula: 本期应还/上期账单/上期还款/本期消费/调整/利息
- Fix description matching: drop Chinese-only requirement for English descriptions
- verify_bill: Change logic from A to B (parser now provides all summary fields)

### ABC (农业银行)
- Fix cardholder mapping: card 8042 belongs to 吴大军, not 吴华辉

### CGB (广发银行)
- verify_bill: Fix extractSummary regex to match formula line
- Formula: 本期=上期-还款+消费-调整+消费利息+现金利息
- Extract prevBalance for B-logic verification

### CEB (光大银行)
- Add CEB-specific verify logic: exclude installment from spend calculation
- Installment amounts are already included in prevBalance
- Formula: 本期欠款=上期欠款+消费(非分期)-还款

### CMBC (民生银行)
- Remove content-based dedup that incorrectly dropped same-day same-amount transactions

## Verification Status (2026-06-16)

| Bank | Status | Tx | Spend | Repay |
|------|--------|-----|-------|-------|
| 交通银行 (BOCOM) | OK | 18 | 6200.19 | 5585.36 |
| 民生银行 (CMBC) | OK | 22 | 2916.26 | 2708.53 |
| 光大银行 (CEB) | OK | 2 | 274.96 | 389.25 |
| 平安银行 (PAB) | OK | 5 | 530.46 | 36.32 |
| 浙商银行 (CZB) | OK | 28 | 12891.78 | 12659.20 |
| 广发银行 (CGB) | OK | 21 | 3030.78 | 2962.97 |