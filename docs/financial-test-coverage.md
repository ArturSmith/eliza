# Financial test audit — 26 September 2026

This audit checks financial behavior, not a measured line/branch coverage percentage. Passing tests do not prove every possible input or production failure is covered.

## Coverage reviewed and extended

| Area               | Cases exercised                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money calculations | Half-cent rounding, fractional quantities, inclusive/exclusive tax, zero and full discounts, supported limits, invalid precision/formats, 600 deterministic combinations checking cent conservation                                                                             |
| Checkout           | Cash change, exact card amount, under/overpayment rejection, stale price/tax, permissions, idempotent retries, stock concurrency, zero-value sale, total overflow and rollback                                                                                                  |
| Refunds            | Concurrent retries and competing partial refunds, cash drawer insufficiency rollback, full refund conservation of tax/total, restocked vs non-restocked costs, cumulative cost rounding, original receipt preservation                                                          |
| Purchase payments  | Receiving independent of payment status, concurrent duplicate requests, conflicting request reuse, optimistic version conflicts, paid timestamp stability                                                                                                                       |
| Expenses           | Positive amounts and precision, pagination with totals across all pages, conflicting edits, store isolation and permissions                                                                                                                                                     |
| Reporting          | Net revenue excluding tax/refunds, spending as expenses plus paid purchases, profit excluding operating expenses, unknown historical costs, shop-local day boundaries including DST, agreement between detailed profit and dashboard totals/product/category/monthly breakdowns |
| Pricing UI         | Default markup and editable VAT-inclusive suggestions, mixed weighted/regular price tags, purchase payment status and expense forms                                                                                                                                             |

## Defects found and corrected

- Dashboard spending/profit arithmetic could expose floating-point artifacts. Cent-scaled arithmetic now preserves exact amounts.
- Dashboard partial-restock costs were rounded independently per refund. Cumulative allocation now agrees with the detailed profit report and conserves original cost.
- Dashboard profit could be reported when historical cost records were absent. The affected profit KPIs are now withheld.
- Product/category profit included tax, and monthly margin omitted refunds. These breakdowns now use receipt tax/category snapshots and refund entries with cumulative restored costs.
- Catalog unit-margin calculations now exclude the charged tax before comparing with purchase cost.
- Stale test expectations were found around automatically linked supplier offers and changed purchase-payment controls; missing Russian labels were also caught by existing translation tests.

## Verification

- Unit suite: 18 files, 191 tests passed.
- Integration suite: 18 files, 166 tests passed against disposable PostgreSQL databases.
- Final reporting rerun after the catalog-margin change: 22 tests passed.
- Build and TypeScript checks passed.
- Seven browser scenarios passed across five specs: expenses, purchase payments, default markup, weighted price tags, and the three store scenarios covering checkout/payment and refund recovery, drawer reconciliation, purchase editing/receiving, stock counts and analytics. Specs were run individually against disposable test databases.

Commands: `pnpm test`, `pnpm exec vitest run --config vitest.integration.config.ts`, `pnpm build`, `pnpm typecheck`, and individual Playwright specs under `tests/e2e`.

## Limits and follow-up risks

- No line/branch coverage collector is configured; these counts describe executed tests, not a coverage percentage.
- Card payment tests validate the application's accounting records; they do not simulate a real acquiring terminal or bank settlement.
- Concurrency tests exercise selected simultaneous requests, not sustained production-scale load or database/network crashes at every commit boundary.
- Missing-cost regressions cover absent historical records. Additional reconciliation checks for partially corrupted multi-product sale histories would strengthen legacy-data validation.
- Large-history report performance should be profiled with production-sized fixtures, especially cumulative refund calculations.
