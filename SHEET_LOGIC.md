# Daily Report — how the Google Sheet computes every number

Source: "Daily SaleS report on Mail" → tab **Daily Report** (snapshot read 2026-11-16, data through 15-Nov-2026).

## Data flow

```
Zenoti export ──► 'Sale Dump'            (current month, Nov 1–15)
              └─► 'Pick Month Sale Dump' (comparison months: Aug 1–15 + Sep 1–15)
                        │
                        ▼
                  'Pivot' tab (pivot tables, SUM of "Collected")
                        │
                        ▼
                  'Dashboad' tab (per sales-owner rows → per-center "Total" rows, cols D..I)
                        │  ARRAYFORMULA(Dashboad!D<total>:I<total>)
                        ▼
                  'clinic' tab (one row per center, cols B..G)
                        │  VLOOKUP by center name
                        ▼
                  'Daily Report'
```

## Raw row fields (both dumps)
Item Type | Payment Date (text DD-MM-YYYY) | Invoice No | Guest Code | Guest Name | Center Code | Center Name | Item Code | Item Name | Qty | Sales Collected (Exc.Tax) | Tax Collected | Sales Collected (Inc.Tax) | Redeemed | Collected to Date | **Collected** | Sold By Code | **Sold By** | First Visit | …

Every amount on the report = **SUM(Collected)**.

## Column-by-column (Daily Report)

| Column | Meaning | Logic |
|---|---|---|
| Target (F) | Monthly center target | **Hard-coded** in Daily Report (differs from targets in Dashboad tab!) |
| Current Achieved (J) | MTD sales | Sale Dump, Item Type ∈ {Package, Pre-paid card, Service, Gift card}; grouped by **Sold By**; each Sold By mapped to a center via the hand-kept roster in `Dashboad!B:C`. Sold By not in roster → "No Sales Owner", attributed by the invoice's Center Name. |
| Achieved % (N) | J / F | |
| Achieved (Aug-26) (R) | Comparison period | Pick Month Sale Dump, pivot filtered to dates 01–15 Aug (hard-coded list), Item Type ∈ {Package, Pre-paid card, Service} for owners (no Gift card), + Gift card for No-Sales-Owner rows. Same roster mapping. |
| Difference (V) | J − R | |
| Yesterday (Z) | Sales on TODAY()−1 | Sale Dump pivot filtered to Payment Date **15-11-2026 (hard-coded)**, Item Type ∈ {Package, Service, Pre-paid card, Gift card}, roster mapping + NSO by center. |
| Product Sales (AC) | MTD product sales | Sale Dump, Item Type = Product, by Center Name (Zenoti name → display name map in `'Product Incentive'!A89:B104`). Surat & Chhatarpur hard-coded 0. |
| 80% target (AE) | F × 0.8 | |
| Deficit for 80% (AF) | AE − J | |
| TOTAL row | SUM of rows 8–25 | |

## Center name map (Zenoti → report)
Vasant Vihar, New Delhi → Vasant Vihar · Greater Kailash, New Delhi → Greater Kailash · Khan Market, New Delhi → Khan Market · Punjabi Bagh, New Delhi → Punjabi Bagh · Mohali, Punjab → Mohali · Karkardooma,New Delhi → Karkardooma · Gurgaon -(M3M) → Gurgaon - (M3M) · Chhatarpur,New Delhi → Chhatarpur · others identical.

## Bugs found in the sheet (affect the numbers shown)

1. **Karkardooma "Aug" = 125,300 is wrong** — `Dashboad!E110 = SUM(E106:E109)` includes Ludhiana's total row (93,000). True value ≈ 32,300. Also inflates TOTAL and every "Difference" figure.
2. **Bagu Bai Kokare (Sadashiva)** — row 38 has no Aug formula (blank) and its Sep formula points at Priyanka A (Bangalore, `$C14`).
3. **#REF! formulas** — `Dashboad!D39:D41` (Sadashiva staff) and several monthly cols reference deleted cells → return 0.
4. **Bangalore row 19** sums Pivot by `$C39` (Zakia, Sadashiva) → Sadashiva sales counted in Bangalore (Sep column).
5. **M3M No-Sales-Owner yesterday** (`I96`) uses "Mohali, Punjab" criteria.
6. **South Ex / Ludhiana / Karkardooma NSO yesterday** (`I88, I105, I109`) look up a Sold By literally named "No Sales Owner" → always 0.
7. **Chhatarpur** has no comparison-month formula → blank; excluded from Dashboad Grand Total.
8. **Dashboad Grand Total** (D115:G115) omits Karkardooma (row 110) and Chhatarpur (row 114).
9. **Gift card** included in current-month but excluded from comparison-month owner rows → unfair comparison.
10. **Two different target sets**: Daily Report F vs Dashboad F (e.g. Vasant Vihar 17.5M vs 35M; M3M 2.1M vs 1M; Galleria 1.9M vs 0).
11. **Hard-coded dates**: yesterday pivot (15-11-2026) and comparison pivot (1–15 Aug/Sep) must be edited by hand daily/monthly. Headers say "Sep 26 Month Difference" but compare against Aug.
12. Daily Report `AI4` is a hard-coded 214,121 with no source.
13. Sales owner roster lives as typed names in `Dashboad!C` — a name spelling change in Zenoti silently moves sales to "No Sales Owner".
14. `'No Sales Owner'!C:D` copies only `Pivot!S4:T16` → only the first 12 centers (A→Z) with no-owner sales are counted in "Current Achieved".
15. Product VLOOKUP reads `'Product Incentive'!A70:D85` → only the first 15 centers (A→Z) with product sales are counted.

16. **Blank Sold By** rows are dropped everywhere except Product: `MATCH("", Dashboad!C:C, 0)` matches an empty cell, so they are neither owner nor No-Sales-Owner. Zero-value rows don't create a pivot row, so they don't use up one of the 12 / 15 slots.

## Data rule found during reconciliation (2026-11-16)
The sheet's Zenoti export contains **no internal adjustments**. Rows whose `payment_type` contains
`Custom - Refund - Internal` (a package refunded into a pre-paid card: a minus line on the original seller plus a plus pre-paid line with no seller) or `Custom - Package Transfer` are skipped entirely, even when the row also has another payment method. This is applied in both modes (`isInternalAdjustment` in `src/lib/report.ts`).

Result with sales_dash.collections synced 16 Nov 17:02 IST: Current, Comparison (Aug 1–15), Yesterday and Product all match **18/18 centers**. `npx tsx scripts/reconcile.ts` re-runs the check.
Known person-level differences that cancel out within a center (Zenoti edited after the sheet export): Sakshi Chhabra +₹20,000 / Sangeeta −₹20,000 (GK), and Nuzhat Parween −₹2,300 (M3M).

## Decisions (2026-11-16)
- Bugs that change numbers (1–9, 14, 15) are **reproduced** by default; each is a flag in `src/lib/compat.ts` (`SHEET_COMPAT=off` turns on the corrected logic).
- Bugs that don't change numbers are fixed (dynamic dates, labels, lookup ranges, roster as data, AI4 dropped).
- Targets = Daily Report "Target" column.
- Default comparison = 1st→today vs 1st→same day of last month; both ranges editable.
