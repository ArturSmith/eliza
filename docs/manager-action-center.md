# Manager Action Centre

The Action Centre reuses verified owner-dashboard facts. `buildInsights` in `packages/contracts/src/analytics.ts` is the deterministic detection layer; `OwnerDashboardController` supplies store-scoped sales, stock, purchasing, and shift facts. It does not use an LLM for metrics or priority.

`manager_insight_states` stores one row per store and stable detector ID. Re-evaluation updates the observation without overwriting a manager's review status. When a condition disappears it becomes resolved; if it later returns, it becomes a new active action. Expired snoozes reopen automatically. The same insight data is returned to Analytics and the full Action Centre so a future brief can reuse it.

Action groups are Action now, Today, Review, Opportunities, and Setup. The internal ranking combines severity, operational urgency, financial impact (discounted when estimated), affected entities, and age. The score is not shown to managers. Cost-related snapshots are filtered by `analytics.margin`; changing store thresholds requires `settings.manage`.

No-sales analysis uses the store's local business day and the saved threshold (60 days by default). Only active products with positive stock qualify. A never-sold product must be old enough to qualify. Inventory value comes from remaining stock batches at their recorded costs; missing and legacy-estimated costs are labelled. The analysis threshold can be changed temporarily without updating the store. An authorized user can explicitly save it as the default.

The Action Centre uses read-side analytics and does not run in checkout transactions. The `sale_items(store_id, product_id, sale_id)` index supports the last-sale lookup. The existing dashboard reporting queries remain the source of truth for the other detectors.
