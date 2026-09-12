# Eliza — prioritized feature backlog

Status snapshot: 12 September 2026. Compared with the original Supermarket Store Management System build guide and the implemented application. This is a planning document, not authorization to implement every item. Recheck current behavior before starting an item.

Scope: a single-shop MVP. Ranking reflects daily operational value and the impact of a missing workflow, not implementation difficulty.

## Priority definitions

- **P1:** Complete before relying on Eliza for routine shop operations.
- **P2:** Important improvements after the first working pilot.
- **P3:** Useful additions that can wait.
- **P4:** Keep outside the current MVP.

## Ordered backlog

| Rank | Priority | Feature | Reason / scope |
| ---: | :---: | --- | --- |
| 1 | P1 | Close remaining quantities on partially received purchases | Prevent orders staying open when goods will never arrive. Require a reason and preserve received quantities, stock, and history. This gap was identified during use rather than explicitly required by the original guide. |
| 2 | P1 | Inventory overview and filters | Find low stock, out-of-stock products, supplier/category groups, inactive products, and current stock values. |
| 3 | P1 | Searchable, paginated inventory movement history | Trace stock discrepancies beyond the latest 100 movements, with date and product filters. |
| 4 | P1 | Barcode scanning and product search during receiving | Check actual deliveries faster and with fewer selection errors. Barcode selection in purchase creation already exists. |
| 5 | P1 | Unknown-barcode resolution inside POS | Let an authorized manager attach a barcode or create a product without abandoning the cashier's checkout. Creation-time Open Food Facts lookup already exists. |
| 6 | P1 | Operational Overview dashboard | Show today's trading, active shifts/registers, stock problems, and pending deliveries together. Sales reporting already exists in Analytics. |
| 7 | P2 | Supplier returns | Link returned goods and compensating stock movements to the supplier and purchase. |
| 8 | P2 | Dedicated product details page | Combine stock, movements, purchases, sales, and audit history. Add preferred supplier and last-updated date. Images and descriptions already exist. |
| 9 | P2 | POS favorites and configurable quick buttons | Speed up common purchases and products without barcodes. Existing category filtering and product buttons remain the foundation. |
| 10 | P2 | Per-line and fixed-amount discounts | Handle a discount on one item or a fixed monetary amount. Entire-sale percentage discounts already exist. |
| 11 | P2 | Controlled checkout price overrides | Handle shelf-price discrepancies with a reason, separate permission, and approval where needed. |
| 12 | P2 | Internal barcode generation and label printing | Support shop-made or locally packaged products. Move to P1 if these products are common in the shop. |
| 13 | P2 | Supplier details and history | Review purchases, deliveries, and supplied products together. Supplier accounting remains a separate item. |
| 14 | P2 | Purchasing and product cost-history reports | Track supplier spending and changes in purchase costs over time. |
| 15 | P2 | Stock adjustment, damage, and expiry reports | Make recorded stock losses visible by period and product. |
| 16 | P2 | Refund and discount reporting by cashier | Review exception activity and identify training needs. |
| 17 | P2 | Receipt-search cashier filter and better keyboard search | Improve transaction lookup and exact-match navigation. Global search can follow later. |
| 18 | P2 | Additional manager-approval workflows | Cover exceptional stock corrections and cashier cash movements without replacing the active cashier. |
| 19 | P2 | Resumable store onboarding | Guide store details, tax, payment methods, employees, registers, products, and opening stock. |
| 20 | P3 | Category management | Add POS visibility, ordering, and activation controls. Parent/child categories are lower priority than these basics. |
| 21 | P3 | Configurable store operating rules | Discount limits, drawer rules, shift rules, units, and barcode settings. Add configuration when a concrete shop need emerges. |
| 22 | P3 | Completed-sale void workflow | Distinguish immediate voids from refunds, retaining audit and inventory history. Referenced refunds already provide a correction path. |
| 23 | P3 | Shift review state and configurable discrepancy thresholds | Add manager review where required. Controlled reopening is lower priority and must preserve original closing history. |
| 24 | P3 | Employee activity/details page | Consolidate shifts, transactions, permissions, discounts, and refunds. |
| 25 | P3 | Device activity and configuration | Show last activity, current operator/shift, and relevant device settings. |
| 26 | P3 | Per-barcode metadata and activation controls | Add barcode type, primary/secondary designation, and activation state. Multiple barcode values already work. |
| 27 | P3 | Configurable additional payment methods | Only needed when the shop accepts methods beyond recorded cash and card. |
| 28 | P3 | Split payments | Allow multiple payments for one sale. Previously deferred from the MVP. |
| 29 | P3 | Purchase invoices, payment status, and balances | Add supplier accounting, invoice matching, and payment history. Outside the agreed MVP. |
| 30 | P4 | Custom roles and employee permission overrides | Start with existing Owner, Manager, and Cashier roles. |
| 31 | P4 | Expenses and expense reports | Explicitly deferred by the user. |
| 32 | P4 | Operating result after expenses | Depends on expense tracking. Historical gross profit already exists. |
| 33 | P4 | Changing the refund payment method | Current refunds follow the original payment method. |
| 34 | P4 | Register takeover while another cashier's shift stays open | Current close-before-switch rules provide clearer drawer accountability. |
| 35 | P4, conditional | Offline checkout and synchronization | Substantial scope. Becomes P1 if selling through network outages is a firm requirement. |
| 36 | P4, conditional | Direct scale, printer, and cash-drawer integration | Prioritize specific hardware when required. Browser printing and keyboard-style scanners already work. |
| 37 | P4 | Weight/price-encoded barcode parsing | Needed for barcode-scale labels. Manual weight entry already works. |
| 38 | P4 | Multiple stores and stock transfers | Wait for a concrete second-shop plan. |
| 39 | P4 | Dedicated mobile inventory app | Improve the responsive web workflows first. |
| 40 | P4 | Loyalty, advanced promotions, e-commerce, and accounting integrations | Beyond the initial scope in the original guide. |

## Recommended next work

Implement ranks 1–6, then run a shop pilot before expanding the scope. Reprioritize using observed checkout delays, stock discrepancies, and staff feedback.

Deployment verification, protected backups and a restore drill, actual scanner/receipt-printer checks, and applicable receipt requirements are separate release requirements. See [deployment](deployment.md) and [operations](operations.md). This backlog does not certify readiness for live trading.

See [feature ideas](feature-ideas.md) for exploratory proposals and [the MVP roadmap](mvp-roadmap.md) for the previously agreed implementation sequence.

## Additional priorities — 13 September 2026

Relative implementation order within this new group; existing ranks above are retained.

| Order | Priority | Feature | Scope / dependencies |
| ---: | :---: | --- | --- |
| 1 | P1 | Editable shopping list from low stock | Suggest quantities using target stock, current stock, and incoming orders. Allow edits, group by supplier, and convert selected groups into purchase drafts. |
| 2 | P2 | Compare suppliers for the same product | Compare unit costs, dates, pack sizes, delivery costs, minimum orders, terms, lead times, and reliability. Requires product–supplier relationships. |
| 3 | P2 | Scheduled sales, revenue, and spending reports | Configure periods, delivery times, and recipients. Report sales/refunds/profit and purchase totals first; actual spending depends on payment and expense tracking. |
| 4 | P3 | Supplier portal and order proposals | Suppliers submit proposals; managers accept, request changes, or decline. Accepted proposals become purchase orders, never automatic stock receipts. |

See [feature ideas](feature-ideas.md#prioritized-proposals--13-september-2026) for detailed scope. These are planned features, not implemented workflows. The shopping list extends the reorder worksheet idea. Expense tracking remains deferred.
