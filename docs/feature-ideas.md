# Eliza — feature ideas

Created: 12 September 2026.

## Current implementation work — 14 October 2026

The historical idea statuses below are not a current release checklist. See
[implementation progress](implementation-progress.md) for the approved implementation order.
The first increment now shares cost provenance and refund rounding between financial
summary and dashboard dimensions, checks financial document totals against line facts,
and adds searched, product/date-filtered, paginated stock movement history.
Sales-based replenishment now has a read-only planning report and shared AI tool (15 October). Proactive notifications and traffic analysis remain planned.

These are proposals to explore, not committed requirements or implemented features. The [prioritized backlog](prioritized-backlog.md) takes precedence. Some ideas extend backlog items; validate demand before expanding the MVP.

## Small improvements to explore during a shop pilot

| Idea                                    | Shop benefit                                                             | Initial scope                                                                                 | Dependency / consideration                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Duplicate a purchase order              | Reorder common deliveries without entering every line again.             | Copy supplier and products into a new draft; use current costs and prices and require review. | Never copy received quantities, payment state, or transaction IDs.                       |
| Reorder worksheet                       | Turn low-stock findings into an editable purchasing plan.                | Select low-stock products and prepare supplier-specific drafts.                               | Preferred suppliers and inventory filters; no automatic order submission.                |
| Print changed shelf prices              | Help staff keep shelf labels consistent after receiving a delivery.      | List confirmed price changes with old/new prices and an acknowledgement checkbox.             | Build on purchase price changes and label printing.                                      |
| Delivery discrepancy notes              | Explain shortages, damage, or unexpected goods when checking a shipment. | Record notes and reasons against a delivery or outstanding line.                              | Keep delivered, accepted, damaged, and outstanding quantities distinct.                  |
| Missing product data checklist          | Find products with no barcode, photo, cost, or tax review.               | Filter the catalog by missing fields and open each product for editing.                       | A zero cost or tax rate is not automatically an error.                                   |
| CSV product import with preview         | Speed up onboarding an existing shop.                                    | Map columns, validate units/prices/barcodes, preview changes, then import.                    | Reject ambiguous duplicates; report per-row errors; do not silently alter stock.         |
| CSV report export                       | Share figures with an accountant without manual transcription.           | Export the currently applied Analytics filters with currency and timezone.                    | Preserve imported-data attribution where relevant and protect spreadsheet formula cells. |
| Saved report filters                    | Repeat common sales comparisons quickly.                                 | Save a named filter selection such as "Last month — drinks".                                  | Clearly distinguish rolling date periods from fixed dates.                               |
| Printable end-of-day summary            | Give owners a consistent closing document.                               | Sales, refunds, payment totals, drawer differences, and unresolved shifts.                    | Reuse authoritative reporting calculations.                                              |
| Connection status and recovery guidance | Help cashiers understand an uncertain checkout result.                   | Show connection status and direct them to existing payment/refund recovery.                   | Must not imply that offline sales are supported.                                         |

## Ideas that need more workflow design

| Idea                                   | Shop benefit                                                        | Questions to resolve first                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Expiry dates and batches               | Identify goods approaching expiry and trace affected stock.         | Are batch-level receiving, sales allocation, and stock counts required? Manual expiry notes alone are not batch tracking. |
| Near-expiry markdowns                  | Reduce waste through controlled price reductions.                   | How are affected units identified? Prefer starting with approved line discounts before a promotion engine.                |
| Pack-to-piece receiving                | Receive cases while selling individual items.                       | Define conversion factors, rounding, unit history, and whether barcodes distinguish packs from pieces.                    |
| Stock reservation for held carts       | Reduce contention for scarce products.                              | When should reservations expire, and should simply holding a cart reduce availability to other tills?                     |
| Reason-based loss analysis             | Distinguish expiry, damage, theft, and count differences.           | Agree on staff-friendly reason codes and who can review sensitive categories. Extends stock-loss reports.                 |
| Inventory count by aisle or shelf      | Make physical counts manageable for larger shops.                   | Add locations, support products in multiple locations, and retain the existing movement-conflict rules.                   |
| Supplier reliability report            | Identify late or incomplete deliveries.                             | Need reliable expected dates, actual receipt times, and explicitly closed shortages.                                      |
| Price-change review queue              | Let a manager review suggested selling prices before applying them. | Define permissions, stale-price checks, and when checkout starts using approved prices.                                   |
| Attach invoice or delivery-note photos | Keep supplier paperwork connected to the transaction.               | Documents need access control, size limits, retention, and durable storage beyond tiny product thumbnails.                |
| Manager task inbox                     | Surface unresolved operational work in one place.                   | Start with pending deliveries, stock-count reviews, and drawer discrepancies; avoid duplicate notifications.              |

