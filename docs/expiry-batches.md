# Receiving products with different expiry dates

In **Receive delivery**, each product starts with one quantity and optional expiry date. Choose **Add expiry batch** to split the delivered stock. For ten pieces, enter five with one expiry date and five with another. **Total received** is the sum of the batches, and cannot exceed the remaining purchase quantity. Remove unused rows before saving. Weighted products allow up to three decimal places; piece-based products require whole units in every batch. Dates may be omitted for stock with an unknown expiry.

The delivery creates one receipt line and financial total per product, plus one stock batch for each expiry row. Cost and purchase tax are calculated once on the full product quantity, so splitting expiry dates does not introduce extra rounding. Existing checkout behavior consumes eligible batches in expiry order and refuses insufficient unexpired stock. Delivery history retains the originally received quantities and dates even after those batches are depleted; Inventory shows what remains. Eliza AI can read both batch-level stock and the delivery's expiry splits.

The receipt API accepts `expiryBatches` on each line:

```json
{
  "purchaseLineId": "<purchase-line UUID>",
  "quantity": "10",
  "expiryBatches": [
    { "quantity": "5", "expiryDate": "2035-01-01" },
    { "quantity": "5", "expiryDate": "2036-01-01" }
  ]
}
```

Each batch must have a positive quantity, and their exact sum must match `quantity`. Up to 50 expiry rows are supported per product. Legacy callers may still send a single `expiryDate`; it becomes one batch. Supplying a non-empty single date together with `expiryBatches` is rejected as ambiguous. Receipt retries retain existing idempotency guarantees.

Migration 0037 allows multiple stock batches for one receipt line and adds immutable `expiry_batches` snapshots to delivery history, interpreting existing receipts as a single batch from their recorded quantity and date without editing historical records.
