# macOS desktop: local-store prototype

Eliza Desktop lives in this monorepo under `apps/desktop`. It runs the **existing** API, migrations and web UI locally. Sales, refunds, shifts, stock, batch costs and markdown label consumption use the same PostgreSQL transactions as the web product; checkout does not call Railway. It is not an offline queue of provisional cloud sales.

## Run on a Mac

The packaged Mac app includes PostgreSQL and all database tools. End users do not install Homebrew, PostgreSQL or a separate database service. Eliza starts and stops its own private cluster automatically.

For source development, build the embedded runtime once with `pnpm desktop:postgres` (macOS Command Line Tools and internet required). A matching Homebrew installation or `POSTGRES_BIN` remains an optional development fallback only.

```sh
pnpm install
pnpm desktop:dev
```

If your package manager did not run Electron's download script, run `node apps/desktop/node_modules/electron/install.js` once while online. Building/downloading dependencies requires internet. Subsequent store operations do not. Create a **new local store** on first launch; existing Railway products and accounts are not automatically copied.

Internal macOS build, for the current CPU architecture:

```sh
pnpm desktop:package:mac
```

The `.app`, a drag-to-Applications `.dmg`, and its SHA-256 checksum are written under `.local/desktop-builds`. It includes the API, web assets and production JavaScript dependencies. **PostgreSQL is included in the app; no separate installation is required.** It is unsigned and unnotarized; it is not yet a public installer. iOS is not supported by Electron.

## Data and process lifetime

- Store directory: `~/Library/Application Support/Eliza Desktop`. `ELIZA_DESKTOP_DATA_DIR` can explicitly select another store directory (used by the disposable smoke test).
- Separate PostgreSQL cluster: `postgres/`, loopback port `54339`, random password in mode-0600 `database-secret`. Does not use `.local/postgres` or a developer/cloud `DATABASE_URL`.
- HTTP API + UI: `http://127.0.0.1:37931`; production runtime validates the exact loopback configuration. Public web deployments still require HTTPS. Existing permission checks, strict cookies and Origin validation remain active.
- On launch: initialize cluster if absent, start PostgreSQL, apply transactional checksum-verified migrations, start API, open window. On normal quit: stop the browser, stop accepting HTTP connections, close idle/preconnect sockets, drain active requests, close the API, finish backups and stop PostgreSQL. Startup failures retain existing data.
- Single-instance application lock prevents two windows managing the same cluster. A crash can leave PostgreSQL running; relaunch reconnects to that cluster. Do not remove `postmaster.pid` manually.
- Local server logs: `server.log`; PostgreSQL logs: `postgres.log`. Do not share logs without reviewing them.
- The renderer has no Node integration or privileged IPC bridge. Outbound renderer requests are blocked. Camera permissions are restricted to the local application. AI/document cloud processing is disabled in this initial local mode.

## Verify

```sh
pnpm build
pnpm exec vitest run tests/desktop-runtime.unit.test.ts tests/desktop-backup.unit.test.ts tests/desktop-bundle.unit.test.ts tests/desktop-shutdown.unit.test.ts
node tests/desktop/offline-smoke.mjs
```

The smoke test launches actual Electron against a disposable cluster, creates stock, records a cash sale, retries its request without double counting, restarts the application and checks receipt/stock persistence. It must run alone because it owns the desktop ports. Browser internet access is blocked by the desktop network policy; this does not disable the Mac's network.

Manual: set up the local store while connected, close/reopen it, disconnect external internet, enroll a register, open a shift, scan and sell a product for cash, print a receipt, restart and verify the sale and remaining stock. Reconnect internet: the local store should remain unchanged; there is no cloud synchronization yet.

## Explicit boundaries before store rollout

- **No cloud import, replication, merge, outbox or sync.** Local store is independent of Railway. Do not use both as if they shared stock.
- One Mac owns the store. LAN access, discovery, TLS and multi-device enrollment are not implemented. Phones cannot yet use this local server.
- Automatic local backups and restore verification are implemented below. Keep off-device copies and test the actual recovery procedure before using real money. Copying a running PostgreSQL data directory is not a safe backup.
- Add signed/notarized installers, controlled updates and guided recovery UX. The relocatable PostgreSQL runtime and its license are now included. Do not update during a payment.
- Validate receipt/label printing on actual printers; current printing uses the existing print dialog. External WhatsApp windows are currently blocked by the desktop sandbox policy.
- Offline card authorization depends on a separate payment terminal/provider; this prototype records confirmed external card payments and does not authorize them.
- Offline AI inference is not included. No cloud AI key is passed into the local API.

