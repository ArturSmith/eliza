# Local store month simulation

The simulator runs the real compiled Eliza API against a **new local PostgreSQL database**. It creates employees, devices, products and suppliers through their HTTP endpoints, advances one shared virtual clock, and reconciles each day against an independent in-memory ledger. It does not insert fabricated sales or rewrite historical receipts.

## Run

Start local PostgreSQL and install the project's dependencies using the normal development setup. From the repository root:

```sh
npm run simulate:store
```

Defaults: 30 days ending today in Europe/Oslo, 100 products, 80 base baskets per day (more on weekends), seed 42. This is a synthetic workload, not a demand forecast. Every run creates a new database and preserves previous runs.

```sh
# Small smoke run
npm run simulate:store -- --days 3 --products 12 --sales 12 --end 2026-10-24

# Reproducible full-month workload
npm run simulate:store -- --days 30 --products 100 --sales 80 --seed 42 --end 2026-10-24
```

The seed controls shopping choices and payment methods. Database IDs, authentication secrets, request IDs and the winner of a concurrent request are intentionally not deterministic.

Allowed ranges: 2–90 days, 10–500 products, 6–1000 base baskets/day. For the complete weekly scenario coverage, use at least 14 days. The runner stops at the first unexpected API response or reconciliation failure; it never silently skips a failed financial assertion.

## Open the resulting store

```sh
npm run simulate:serve
# Or select a specific preserved run:
npm run simulate:serve -- --run /absolute/path/to/.local/simulations/eliza_sim_...
```

Open **http://localhost:5183**. The store is named “Eliza — 30 day simulation”. Sign in using the local `credentials.json` file printed by the command. It contains the manager login/PIN and the four employees' PIN/QR credentials. No real personal data is used. Opening the site is not the same as logging in: browsers receive their own normal authenticated sessions.

The command builds the current web app first. The simulation clock remains frozen at the last simulated instant, so the current test day's promotions, labels and dashboard remain inspectable even if you return later. Normal HTTP authentication, permissions, idempotency, append-only triggers and stock locking remain active. Subsequent manual operations change this sandbox only; the report describes the completed automated run, not your later manual edits.

Use the simulator's server to inspect the database. Starting the regular API against it would mix real runtime time with the sandbox's frozen database defaults. The normal site on port 5173 and the Railway deployment use their existing databases.

## Workload

- One owner/manager, three rotating cashiers (one also has the Manager role), one floor employee. Profile fields and PIN/QR credentials are populated through the employee API.
- Two registers and a floor phone assigned to Price Tags.
- Four suppliers with offers, lead times and sample WhatsApp numbers; generated product barcodes, pieces and kilograms, multiple tax rates.
- Every day: open both shifts, sell mixed baskets, accept cash/card, refund current and older receipts, write off damaged items, close both shifts and reconcile.
- Deliveries: draft → ordered → received, partial receipts, different batch costs and expiry dates. Some orders remain pending or draft, others are cancelled. Supplier payments include paid and overdue unpaid orders.
- Discounts: overlapping product/category promotions, automatic expiry, cancellation, base-price changes, unit labels, replacement/cancellation, barcode lookup, markdown sales and display/print payloads in Price Tags.
- Weekly: shopping lists, stock counts with a discrepancy, concurrent sales of the same final stock. Cash movements and manager-approved drawer differences are included.
- Rent and payroll are allocated over the simulated period; one-time expenses are recorded weekly. Remainder cents are checked across daily and whole-period reports.
- Deliberate rejections: stock overrun, concurrent overrun, stale checkout price, inactive product, spent/replaced/cancelled/expired labels, excessive refunds and insufficient permissions. Repeated sale/refund/receiving/markdown requests must not duplicate records.

Held carts are browser-tab state and are not exercised by this API workload. Optional external workflows such as AI document extraction, WhatsApp delivery, real payment terminals, physical camera/Bluetooth printing, Electron offline sync and load/latency under many concurrent users require separate tests. Print completion here is explicitly simulated; no printer is contacted.

## Independent reconciliation

The control ledger in `scripts/simulation/ledger.mjs` does not call application pricing, financial or batch-allocation functions. It computes expected prices from scenario rules, reserves units, consumes expiry-first stock, rounds amounts using integer cents and thousandths, restores original allocation costs for refunds, and tracks cash independently.

Batch IDs returned by the application identify physical lots; received quantities, costs and expiry are checked against planned delivery inputs before they enter the control ledger. IDs are not used as a source of expected monetary totals.

After each virtual day the runner verifies:

1. Every product and batch quantity, and every newly sold line's historical batch cost.
2. Receipt prices, original prices, discounts, included tax and paid totals.
3. Revenue, COGS, gross profit/margin, inventory losses, allocated operating expenses and operating profit against the financial API.
4. The same financial fields on Overview, and sales/refunds/payment/discount/tax totals on Analytics.
5. Movement/product consistency, sale/payment/line totals, refund-line totals, drawer history and no open shifts.

At the end it checks the whole-period financial summary, reports/pagination/replenishment/action center, distinct sale dates, equality of receipt and database timestamps, and that no application integrity trigger is disabled. Financial definitions follow the platform's current management metrics; this is not fiscal certification or payment settlement reconciliation.

## Isolation and virtual time

There are no production application changes or migration changes for the simulator. Only local PostgreSQL hosts are allowed. Each new target database must have the generated `eliza_sim_` prefix; existing business databases are never reset. The viewer additionally requires the simulator's clock schema to exist.

The runner installs a private `eliza_simulation.clock` in the new database. Only that database's time-dependent defaults and SQL/PLpgSQL functions are pointed at its clock. In the simulation process, PostgreSQL query clock expressions and JavaScript `Date` use the same instant. SQL literals, quoted identifiers, comments and dollar-quoted bodies are preserved by the runtime rewriter. Append-only protections stay enabled; sales/receipts are never backdated by UPDATE. New API sessions are established as the virtual days advance and old sessions expire normally.

This is a testing harness with privileged access to its disposable database, not an alternative production database clock. Do not export these sandbox-specific defaults/functions to production or deploy a simulation database.

## Artifacts and failures

Everything is local under the Git-ignored `.local/simulations/<database-name>/`:

- `report.md`: readable successful-run summary and scenario counts.
- `report.json`: running/passed/failed status, daily reconciliations, whole-period totals, coverage and assertion count. A failed run records its error and last virtual instant.
- `journal.jsonl`: HTTP method/path/status and daily results, tagged with virtual time. Request bodies, authentication cookies/passwords/QR credentials are excluded.
- `credentials.json`, `config.json`: private local access details and configuration.
- `api.log`, `migration.log`: diagnostic logs.

Directories use mode 0700 and files 0600. The latest pointer advances only after a successful run. Failed databases are preserved for investigation and are never reused by the next run. There is no automatic database deletion command.

## Checks for the harness

```sh
./node_modules/.bin/vitest run tests/store-simulation.unit.test.ts
```

Unit cases cover rejecting remote/business database targets, SQL literal preservation, seeded inputs, promotion precedence, expired/reserved stock, original price display, fractional multibatch refunds and period-expense cents. A real simulator run is the integration test of database defaults, session expiry, SQL/JS time and the complete API workflow.
