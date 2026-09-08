# Architecture and implementation boundaries

## Decision

Use a pnpm monorepo and a modular NestJS monolith backed by PostgreSQL. React/Vite renders the interactive management application. The user explicitly selected a new stack, overriding the attached guide's instruction to preserve a pre-existing app.

This first milestone deliberately delivers a tested foundation rather than an incomplete checkout. Core modules are authentication/access, catalog, inventory, and management/audit. Separate API and browser deployments can be added without moving domain rules into page handlers. Large service extraction is unnecessary now.

## Database ownership

Organizations own stores. Operational records are scoped to stores. Employee roles and device access are checked against the session's store on each request. Compound foreign keys prevent inventory records from referencing employees, devices, or products from another store. Catalog identities are currently per store; a later shared organizational catalog can map these existing store product IDs without changing historical movement references.

Drizzle models provide typed access. SQL migrations are the authoritative schema; reviewed SQL also includes constraints, indexes, and append-only triggers. Migration checksums catch edits to already-applied migrations. Run migrations explicitly before API startup; the server does not silently change the schema.

## Stock integrity

Product balances are a cached current quantity; stock movements explain every application-driven balance change. A transaction locks the product, validates the adjustment, updates the balance, inserts the movement, and inserts the audit event. Any failure rolls back all of these writes.

Client-generated request IDs are unique per store. A transaction-scoped advisory lock serializes concurrent retries; the recorded payload hash must match. Replays return the original result. Product locks prevent lost updates across different requests. Negative balances are rejected in this first milestone. Opening balance is allowed only before the first movement.

Money is represented as decimal strings and stored as PostgreSQL NUMERIC. Quantities have three decimal places; piece, pack, and box quantities must be integral. Shared scaled-BigInt helpers keep arithmetic exact. Inventory value is a current purchase-cost estimate, not historical COGS or profit. Sale-time price/tax/cost snapshots will arrive with the sales module.

Database triggers prevent normal UPDATE/DELETE on movements and audits. A database administrator can override database controls; this is application traceability, not a claim of externally tamper-proof storage. Production must use a restricted database role and independently backed-up history.

## Authentication and devices

Management passwords use salted scrypt. The app stores hashes of random session and browser tokens, not the tokens themselves. Sessions expire after 12 hours; cookies are HttpOnly and SameSite=Strict, with Secure enabled in production. Every access checks current employee/device status and the current role's explicit permissions. Cost data is withheld from catalog responses for users without `costs.read`.

Mutation requests must have the configured Origin and a custom application header. No cross-origin API access is enabled. Login/setup attempts are rate-limited per process/IP for local development. Multi-instance deployment needs shared throttling and correct trusted-proxy configuration. Password recovery and credential rotation need implementation before public use.

A full management login registers a management browser. Knowing a device UUID is insufficient to authenticate it. A blocked browser's existing sessions and login are rejected, but a management user with full credentials can enroll a new browser by clearing browser storage. Strong POS enrollment must be a separate owner-approved workflow before cashier PIN authentication exists. Manager action approval must not change the active cashier session.

## Extending the foundation

Basic shifts, employee/PIN management, and approval enforcement must precede unrestricted checkout. The supplied guide places some controls later; the implementation sequence moves the essential ones ahead of sale completion.

A sale transaction will store items, payment records, stock/cash movements, audit references, and receipt identity together. External card charges require durable payment states and reconciliation: they cannot join a PostgreSQL transaction. Receipt/tax requirements and hardware models must be confirmed before a live checkout rollout.

Introduce jobs only for actual asynchronous work (exports, integrations). PostgreSQL-backed pg-boss avoids another service initially. File storage can start with a protected local adapter and later use S3; no upload endpoint exists yet. No job/storage dependencies are installed speculatively.

A PWA service worker alone cannot make POS safe offline. Start with local cart persistence and cached catalog lookup; later define request replay, conflicts, stale prices/permissions, receipt allocation, and payment restrictions before enabling offline sale completion. No service worker currently intercepts or caches authenticated responses.
