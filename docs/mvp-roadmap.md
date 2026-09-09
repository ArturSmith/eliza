# MVP implementation order

1. Receipt search and refunds: implemented with paginated lookup, approvals, partial returns, immutable history, cash reconciliation, and optional restocking. External card refunds are recorded manually.
2. Stock counts: implemented. Draft, counting, review, finalization, cancellation, stale-stock rejection, and immutable movement/audit history.
3. Basic gross profit: implemented using revenue excluding tax, historical sale costs, and refund/restock adjustments. Expenses are deferred at the user’s request.
4. Store and receipt settings: implemented. Editable business details and receipt text, immutable receipt snapshots, and default tax for new products. Currency/timezone remain fixed.
5. Local operational readiness: backup and restore verification, restore into a new database, owner recovery, migration-aware health checks, ledger diagnostics, and a recovery runbook are implemented. Production deployment hardening and off-device backup scheduling remain deployment responsibilities.

Keep advanced barcode/label workflows, offline POS, split payments, custom role editing, multi-store operations, and supplier accounting outside this MVP unless store needs change.
