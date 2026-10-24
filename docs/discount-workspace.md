# Promotions and unit markdown workspace

Management → Promotions now contains two tabs:

- **Product and category promotions**: existing percentage/final-price rules, targeting, schedules, active/past list and cancellation.
- **Unit markdowns**: choose an active base product sold in pieces/packs/boxes, then set a final price, quantity, reason and optional deadline. The product field opens a searchable dropdown on focus/click. Search accepts name, SKU, PLU and barcodes. A fresh page starts with no product selected. Focus, filtering and arrow-key highlighting never select a product; choose an option or explicitly confirm an exact barcode with Enter. The current page retains an explicit selection when switching discount tabs. Products with no selling price remain visible but cannot create markdowns until priced.

Product editing no longer contains the unit-markdown form. Unit markdown creation, active labels, replacement, cancellation and history use the existing `PriceActions` component and authenticated `/products/:id/pricing` endpoints. The product-specific component is keyed by product ID to avoid carrying form or label state to another product. Product selection is disabled while creating/replacing/cancelling labels. Drafts and results remain mounted across the two discount tabs.

Existing permissions are preserved. The Promotions page can be opened with `promotions.manage`, or with the catalogue read/write plus `markdowns.manage` permissions already needed for the complete unit workflow. Each tab remains separately gated. Employees without promotion permission do not fetch the promotion list. Backend permission checks are unchanged.

This is a UI move, not a pricing migration. No new pricing tables or financial formulas are introduced. Existing atomic batch allocation, stock reservation, one-use barcode creation, original-price snapshots, cost recording and refunds remain in the pricing engine. Labels continue to be available in the employee Price Tags environment. The existing browser print action remains available in management.

Validation: the new browser workflow creates a product promotion and three unit labels, verifies stock is unchanged, enforces remaining availability, replaces/cancels labels and sells a remaining label. It checks receipt base price 70, discount 15, paid price 55 and original cost 59 (gross profit −4). Existing price-actions integration tests cover idempotency, batch allocation, checkout, refunds and non-stacking promotions. Permission-helper and translation tests cover access and copy.
