# Manager Action Centre

The main view answers six manager questions: what/how much/when to order, what may
expire before sale, what to avoid ordering, actual delivery cost changes and supplier
comparisons, changes in unit sales, and products contributing verified gross profit.
English and Russian question headings are localized. Analytics keeps its existing layout.

`GET /api/reports/action-center/questions?period=today|week|month` is a read-only
projection. Each section independently checks its required data permissions on the
server. Stock planning reuses Replenishment's full evaluated set (up to 5,000 products),
with only four examples displayed per section. It preserves insufficient-history,
uncertain-arrival, stock-reconciliation and truncation warnings. Expiry cards show
recorded expired/next-seven-day batches and disclose unknown expiry dates; they do
not claim to predict unsold quantities. Purchase costs compare actual received unit
costs for the same product and supplier. Other suppliers' last paid prices include
recording dates and are never represented as current offers.

The sales period selector applies to demand and assortment only. Week/month mean
7/28 completed store-local days against the immediately preceding equally long
window. Today compares the same elapsed store-local clock time one week earlier.
Demand reports gross unit sales and completed receipt counts; it does not attribute
causes or treat returns as erased demand. Assortment starts with the top ten recorded
product-profit candidates, verifies each using FinancialMetricsService and shows up
to four results. Unsold products and unverified cost records are excluded; missing
cost is explained rather than treated as zero. This shortlist is not an exhaustive
ranking of all product or category economics.

Existing alert status controls, snoozes and no-sales threshold analysis remain in an
expandable block. The no-sales deep link still opens that block. Reference-cost
margin and supplier-quote detectors are replaced in this view by received-cost and
verified-profit evidence; their stored history is not deleted.

The Action Centre reuses verified owner-dashboard facts. `buildInsights` in `packages/contracts/src/analytics.ts` is the deterministic detection layer; `OwnerDashboardController` supplies store-scoped sales, stock, purchasing, and shift facts. It does not use an LLM for metrics or priority.

`manager_insight_states` stores one row per store and stable detector ID. Re-evaluation updates the observation without overwriting a manager's review status. When a condition disappears it becomes resolved; if it later returns, it becomes a new active action. Expired snoozes reopen automatically. The same insight data is returned to Analytics and the full Action Centre so a future brief can reuse it.

Action groups are Action now, Today, Review, Opportunities, and Setup. The internal ranking combines severity, operational urgency, financial impact (discounted when estimated), affected entities, and age. The score is not shown to managers. Cost-related snapshots are filtered by `analytics.margin`; changing store thresholds requires `settings.manage`.

No-sales analysis uses the store's local business day and the saved threshold (60 days by default). Only active products with positive stock qualify. A never-sold product must be old enough to qualify. Inventory value comes from remaining stock batches at their recorded costs; missing and legacy-estimated costs are labelled. The analysis threshold can be changed temporarily without updating the store. An authorized user can explicitly save it as the default.

The Action Centre uses read-side analytics and does not run in checkout transactions. The `sale_items(store_id, product_id, sale_id)` index supports the last-sale lookup. The existing dashboard reporting queries remain the source of truth for the other detectors.
