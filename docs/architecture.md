# Architecture and implementation boundaries

## Decision

Use a pnpm monorepo and a modular NestJS monolith backed by PostgreSQL. React/Vite renders the interactive management application. The user explicitly selected a new stack, overriding the attached guide's instruction to preserve a pre-existing app.

The implemented modules are authentication/access, catalog, inventory, management/audit, employees, registers, shifts, and checkout. Separate API and browser deployments can be added without moving domain rules into page handlers. Large service extraction is unnecessary now.

## Database ownership

Organizations own stores. Operational records are scoped to stores. Employee roles and device access are checked against the session's store on each request. Compound foreign keys prevent inventory records from referencing employees, devices, or products from another store. Catalog identities are currently per store; a later shared organizational catalog can map these existing store product IDs without changing historical movement references.

Drizzle models provide typed access for the foundation. Register/checkout commands use parameterized SQL on dedicated node-postgres transaction clients to make lock ordering and ledger writes explicit. SQL migrations are the authoritative schema; reviewed SQL also includes constraints, indexes, and append-only triggers. Migration checksums catch edits to already-applied migrations. Run migrations explicitly before API startup; the server does not silently change the schema.

## Stock integrity

Product balances are a cached current quantity; stock movements explain every application-driven balance change. A transaction locks the product, validates the adjustment, updates the balance, inserts the movement, and inserts the audit event. Any failure rolls back all of these writes.

Client-generated request IDs are unique per store. A transaction-scoped advisory lock serializes concurrent retries; the recorded payload hash must match. Replays return the original result. Product locks prevent lost updates across different requests. Negative balances are rejected. Opening balance is allowed only before the first movement.

Money is represented as decimal strings and stored as PostgreSQL NUMERIC. Quantities have three decimal places; piece, pack, and box quantities must be integral. Shared scaled-BigInt helpers keep arithmetic exact. Inventory value is a current purchase-cost estimate, not historical COGS or profit. Completed sales store their sale-time price, tax, and cost snapshots.

Database triggers prevent normal UPDATE/DELETE on movements and audits. A database administrator can override database controls; this is application traceability, not a claim of externally tamper-proof storage. Production must use a restricted database role and independently backed-up history.

## Authentication and devices

Management passwords use salted scrypt. The app stores hashes of random session and browser tokens, not the tokens themselves. Sessions expire after 12 hours; cookies are HttpOnly and SameSite=Strict, with Secure enabled in production. Every access checks current employee/device status and the current role's explicit permissions. Cost data is withheld from catalog responses for users without `costs.read`.

Mutation requests must have the configured Origin and a custom application header. No cross-origin API access is enabled. Login/setup attempts are rate-limited per process/IP for local development. Multi-instance deployment needs shared throttling and correct trusted-proxy configuration. Password recovery and credential rotation need implementation before public use.

A full management login registers a management browser. Knowing a device UUID is insufficient to authenticate it. A blocked browser's existing sessions and login are rejected, but a management user with full credentials can enroll a new browser by clearing browser storage. POS enrollment is an explicit operation requiring `devices.manage` in a full management session. Manager action approvals preserve the active cashier session.

## Register access and transaction ordering

The `eliza_register` cookie is a random enrollment secret hashed in the devices table. Its device must be active and of type `pos`. It is distinct from the management browser cookie. A separate `eliza_pos_session` cookie identifies the active cashier; management guards ignore it entirely. Entering an enrolled register clears its management session, and PIN login rotates the register's active session so previous cashier tokens stop working.

POS writes lock the device first, then verify the current session, employee status, and role. Shift writes lock the relevant shift. Sales lock products in UUID order before changing quantities, preventing conflicting registers from overselling the last unit. Request advisory locks and payload hashes make repeated commands idempotent. PIN checks lock a device attempt row; failed attempts commit before returning an authentication error, so rollback does not erase throttling.

One open shift is allowed per device and per employee. A different cashier cannot take over an open shift. Locking preserves that shift and the tab's draft, while a manager approval only records a separate approver. Closing a shift calculates expected cash from the cash ledger; discrepancies require approval unless the operator holds `shift.approve`. Database triggers prevent later modification of a closed shift.

## Sale arithmetic and history

Selling prices include the product's configured tax rate. Existing products receive a 0% rate through migration rather than an inferred jurisdiction-specific tax rule. Gross line amounts are rounded half-up to cents from price × quantity; the sale-wide percentage is applied and rounded per line, then included tax is extracted and rounded per line. Totals sum these rounded line amounts. Shared BigInt calculations drive both the preview and authoritative server computation.

The server checks expected prices/tax against locked product records and rejects stale cart lines. Finalization inserts the receipt snapshot, cost-bearing sale items (kept out of cashier responses), payment, inventory movements, any cash movement, and audit in one transaction. Completed receipts retain store/cashier names, original prices, quantities, tax, discounts, and payment data. External card charges are not performed; recording a card payment requires an explicit operator confirmation in the UI.

Retry hashes exclude approval credentials. An already-completed request returns its existing receipt before requiring another approval, including after the shift closes; new requests still require valid approval. PINs never go into receipts, audit details, or browser draft storage. Different payloads under the same ID are rejected.

## Browser recovery and remaining work

Drafts and held carts currently use sessionStorage scoped by store, register, employee, and shift. A pending payment payload is synchronously stored before submission, without PINs. Unknown network/server outcomes freeze cart editing and expose a recovery action. Reloading retries that same payload and ID. This supports same-tab recovery, not full offline checkout or durable backup. The browser test aborts a response after the API successfully commits, reloads, and verifies exactly one sale is recovered.

Checkout is online-only. The next persistence step is IndexedDB/Dexie with explicit offline synchronization rules for stale stock, prices, permissions, receipt numbering, and payment restrictions. No service worker caches authenticated responses. File uploads and background jobs remain deferred until actual workflows need them.

Remaining retail workflows include purchasing/partial receiving, counts, expenses, referenced refunds, voids, split payments, and expanded reporting. Tax settings, receipt/fiscal requirements, account recovery, backup/restore, and hardware integration require further implementation before deployment as a live till.
