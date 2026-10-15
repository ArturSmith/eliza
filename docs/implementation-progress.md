# Implementation progress

Updated: 14 October 2026. Approved order: financial/reporting foundations, demand
and replenishment calculations, AI-assisted actions, notifications, then traffic analysis.

| Order | Scope | Status |
| --- | --- | --- |
| 1 | Financial consistency and movement history | First increment implemented; see below |
| 2 | Reliable slow/no-sales and replenishment calculations | Pending |
| 3 | AI explanations and reviewed purchasing actions using those calculations | Pending |
| 4 | Notifications and scheduled summaries | Pending |
| 5 | Sensor traffic analysis linked to product placement | Pending |

## Completed first increment

- Shared historical-cost/provenance and cumulative refund-allocation rules across
  the canonical financial summary and category/product/monthly dashboard calculations.
- Withhold exact profit for legacy-estimated costs in dashboard dimensions.
- Detect sale/refund header totals inconsistent with available line facts in the summary;
  do not return a provisional profit when those facts are incomplete.
- Inventory UI searches the full stock history by product name/SKU, note or reason;
  supports exact product, inclusive store-local date filters and 50-record pages.
- New `GET /api/inventory/movements/history` returns `{rows,total,page,pageSize}`.
  It is store-scoped, requires `inventory.read`, validates inputs, escapes literal
  wildcard characters and has deterministic timestamp/UUID ordering.
- The original `/inventory/movements` array endpoint remains compatible.

Tests cover financial uncertainty, malformed historical refunds, refund regressions,
105 movements, store isolation, local-day boundaries, search, pagination and UI filtering.

## Boundaries

No historical records are modified. No tax/VAT treatment or inventory-loss categories
are changed. Summaries still use recorded expenses only. The wider feature roadmap is
not complete, and this change has not deployed the application to Railway.
