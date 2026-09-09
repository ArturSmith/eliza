# Local operations runbook

These procedures are for Eliza on the local computer, with PostgreSQL reachable through localhost. Run commands from the repository. Keep `.env`, `.local/backups`, and `.local/recovery` private. The tools do not require external accounts.

## Start and check

```sh
pnpm db:start
pnpm build
pnpm db:migrate
pnpm ops:check
pnpm dev
```

Open http://localhost:5173. The API health endpoint returns 503 when the database cannot be reached or migration checksums do not match the application. The operational check verifies migration checksums, stock versus movements, sale items and payments versus sale totals, refund lines, over-return quantities, and closed cash drawers. A failed check requires investigation; do not repair a ledger by deleting history.

## Back up

```sh
pnpm db:backup
pnpm db:verify-backup .local/backups/your-backup.dump
```

The first command prints the exact backup path. A custom-format PostgreSQL dump and its `.json` manifest are created in a private folder. File permissions are 0600. Dumps include employee password hashes and transaction data; they are not encrypted. The manifest checksum detects accidental damage, not malicious tampering by someone who can replace both files.

The dump and manifest table counts share a repeatable-read snapshot, so concurrent transactions cannot make the counts inconsistent. Verification creates a uniquely named temporary database, restores the dump, checks counts, migrations, and ledger invariants, then removes only that temporary database. It never overwrites the source store. PostgreSQL tools must be compatible with the server; set POSTGRES_BIN if discovery cannot find them. Verification requires permission to create databases.

Run backups at the end of each trading day and before upgrades. Copy both files to protected off-device storage and periodically verify a copied backup. Retention and scheduling are manual in this milestone; a backup kept only on the same computer does not protect against loss of that computer.

## Restore after failure

Stop checkout and the app first. Preserve the current database and take a backup if it is still readable. Use a trusted backup with the matching application/migration version.

```sh
pnpm db:restore-new .local/backups/your-backup.dump
```

This creates a new database with a generated name, validates it, and clears restored management/POS sessions. It leaves the original database intact. The command prints the new database name. Update only the database name in DATABASE_URL in your private `.env`; do not copy credentials into chat or command-line arguments. Run `pnpm ops:check` and restart the app. Sign in again, inspect recent receipts, stock, and open shifts, and reconcile external terminal transactions since the backup before resuming checkout. A restore loses changes made after the backup snapshot; do not blindly repeat card payments or refunds.

Older dumps whose migrations differ from the running source must be restored using the matching application version before following the normal upgrade path. Keep an application release or commit reference alongside backups.

## Password and PIN recovery

An owner with access can reset employee PINs through Team. PIN resets revoke affected POS sessions. Forgotten owner passwords can be recovered by a trusted local computer/database administrator:

```sh
pnpm account:recover owner@example.com --confirm-local-recovery
```

Replace the email with the existing active owner's address. This command changes that owner's password, revokes management/POS sessions, and records an audit event using an inactive recovery device. It does not change PINs, bypass inactive accounts, close shifts, or create a new owner. An existing open shift stays open and must be reconciled normally.

The new random password is written to a generated 0600 file, not printed. Read it privately, save it in your password manager, then delete the file. If the command reports an uncertain database failure, keep any recovery file until an administrator checks whether the change committed. Local database access is an administrative capability; this is not email-based self-service recovery. Your ordinary account credentials are not changed by readiness or backup checks.

## Network or browser failure during checkout

Keep the same browser tab and operator where possible. Use Recover payment or Recover refund for a pending request rather than starting another payment. Inspect receipt/refund history when uncertain. Card transactions are performed on the external terminal, so verify that terminal separately. If a browser is locked, sign in with the same cashier's PIN. Do not delete sessions or reopen shifts through direct SQL to resolve drawer differences.

## Before deployment beyond localhost

The readiness report deliberately does not certify production use. Provision a restricted application database role, private credentials, HTTPS, protected off-device backups, shared login throttling if running multiple servers, and a deployment/service-restart procedure. Validate actual scanner/receipt hardware and applicable store receipt requirements. Current defaults use a development password and a superuser database role. Keep the local app private until those deployment tasks are completed. Expense tracking remains deferred.
