# Batch purchase costs

Each received expiry batch stores the receipt's purchase unit cost, excluding purchase tax. The product's catalog cost remains the latest reference cost; changing it or the common selling price does not change older batches.

Checkout consumes unexpired batches in earliest-expiry order, then oldest receipt order. The sale stores immutable batch allocations and their extended costs in cents. Gross profit, Overview, Analytics, and AI gross-profit reporting use that exact total rather than the rounded average unit cost. Partial refunds restore the original allocations and costs. Non-restocked returns do not restore inventory or cost of goods sold. Fractional refund cost is allocated cumulatively to conserve the original sale's cents.

Inventory valuation uses the quantities and purchase costs of remaining batches. Inventory shows separate batches with purchase cost when the employee has costs.read; cashier responses and AI inventory tools without costs.read do not disclose it. Positive adjustments and count variances create new cost batches using the catalog cost at that moment.

Migration 0038 recovers historical receipt-linked batch costs from immutable receipt lines. Old stock without a receipt uses the current catalog cost as an explicitly marked historical estimate. Old sale/refund financial snapshots are preserved, with their existing report fallback; their margins are not retroactively recalculated. Exact original costs for untraceable historical stock cannot be recovered.

Regression coverage: tests/batch-costs.integration.test.ts includes different receipt costs, catalog edits, mixed-batch sales, partial/non-restocked refunds, earliest-expiry allocation, inventory value, and weighted refund cent conservation.
