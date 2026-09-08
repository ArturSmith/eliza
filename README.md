# Eliza

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

## Next milestones

1. Purchasing, suppliers, partial receiving, stock counts, and expenses.
2. Referenced refunds/returns, void controls, split payments, and richer financial reports.
3. Store tax/receipt configuration, password recovery, and production hardening.
4. Durable IndexedDB cart/product storage, a separately designed offline synchronization protocol, and payment/printing hardware integrations.

No full offline checkout, direct card charging, refunds, job processing, email recovery, or hardware integration is implemented yet.

## Repository

- `apps/web`: browser application and UI components.
- `apps/api`: backend modules, Drizzle schema, and reviewed SQL migrations.
- `packages/contracts`: shared validation, DTOs, and exact decimal helpers.
- `scripts`: local PostgreSQL and isolated browser-test startup.
- `tests`: unit, integration, and browser tests.
- `docs/architecture.md`: design choices and implementation boundaries.

This is a development foundation bound to localhost. Before deployment, configure a non-superuser database role, private database credentials, HTTPS, backups and restore verification, account recovery, and deployment-level rate limiting. No paid service is necessary to implement those capabilities.