Framework references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [utility processes](https://www.electronjs.org/docs/latest/api/utility-process), [ES module lifecycle](https://www.electronjs.org/docs/latest/tutorial/esm).

## Local backups

The desktop app now creates consistent PostgreSQL snapshots at startup, every 30 minutes, and on normal exit. Before applying pending migrations to an existing schema, it creates a backup and **restores it into a temporary database to verify it**. A failed pre-migration backup/verification prevents the migration.

Automatic archives live in `backups/` inside the store directory. The latest 48 automatic archives are retained; manual exports outside that set are not pruned. Abrupt power loss cannot run an exit backup, so the most recent recoverable archive may be up to 30 minutes old (or older after a reported failure). A completed sale remains in the local PostgreSQL database independently of the backup schedule.

Use the macOS **Eliza** menu while signed into Management with `settings.manage` access:

- **Save store backup…** — choose a destination, including an external drive.
- **Verify store backup…** — restores into a temporary database, compares all public-table row counts and migration checksums, then removes the temporary database. The active store is not modified.
- **Show automatic backups** — opens the local archive folder. The menu also shows the latest automatic-backup time and reports failures.

Each `.elizabackup` file contains a versioned manifest and PostgreSQL custom-format archive with SHA-256 validation. Metadata and data share one exported database snapshot, including when sales occur during the backup. Files use private permissions (0600 where supported) and never overwrite an existing archive. On the Mac filesystem, completed archives are published atomically. FAT/exFAT USB volumes use exclusive copying; an interrupted copy is rejected by checksum verification. **Archives are not encrypted.** Keep them private; copy them off the Mac for protection against disk loss. Only restore trusted backups you created.

### Restore into a separate store directory

```sh
node apps/desktop/scripts/restore-store.mjs /path/to/store.elizabackup /path/to/new-store
ELIZA_DESKTOP_DATA_DIR=/path/to/new-store pnpm --filter @eliza/desktop start
```

The destination must not already exist. Restoration runs in its own new cluster on a temporary loopback port, leaving the active store untouched. It checks schema history and row counts before returning success and clears management/POS/Price Tags login sessions; accounts and transaction history remain. The restored store runs current migrations when opened. For now restoration is a command-line operation; a guided recovery screen is not implemented.

Browser device credentials are not included in the archive. An open shift remains in the restored history, attached to its original register. Recovery/rebinding of a lost physical register needs a separate manager workflow before this can be considered a complete disaster-recovery solution for a live store.


## Embedded database distribution

`pnpm desktop:postgres` builds checksum-pinned official PostgreSQL sources for the host Mac architecture. PostgreSQL 17.11 is used for fresh stores; 14.24 is bundled to open existing PostgreSQL 14 preview stores without a major-version conversion. Stores using another major version stop with an explicit compatibility error; their data is never reinitialized. Plan a separate verified migration before removing the legacy runtime.

The build cache lives in `.local/postgres-runtime/darwin-<arch>/`. Packaging copies it to `Eliza.app/Contents/Resources/runtime/postgres/`, including each version's `COPYRIGHT` and a source/checksum manifest. The build rewrites internal library paths, applies ad-hoc signatures and rejects non-system dependencies outside the bundle. PostgreSQL uses macOS system libraries (including zlib for existing compressed backups); optional ICU, OpenSSL, GSSAPI and readline integrations are disabled. Database access remains restricted to loopback with SCRAM authentication. Remote cloud communication will use the API, not this PostgreSQL server.

Packaging fails if a runtime is incomplete, has the wrong architecture or contains a dependency on Homebrew/build-machine paths. The packaged app always uses the included runtime and does not honor an external `POSTGRES_BIN`. Existing database directories and backups remain under Application Support, outside the replaceable app bundle.

Verify a packaged build with system PostgreSQL deliberately unavailable to the app:

```sh
ELIZA_DESKTOP_SMOKE_NO_SYSTEM_POSTGRES=1 \
ELIZA_DESKTOP_SMOKE_BINARY="/path/to/Eliza.app/Contents/MacOS/Eliza" \
node tests/desktop/offline-smoke.mjs
```

This checks actual Electron startup, offline sale/retry, restart, backups and restore. The final DMG was also tested read-only from a mounted image with both the staging directory and build-time PostgreSQL cache temporarily unavailable; the application and recovery tools used only the image’s embedded runtime. Build each CPU architecture on a matching Mac; the current local artifact is Apple Silicon. Bundling the database does not add Railway synchronization or Apple notarization.