## Later opportunities

- Backup connectivity for cloud-hosted shops: assess a secondary internet connection before committing to full offline synchronization.
- Multi-store comparison: useful only after store access, catalogs, and transfers have defined rules.
- Accounting export: start with a reviewed file format before adding a live integration.
- Loyalty and promotions: only after the shop can identify a concrete benefit and operational owner.
- Email or messaging alerts: opt-in delivery summaries or low-stock alerts, with delivery failures and notification preferences handled explicitly.

## How to promote an idea into the backlog

For each selected idea, record the user problem, real example, expected benefit, minimum workflow, permissions, effects on stock/money/history, dependencies, and acceptance checks. Assign a priority in the main backlog only after review. Keep unselected ideas here rather than treating them as promised work.

## Prioritized proposals — 13 September 2026

These four proposals now have assigned priorities in the [backlog](prioritized-backlog.md#additional-priorities--13-september-2026). They are not yet implemented.

### 1. Editable shopping list from low stock — P1 — implemented

Implemented on 13 September 2026. See [shopping-list usage and limits](shopping-lists.md). Extends the earlier reorder worksheet proposal.

- Generate a draft from low-stock and out-of-stock products.
- Suggest quantities using a configurable target stock level, subtracting current stock and quantities already on order; never suggest a negative quantity.
- Let users edit quantities, add/remove products, and write notes.
- Show current stock, incoming quantities, preferred supplier, and estimated cost.
- Group items by supplier and convert selected groups into purchase-order drafts.
- Retain links to resulting orders and distinguish converted items from outstanding list items to prevent accidental duplicate ordering.
- Keep the list a planning tool: stock changes only when deliveries are recorded.

Later enhancements: sales-speed estimates, supplier lead times, and pack-size rounding. Target stock and minimum-stock thresholds serve different purposes and should be configured explicitly.

### 2. Supplier comparison for the same product — P2

Build product–supplier relationships and compare recorded facts:

- Last purchase cost and its date.
- Comparable unit price, including pack-size conversions.
- Delivery charges, minimum order, and payment terms where recorded.
- Expected lead time and historical delivery reliability.

Show separate indicators such as **lowest recorded cost**, **fastest delivery**, and **preferred supplier**. Do not declare one supplier universally best. Mark historical prices as estimates and unavailable information as unknown. Distinguish tax-inclusive and tax-exclusive comparisons consistently.

Current quotations and availability can follow through the supplier portal. Do not infer current availability from a previous delivery.

### 3. Scheduled revenue, sales, and spending reports — P2

- Let the owner choose the reporting period, delivery time, channel, and recipients.
- Include sales, refunds, sales less refunds, gross profit, purchase totals, and previous-period comparisons.
- Use the store timezone and clearly show the covered dates.
- Reuse authoritative Analytics calculations and enforce report/cost permissions.
- Handle failed delivery and retries without sending duplicate reports.

Purchases received are not the same as money paid to suppliers. Initially label purchase totals explicitly. Actual cash spending needs supplier-payment tracking; operating expenses need the separately deferred expense feature. Scheduling this report does not bring expenses back into MVP scope automatically.

Dependencies: a scheduler, chosen delivery channel, recipient settings, and any required provider connection.

### 4. Supplier portal and proposal negotiation — P3

Proposed workflow:

**Supplier submits proposal → manager accepts, requests changes, or declines → accepted proposal becomes a purchase order → shop records the delivery.**

- Give each supplier access only to its own relationship with the shop.
- Keep version history, comments, decisions, and notifications.
- Let the manager review products, quantities, costs, expected delivery dates, and references.
- Map supplier products to shop products explicitly; do not silently create duplicates.
- Require a fresh review after a proposal changes.
- Prevent repeated acceptance from creating duplicate orders.
- Acceptance never increases stock; the normal receiving workflow does that.

Dependencies: external supplier accounts, access controls, product–supplier mapping, and verified supplier participation. This is a collaboration workflow, not automatic supplier ordering.

Recommended sequence: **shopping list → supplier comparison → scheduled reports → supplier portal**.

## AI feature ideas — 13 September 2026

Exploratory proposals, not implementation commitments. This order ranks AI ideas relative to one another; it does not replace the main MVP backlog. Focus on reducing manual entry and explaining useful information inside existing workflows.

| Order | Feature                                         | Example experience                                                                                   | AI contribution                                                                                       |
| ----: | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
|     1 | Purchase drafts from invoices or delivery notes | Upload a photo/PDF, review supplier and product lines, then save a draft.                            | Extract quantities, costs, and tax; suggest matches to existing products.                             |
|     2 | Natural-language Analytics                      | Ask “How much Coca-Cola did Anna sell last week?”                                                    | Translate questions into supported report filters and explain verified results.                       |
|     3 | Shopping-list explanations                      | Ask “Why should I order 24 bottles?”                                                                 | Explain stock, incoming orders, targets, and demand assumptions; help refine drafts conversationally. |
|     4 | Product creation from packaging photos          | Photograph a package and review suggested name, description, brand, size, and category.              | Extract details when barcode lookup has no match or incomplete information.                           |
|     5 | End-of-period business summaries                | Read a short explanation of sales and margin changes, linked to supporting reports.                  | Summarize calculated results and identify contributors without inventing causes.                      |
|     6 | Supplier-option explanations                    | Understand why a higher unit price might still produce a cheaper small order after delivery charges. | Explain comparable costs, terms, lead times, and missing or stale information.                        |
|     7 | Unusual-activity review                         | Review unusually high refunds and the affected receipts.                                             | Highlight evidence for investigation; do not accuse employees or automatically restrict them.         |
|     8 | Contextual workflow help                        | Ask what to enter when only half a delivery arrives.                                                 | Explain the current screen and actual workflow using maintained Eliza documentation.                  |

### AI traffic analysis and product placement optimization — planned

The store is equipped with motion sensors, and its floor space is virtually divided into individual zones or cells. The system continuously records visitor movement and collects data on how many people visited each zone during a selected period.

Using this data, **Eliza** creates a store traffic heatmap and identifies high-traffic and low-traffic zones. Changes in visitor traffic can also be analyzed over time—by hour, day, week, or other periods.

Traffic data is combined with sales information and product locations. This allows AI to identify opportunities to optimize product placement and provide specific recommendations.

For example, Eliza may recommend:

- Moving **well-selling products into low-traffic zones** to draw shoppers into less-visited parts of the store.
- Placing **products with low sales in high-traffic zones** to increase their visibility and test the effect of traffic on sales.
- Identifying zones where heavy customer traffic does not translate into sales.
- Comparing performance before and after changes in product placement to assess the actual effect of rearranging products.

In this way, Eliza turns data about shoppers' physical movement into a tool for optimizing retail space. The system shows **where shoppers are** and helps determine **how to change product placement to improve store performance**.

### Shared design rules

- Eliza calculates; AI explains. Use validated application logic for sales, taxes, stock, margins, and reorder quantities.
- Keep suggestions reviewable. AI may prepare drafts or propose matches; users confirm changes to stock, prices, purchases, or money through normal authorized workflows.
- Show evidence: dates, filters, source records, assumptions, and missing information. Distinguish observations from possible explanations.
- Enforce existing permissions on the server. AI must not expose costs, profit, or other stores' records to unauthorized users.
- Keep manual workflows available when AI is unavailable.
- Treat uploaded documents and external product text as untrusted data, not instructions or authority to execute actions.
- Decide which shop data may leave the application before choosing a provider. Hosted AI requires provider configuration, credentials, and usage budgeting. Avoid sending unnecessary personal information or secrets.

### First candidate: document-to-purchase drafts

1. Manager uploads a supplier invoice or delivery note.
2. AI extracts lines and proposes product matches.
3. Eliza highlights uncertain matches and validates quantities, costs, tax, and totals.
4. Manager corrects the suggestions and saves a purchase draft.
5. The existing receiving workflow records the goods that actually arrive.

Uploading a document must not automatically receive stock or mark the supplier as paid. Preserve the document reference and accepted values for review; detect likely duplicate documents before suggesting another purchase.

### Recommended sequence

Start with **document-to-purchase drafts** and **natural-language Analytics**. Build reliable shopping-list calculations using stock, incoming orders, targets, and sales history before adding AI explanations. Scheduled summaries depend on the reporting schedule and delivery-channel work proposed above.

### Implementation update — 19 September 2026

The first document-to-purchase increment is implemented: image upload, server-side extraction, catalogue matching, editable human review, and explicit draft saving. English and Russian are supported. PDF import, conversational editing, tax extraction, pack conversion, invoice-total reconciliation and duplicate-document detection remain follow-ups. See [implementation and setup](purchase-document-assistant.md).
