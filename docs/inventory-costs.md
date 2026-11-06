# Product cards and acquisition costs

Product cards describe the SKU and its optional selling price. The current product forms neither request nor submit acquisition cost. Editing catalog metadata preserves the legacy reference cost rather than clearing it.

Each purchase receipt records its own unit cost and creates immutable cost layers in `stock_batches`. Manual deliveries record supplier, quantity and explicit `unitCost` through `/inventory/adjustments`. Their supplier link is created without inventing a supplier quotation or changing an existing quote.

Opening balances record their own unit cost. Explicit `unitCost: null` means unknown; `unitCost: "0"` means a known, genuinely free acquisition. Unknown cost is stored as SQL NULL with `cost_source='unknown'`. It is never replaced with a later catalog or receipt price. Inventory-count surpluses with no acquisition evidence also create unknown-cost layers.

The product page shows read-only average cost of remaining stock, stock value and the last purchase, plus a batch breakdown. If any remaining layer has unknown cost, its full valuation and average are unavailable, and the unknown quantity is displayed. Supplier quotations remain separate from actual costs.

POS continues to allocate quantities by expiry date, then receipt order (FEFO). The ordinary barcode identifies a product, not its physical batch. Markdown labels select their assigned batch. Allocations and sale costs are snapshots: later receipts and product edits never rewrite them. If a sold line consumes unknown-cost stock, its cost snapshot is NULL and financial reports mark cost/profit incomplete while preserving revenue. Known allocations on a mixed line are still retained separately.

Refunds restore the original allocations and their original cost provenance. Unknown costs stay unknown; loss reports likewise do not treat unknown write-offs as zero-valued losses. Zero-cost acquisitions remain valid, complete cost records.

## Compatibility

`products.cost` and the optional cost input in the legacy API remain for existing clients and historical data. Only old stock-adjustment clients that omit `unitCost` retain the previous reference-cost fallback. Current forms always send an explicit cost or NULL. An explicit NULL never falls back to `products.cost`. This is not the valuation basis of the current product page or new POS sale snapshots.

Migration `0058_inflow_cost_provenance.sql` is additive apart from relaxing cost nullability and updating the insertion trigger. It does not backfill or update immutable sales, allocations or historical batch costs.

## Verification

The integration scenario receives 100 units at 1.00, 100 at 1.50 and 50 at 1.30. It verifies 250 units, 315.00 stock value and 1.26 average cost. Selling 120 units with equal expiry dates records 130.00 cost. Receiving another batch at 10.00 leaves that sale's cost and profit unchanged. Additional cases cover unknown opening balances, refunds, write-offs, genuine zero-cost stock and manual supplier receipts.

## Quantity-only supplier orders and acceptance

The ordinary Create order UI records products, stock-unit quantities, supplier, dates and notes. It neither asks for costs or selling prices nor seeds them from supplier reference prices. A user can save a draft or place an order atomically; placement sends nothing externally. Existing WhatsApp sharing remains an explicit user action after placement.

Migration `0059_unpriced_purchase_orders.sql` allows SQL NULL costs and totals on orders only. A missing order cost is never zero and never creates stock. Existing priced API clients and imported document drafts remain supported. Historical quotations are retained for compatibility; the new order UI does not use them.

Accept delivery records each received quantity, invoice cost excluding tax, purchase tax, expiry splits and an optional new selling price. Last-paid suggestions come from actual supplier delivery/batch history. They are explicit suggestions, not automatic confirmation of a new invoice cost. Margin previews use the checkout tax rounding through `productPriceMargin`; they do not change batch allocation or financial facts.

Delivery, inventory, price changes and optional whole-order payment status are recorded in one idempotent transaction. Cost changes require `purchases.cost`, selling-price changes require `catalog.write`, and payment changes require `purchases.write`. An unpriced order cannot be marked fully paid while its final received amount is unknown. On full receipt or closing a partial order, its total is finalized from actual goods receipts, excluding undelivered quantities. Existing priced order totals retain their prior semantics.

Purchases are grouped and paginated on the server: Drafts (`draft`), Active orders (`ordered`, `partially_received`), Delivered (`received`, `closed`), and Cancelled. Closed partial orders retain their explicit closed status and receipt history. Sale/refund cost snapshots are never rewritten by this workflow.
