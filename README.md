# Eliza

## Cloud deployment

Product forms support an optional JPEG, PNG, or WebP photo (up to 10 MB input). The browser converts it to a compact JPEG thumbnail, up to 480 pixels and 60 KB of encoded data. Photos appear in the catalog and checkout, can be replaced or removed, and are stored in PostgreSQL so database backups include them. No object-storage account is required. For much larger catalogs, move thumbnails to separately fetched object storage to reduce catalog response sizes.

Railway deployment configuration is included. Follow [the deployment guide](docs/deployment.md) for production variables, first-owner setup, migrations, database permissions, backups and release verification.

Local supermarket management software. React + Vite + TypeScript, NestJS, PostgreSQL, Drizzle, TanStack Router/Query, Zod, Tailwind, and shadcn-style Radix UI components. No external accounts, API keys, analytics, or hosted authentication are required.

## Run locally

Requires Node.js 22.12+ and pnpm 11. PostgreSQL can run through the included native startup script or Docker Compose. Dependency and optional browser downloads require internet during installation; application operation does not.

```sh
pnpm install
pnpm db:start
pnpm build
pnpm db:migrate
pnpm dev
```

Open **http://localhost:5173**, then choose your store name, currency, time zone, and owner credentials. Setup is allowed exactly once per database. There is no default user or password. Use the `localhost` hostname because mutation origin validation is configured for it.

`pnpm db:start` detects Homebrew PostgreSQL 14–17 or common Linux installations. Set `POSTGRES_BIN` to an installed PostgreSQL bin directory on other systems. Data lives in the ignored `.local/postgres` directory; stop it using `pnpm db:stop`. The script starts a separate cluster on port **54329**, not your system database. This development database uses the local-only credentials in `.env.example`.

Alternatively, use `docker compose up -d` instead of `pnpm db:start`. Choose one database startup method; both use the same port. Docker data is kept in its named volume. The app connects to `postgresql://eliza:eliza_local@127.0.0.1:54329/eliza` by default.

Optional overrides go in a root `.env` file (see `.env.example`). The API loads it without overwriting existing environment variables. API: http://127.0.0.1:3001/api/health. Development endpoint documentation: http://127.0.0.1:3001/api/docs. Request contracts are defined in `packages/contracts/src/index.ts`.

[Eliza AI](docs/ai-agent.md) answers store questions and [reconstructs uploaded images and PDFs](docs/scanned-documents.md) as editable digital documents. It requires a server-side `OPENAI_API_KEY`; the rest of Eliza continues to work without one.

## Implemented workflows

- First-run store and owner setup; salted scrypt passwords and HttpOnly database sessions.
- Employee creation, store-unique employee codes, role assignment, activation/deactivation, and six-digit PIN setup/reset. Employees can use PIN-only access, without email or an external account. An owner cannot disable their own account or change their own role.
- Owner, Manager, and Cashier permission collections. Team administration is owner-controlled; cost visibility and reports are enforced on the server.
- Management browser registration and blocking, plus **explicit owner/authorized manager enrollment of POS registers**. Entering an enrolled register ends this browser's management session. PIN sessions never authenticate management API endpoints.
- Register PIN login, manual locking, a five-minute inactivity lock, and database-persisted PIN attempt limits (five failed attempts lock PIN entry on that device for five minutes).
- Product creation/editing, SKU/PLU, zero or multiple barcodes, tax rate, category labels, activation/deactivation, and catalog search.
- Opening stock and manual adjustments with exact decimal quantities, row locks, idempotency, and append-only movement/audit history.
- Checkout by barcode, PLU, SKU, product search, or product buttons. Weighted quantities use manual entry in the product's unit.
- Cart quantity editing, up to ten held carts, and reload recovery using **sessionStorage in the same browser tab**. These are not durable offline storage or a cross-device cart service; closing the tab or clearing its storage can lose drafts.
- Sale-wide percentage discounts; cashier discounts above 10% need a manager/owner PIN. The approver is recorded separately and the active cashier does not change.
- Cash payment with change; manually recorded card payment with an explicit external-terminal confirmation. The app **does not charge a card terminal**. Single payment method per sale currently; no split payments yet.
- Transactional sale finalization: immutable receipt/item/payment snapshots, stock reduction, cash movement, and audit entry. Stable request IDs recover an uncertain result without duplicating sales.
- Shift opening float, manager cash in/out during their own shift, expected drawer totals, closing count and difference, and permanent closed-shift totals. Cashier differences require a manager/owner PIN.
- Original cashier must close the shift before another employee takes over that register. One employee can have one open shift at a time. Employee deactivation requires closing their open shift first.
- Supplier contacts, editable purchase drafts, order placement/cancellation, partial receiving, immutable delivery history, and linked stock/cost audit records.
- Printable receipts, audited reprints, sales history, and shift cash history, plus the dashboard and inventory views.

