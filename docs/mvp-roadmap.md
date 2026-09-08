# MVP implementation order

1. Receipt search and refunds: implemented with paginated lookup, approvals, partial returns, immutable history, cash reconciliation, and optional restocking. External card refunds are recorded manually.
2. Stock counts: implemented. Draft, counting, review, finalization, cancellation, stale-stock rejection, and immutable movement/audit history.
3. Expenses and gross profit: next. Dated expense records; revenue excluding tax minus historical cost of goods sold; separate operating expenses.
4. Store and receipt settings: business details, receipt text, default tax configuration.
5. Operational readiness: backup/restore verification, recovery procedures, permissions review, and final end-to-end verification.

Keep advanced barcode/label workflows, offline POS, split payments, custom role editing, multi-store operations, and supplier accounting outside this MVP unless store needs change.
