# Loyalty and management finances

The platform implements **discounts when points are redeemed**. One point gives a discount of one unit of shop currency. This audit does not change the existing tax-inclusive management-report policy or rewrite completed receipts.

| Event                     | Points                                                                                                     | Cash/card                              | Management revenue and profit                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| Collect                   | Earn the configured percentage of the final paid basket                                                    | Full sale amount is recorded           | Issued points are not a second expense; original goods cost is recorded                 |
| Spend                     | Spend at most the positive wallet balance, basket total, and configured purchase percentage; no new points | Only the remainder is recorded         | Sale revenue is already reduced by the points discount; original goods cost remains     |
| Return a Collect purchase | Reverse the original line's earned allocation                                                              | Refund the actual amount paid          | Reverse revenue and original goods cost; non-resellable stock becomes a loss            |
| Return a Spend purchase   | Restore the original line's spent allocation                                                               | Refund only its cash/card remainder    | Points are not refunded in cash; reverse the discounted revenue and original goods cost |
| Retry                     | No additional point entry                                                                                  | No additional payment or cash movement | Original receipt/refund is returned for the same request                                |

## Example (tax rate zero)

A customer buys goods for 100 with cost 60 and collects 10 points. The shop receives 100, reports gross profit 40, and has 10 points available for future discounts. Issuing those points does not book an additional expense under this model.

The next purchase is 50 with cost 30, paid with 10 points and 40 cash/card. Revenue is 40 and gross profit is 10. Do not deduct the 10 points again as an expense. Across both purchases, the shop has received 140 and reports gross profit 50, with no points left.

If the second purchase is returned, refund 40 cash/card and restore 10 points. Resellable stock restores the original 30 cost. The second purchase and return net to zero gross profit. If the purchase was entirely paid in points, cash refund is zero and all spent points are restored; goods still had a recorded cost during the sale.

## Audit findings and correction

- Before this change, Collect rounded each line separately. Two lines priced 0.02 at a 25% earning rate could earn 0.02 rather than the basket's 0.01. Earnings are now rounded once for the complete paid basket, then allocated cumulatively to lines. Existing stored allocations remain the basis for returns of older receipts.
- Discounts already flow into `sales.total`, `sale_items.total`, payments, cash movements and the common financial service. They must not be deducted a second time. Taxes continue to use the existing tax-inclusive discount calculation; this audit does not make a new tax-law determination.
- Historical batch costs remain on sold units even for fully point-paid purchases. Later price/cost/program edits do not recalculate past sales.
- Returns preserve cents through cumulative original-line allocation, reverse earned points and restore spent points. Negative wallets caused by later returns remain negative until earned back. Spending is blocked at nonpositive balance.
- The Accounting screen previously omitted point movements and outstanding discounts. It now shows issuance, spending, reversed issuance, restored spending, and a revenue reconciliation for the chosen dates.

## Reconciliation and dates

`GET /api/reports/financial-summary` includes the loyalty data only on an unfiltered store summary. Product/shift-filtered summaries omit it rather than misattribute store-wide customer balances. The query shares the same repeatable-read snapshot as the profit figures.

- Net points used = redeemed − restored on returns.
- Revenue before point discounts = reported revenue + net points used.
- Reported revenue = revenue before point discounts − net points used.
- Opening net balance + net points issued − net points used = closing net balance.
- Available points at either boundary are the sum of each customer's **positive** balance. Negative balances are shown separately and never cancel another customer's available points.

Period events use inclusive shop-local calendar dates, including daylight-saving changes. Opening balances include the full preceding history; closing balances stop at the end of the selected date range. A 100-entry customer activity feed does not cap finance totals. Refunds affect their completion date, even when the original sale was in an earlier period.

## Reporting basis and limits

These are **management figures on the platform's existing tax-inclusive basis**, with point use treated as a discount. The outstanding total is the face value of possible future discounts, not cash held for customers, a prediction of redemption, withdrawable profit, or a measured accounting liability. No expense is booked at issuance and there is no expiry/breakage model.

Formal financial statements can require a different model. IFRS 15 B39–B43 discusses material rights, including loyalty rewards, and allocating transaction consideration to those rights. That requires accounting-policy inputs such as expected redemption and standalone selling-price estimates; simply deducting the face value of issued points is not that calculation. See the [standard published by XRB](https://standards.xrb.govt.nz/standards-navigator/nz-ifrs-15/) and the [IFRS Foundation's IFRS 15 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/). This implementation does not claim statutory IFRS or jurisdiction-specific tax compliance.

## Verification

Regression coverage checks basket-splitting invariance, exact per-line allocations, real Collect/Spend and full/partial returns, zero-cash purchases, repeat payment requests, revenue/COGS reconciliation, foreign-store isolation, positive and negative wallets, histories longer than 100 events, and local daylight-saving boundaries. Browser coverage checks the populated Accounting reconciliation in English/Russian and desktop/mobile layouts.

## Redemption percentage

The manager may cap the purchase share payable in points, from 0% to 100%. A 20% limit on a final basket of 1000 allows at most 200 points; at least 800 is paid in cash/card. Fractions of a cent are rounded down so spending never exceeds the configured share. This limit changes the size of the discount, not the financial treatment above. The POS and server use the same formula. Checkout rejects an obsolete preview instead of silently changing the number of points used. Older receipts/refunds continue using their original saved allocations.