### Use checkout

1. Sign in to management and open **Team**. Edit your own account to set a six-digit PIN; create cashier accounts as needed.
2. Add products and stock. Set each product's appropriate tax rate: **prices include tax**, and existing products default to 0% until configured.
3. Open **Checkout**, name and enroll the browser as a register. This ends its management session.
4. Select an employee, enter their PIN, and start a shift with the opening drawer cash.
5. Scan or select items, take payment, then print the receipt. If the result is uncertain, use **Recover payment**; the same request ID is retained across reloads.
6. Finish or clear all active/held carts, then close the shift and enter the counted cash.

Existing stores upgrade without deleting products or history:

```sh
pnpm build
pnpm db:migrate
pnpm dev
```

A product unit cannot currently be changed; historical movements need an explicit conversion workflow. Categories remain labels rather than a hierarchy. History screens show the latest 100 records (cashier receipt history: 20); older records remain in PostgreSQL. Receipt numbering is globally unique and may have gaps after rollbacks. Receipts currently contain basic store details; jurisdiction-specific fiscal/receipt requirements and hardware support must be completed before live retail use.

## Checks

Start the development PostgreSQL server first. Integration and browser tests create and delete their **own temporary databases**; they do not populate your real store. The configured database account needs `CREATEDB` for these tests.

```sh
pnpm typecheck
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
```

Integration coverage includes duplicate barcode rollback, sale retries, concurrent register stock conflicts, weighted tax/discount rounding, manager approvals, PIN throttling, device blocking, drawer reconciliation, and immutable history. The browser test covers store setup through checkout and shift close, including a deliberately lost successful payment response and recovery after reload. Screenshots are written to `test-results`.

### Use purchasing

Open **Suppliers** to add contacts, then **Purchases** to create and edit a draft. Place the order when ready. Use **Receive delivery** for each actual delivery; quantities may be partial. Receiving updates stock and the latest purchase cost, while preserving order and delivery cost snapshots. Purchase costs exclude tax. Drafts and placed orders do not change stock.

Owner and Manager roles have purchasing access. Deliveries cannot exceed outstanding quantities; piece, pack, and box products require whole quantities. Draft or placed orders can be cancelled with a reason; partially received orders cannot be cancelled. Supplier deactivation blocks new orders but still permits receiving existing placed orders. Receiving retries reuse the same request while its dialog stays open; after closing/reloading, check delivery history before entering another delivery.

Supplier payments, invoice matching, purchase returns, barcode receiving, and offline delivery synchronization are not implemented. Orders list the latest 200 records.

Receiving now creates a stock batch for each delivered product, carrying its expiry date when provided. Checkout allocates stock from the earliest unexpired batch first and refuses a sale when the remaining quantity is expired. The POS catalogue shows saleable stock; Inventory shows each batch and its expiry. Existing stock at migration time, opening balances, and positive manual adjustments are placed in an unknown-expiry batch. Those quantities remain saleable until staff physically verify and reconcile them. FEFO allocation is an accounting assumption; a barcode without a batch identifier cannot prove which physical batch the customer selected.

## Next milestones

1. Stock counts, expenses, and supplier invoice/payment tracking.
2. Referenced refunds/returns, void controls, split payments, and richer financial reports.
3. Store tax/receipt configuration, password recovery, and production hardening.
4. Durable IndexedDB cart/product storage, a separately designed offline synchronization protocol, and payment/printing hardware integrations.

No full offline checkout, direct card charging, job processing, email recovery, or hardware integration is implemented yet.

## Repository

- `apps/web`: browser application and UI components.
- `apps/api`: backend modules, Drizzle schema, and reviewed SQL migrations.
- `packages/contracts`: shared validation, DTOs, and exact decimal helpers.
- `scripts`: local PostgreSQL and isolated browser-test startup.
- `tests`: unit, integration, and browser tests.
- `docs/architecture.md`: design choices and implementation boundaries.

This is a development foundation bound to localhost. Before deployment, configure a non-superuser database role, private database credentials, HTTPS, backups and restore verification, account recovery, and deployment-level rate limiting. No paid service is necessary to implement those capabilities.

### Sales summaries

