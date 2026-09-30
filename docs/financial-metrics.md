# Store financial metrics

`FinancialMetricsService.getFinancialSummary(storeId, period, filters?)` is the source for management profitability. `GET /reports/financial-summary`, Gross Profit, Overview totals, and the pricing-source report use it. Dates are inclusive calendar dates in the store timezone. Sale and refund events belong to their completion dates; later catalog edits do not change them.

All amounts are calculated in cents. The seven metrics are:

| Metric | Definition |
| --- | --- |
| Revenue | Final completed POS sale totals minus completed refund totals |
| COGS | Historical cost of sold units minus historical cost of returned units |
| Gross profit | Revenue minus COGS |
| Gross margin | Gross profit / Revenue × 100; unavailable when Revenue is zero or negative |
| Inventory losses | Cost of explicit expired/damaged removals plus cost of returned units that cannot be resold |
| Operating expenses | Recorded expense amount on its economic date, or evenly allocated over its economic period |
| Store operating profit | Gross profit minus inventory losses minus operating expenses |

The POS final price already contains promotions and unit markdowns; discounts are not subtracted again. No tax or VAT is calculated or removed from these metrics. Purchases and supplier payments do not create COGS or operating expenses. Goods become COGS when sold.

Sale costs come from immutable `sale_items.cost_total` and the associated batch allocations, selected FEFO at checkout. Refunds reverse the cost of the returned units in the refund period. New refund lines preserve that cost in `restored_cost`, even when the item cannot be restocked. For a non-resellable return, the same cost is recorded in `loss_cost` and appears as an inventory loss. Old restock refunds without a cost snapshot can be reconstructed from the original sale cost and the cumulative returned quantity; old non-resellable refunds without `loss_cost` remain incomplete.

Explicit expired and damaged adjustments store the cost of the consumed FEFO batches in `movements.cost_total`. Generic corrections, stock counts, and internal use are not automatically classified as inventory losses. Historical movements with no defensible batch-cost snapshot remain unknown. A `legacy_estimate` batch cost is not treated as verified historical purchase cost.

An expense is `ONE_TIME` on `expense_date`, or `EVEN_OVER_PERIOD` between `period_start` and `period_end` inclusive. The latter divides cents evenly across calendar days, assigning remainder cents to the earliest days. `payment_date` is separate and does not change profitability. Existing expenses default to one-time on their recorded date; their historical payment date stays unknown. Expense edits and deletions continue to use the existing audit trail.

When required cost is missing, COGS, gross profit, gross margin, and store operating profit are `null`; when loss cost is missing, inventory losses and store operating profit are `null`. `dataQuality` reports missing sale, refund, and loss records and cost coverage. The expense scope is explicitly `recorded_expenses_only`: unrecorded bills cannot be detected from the database. Product- or shift-filtered summaries omit inventory losses and operating expenses because those store-wide amounts cannot be allocated to those dimensions reliably.

This is a management-profitability model, not cash flow or statutory net profit. It does not calculate income tax, accounts receivable/payable, depreciation, or owner-withdrawable cash.
