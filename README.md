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

## Implemented milestone

- First-run store and owner setup; local password authentication with salted scrypt hashes.
- Opaque, hashed database sessions in HttpOnly, SameSite cookies; logout, expiry, and active-user/device checks.
- Owner, Manager, and Cashier permission collections; server-side access checks and cost visibility restrictions. Only the owner is created through the UI in this milestone.
- Management browser registration on authenticated login, renaming, blocking, and an activity trail. This is **not yet** trusted POS registration: a management user who knows their password can register a new browser.
- Product creation and editing, store-unique SKU/PLU, zero or multiple barcodes, categories as labels, activation and deactivation.
- Product search by name, barcode, SKU, and PLU, plus category filtering.
- Opening stock and manual adjustments, exact decimal quantities, row locking, idempotent request IDs, negative-stock prevention, and append-only stock movement records.
- Inventory overview, low-stock indicators, purchase-cost valuation, recent activity, employee listing, device management, and store profile display.
- Responsive desktop/mobile UI, with accessible Radix dialogs, validation, loading, empty, and error states.

A unit cannot currently be changed on an existing product; a conversion workflow must preserve the meaning of historical movements. Product prices/costs and barcodes can be edited with audit history. Categories are labels in this milestone; hierarchical category management remains on the roadmap. Inventory history and audit screens show the most recent 100 entries; the database retains the complete history.

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

Integration coverage includes duplicate barcode rollback, idempotent retries, concurrent updates, fractional inventory, permissions, cross-store isolation, blocked devices, logout, and database-enforced history protection. The browser test covers setup → create/edit product → opening stock → audit → persisted dashboard → mobile layout → logout/login. Screenshots are written to `test-results`.

## Next milestones

1. Employee management, cashier PINs, explicit POS device enrollment, basic shifts, and manager approvals.
2. POS scanning/cart, tax and rounding policy, payment records, atomic sale completion, and receipts. External card charging is a separate integration.
3. Purchasing and partial receiving, suppliers, counts, expenses, returns, and financial reports.
4. Locally preserved POS carts, product caches, and a separately designed offline synchronization protocol.

Checkout is not enabled yet. There are no fabricated sales metrics. File uploads, job processing, email recovery, full offline checkout, and hardware integrations are not implemented in this milestone.

## Repository

- `apps/web`: browser application and UI components.
- `apps/api`: backend modules, Drizzle schema, and reviewed SQL migrations.
- `packages/contracts`: shared validation, DTOs, and exact decimal helpers.
- `scripts`: local PostgreSQL and isolated browser-test startup.
- `tests`: unit, integration, and browser tests.
- `docs/architecture.md`: design choices and implementation boundaries.

This is a development foundation bound to localhost. Before deployment, configure a non-superuser database role, private database credentials, HTTPS, backups and restore verification, account recovery, and deployment-level rate limiting. No paid service is necessary to implement those capabilities.