Sales and Shifts now show date-range summaries grouped by day, week, month, shift, cashier, register, product, category, or payment method. Totals cover all completed sales in the range, independently of the recent-receipt limit. Both dates are inclusive in the store timezone, including daylight-saving transitions. Reports include transactions, sales after discounts including tax, cash/card sales, discounts, tax, and average basket. Shift grouping includes only sales within the selected dates. Opening float and drawer movements are excluded. Weeks start Monday. Product reports include quantities in each product’s unit. Product/category averages show group revenue per matching receipt; overall average basket always uses complete sales. Receipt counts across product/category rows may overlap. Payment totals exclude change; tax and discounts are not allocated to payment methods, and payments are not allocated to products. New receipts preserve category snapshots; older receipts appear under Unrecorded category. Profit remains future work.

### Receipt search and refunds

Use **Sales → Search all receipts** to find any stored receipt by number or transaction ID, optional dates, and pagination. Checkout has **Search / refund** for the same lookup and original receipt/refund history. Receipt reprints are audited.

An open register shift is required to issue a refund. Select returned quantities, mark saleable items for stock restoration, and enter a reason. Cashiers require a manager PIN; Owner/Manager may approve their own refund. Refunds use the original payment method, preserve the original sale, prevent over-returning, and retain immutable lines and approval history. Partial refunds use cumulative rounding so their sum exactly matches the discounted original line. Damaged/non-saleable returns do not restore stock. Cash refunds reduce the current shift drawer and cannot exceed its recorded balance. Card refunds must be performed on the external terminal and explicitly confirmed; Eliza records them but does not contact the terminal.

Pending refund requests are saved without PINs in this browser tab, scoped to operator/register/receipt. Reopen the receipt and choose Recover refund after a lost response; do not repeat an external payment. Closing the browser tab or clearing its storage can lose the pending request, so inspect refund history first. Reports show original sales before refunds, refunds issued during the selected dates, and sales less refunds. Breakdown rows remain original sales, not refund allocations.

### Physical stock counts

Open **Stock counts** and create a draft with up to 500 selected products (including inactive products if needed). Only one count can be open per store. Start counting to capture system quantities, enter and save every physical quantity including zero, then choose Review count. Owner and Manager can finalize the reviewed differences. Finalization creates stock movements only for nonzero differences and retains who counted and finalized the operation. Finalized and cancelled counts remain in history.

Perform counts while selected stock is not moving. Any sale, delivery, return, or adjustment after the snapshot blocks finalization, even if the resulting balance is unchanged. Restart count captures current balances and clears all quantities; physically recount the selected products before reviewing again. Cancelling requires a reason and never changes inventory. Counts list the latest 100 operations. Retry a pending command in the same screen; after reloading, open the count and check its saved state before continuing.

### Basic gross profit

Sales and Shifts show a Gross profit section using the same selected dates. Viewing it requires both sales-report and cost permissions. Net revenue is completed sales minus included tax and refunds excluding tax. Goods cost uses each immutable sale-item purchase-cost snapshot multiplied by its quantity and rounded per line, independently of current product costs. Profit equals net revenue minus goods cost, adjusted for saleable returns. Margin is profit divided by positive net revenue; otherwise it is unavailable.

Refunds affect the date issued, even when the original sale falls outside the selected dates. Restocked quantities reverse a cumulative proportional share of the original rounded cost; non-saleable returns leave goods cost in the result. This preserves full-return rounding and reflects damaged-return losses. Zero recorded costs are treated as zero; entirely missing historical cost records make the profit result unavailable. This is a basic historical-cost estimate, not FIFO valuation or net profit. Operating expenses, inventory write-offs and count differences are excluded. Expense tracking is deferred.

### Store and receipt settings

Owners can edit Store settings: store name, business address, phone, business/tax registration number, receipt footer, and the default tax rate for newly created products. Each save is version-checked and audited. Currency and timezone remain fixed in this MVP to preserve reporting consistency. Default tax does not change existing product rates; explicit per-product rates still take precedence.

New checkout receipts snapshot the store header details and footer. Subsequent settings changes do not alter historical receipts or reprints. Older receipts retain their original basic layout and thank-you text. Tax and receipt content must be configured for the store; no jurisdiction-specific fiscal certification is implied.

### Local operational tools

Use `pnpm ops:check`, `pnpm db:backup`, and `pnpm db:verify-backup <dump>` for diagnostics and backup verification. `pnpm db:restore-new <dump>` restores into a separate database; owner recovery is an explicit local-administrator command. See [the operations runbook](docs/operations.md) for exact recovery steps and remaining deployment requirements. Backups are private but unencrypted; off-device copies and scheduling remain operator responsibilities.

## macOS desktop prototype

`pnpm desktop:dev` runs the shared application against an isolated local store, with no cloud dependency for checkout. See [desktop setup and limitations](docs/desktop.md) before using it. PostgreSQL must currently be installed separately; cloud synchronization and a signed self-contained installer are not implemented.
