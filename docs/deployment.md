# Deploy Eliza on Railway

This deploys one Node application serving both the React build and `/api`, plus a separate PostgreSQL service. The repository includes a Dockerfile and railway.json. No cloud resources are created by these files.

## Provision

1. Create a Railway project and add PostgreSQL. Keep the application and database in the same region. Keep the database private; use the internal connection for the application.
2. Add an application service from this repository, using the repository root (not apps/api or apps/web). Railway uses the Dockerfile and railway.json. The image includes built workspace packages and SQL migrations.
3. Generate the service's public domain, then set these application variables before a successful production deployment:

   - `NODE_ENV=production`, `HOST=0.0.0.0`, `SERVE_WEB=true` (already set by the image).
   - `DATABASE_URL`: reference the PostgreSQL service's private connection URL. Do not put credentials into Git or frontend build variables.
   - `APP_ORIGIN`: the exact HTTPS public origin, such as `https://your-service.up.railway.app`, without a trailing slash.
   - `SETUP_TOKEN`: a random secret of at least 32 characters from a password manager. Give it privately to the owner for first setup.
   - `TRUST_PROXY=1`: for Railway's single ingress hop. Never use this setting for an API also reachable directly by untrusted clients. Reassess the hop count if adding another proxy.

   Railway supplies `PORT`. Production refuses to start with missing or development database credentials or a non-HTTPS application origin. A private Railway database connection stays on its internal network; if connecting over a public network instead, require verified TLS according to the database provider's instructions. Never disable certificate verification.

4. Before live trading, use a restricted application database role. Supply its URL as `DATABASE_URL` and the migration owner's URL as `MIGRATION_DATABASE_URL`; override Railway's pre-deploy command with `node scripts/deploy-migrate.mjs`. Grant the app CONNECT on the database, USAGE on public, SELECT/INSERT/UPDATE/DELETE on application tables, and USAGE/SELECT on sequences. Apply equivalent default privileges for future objects owned by the migration role. Do not grant superuser, CREATEDB, schema CREATE or table ownership. The migration role must own the schema objects. Startup health needs SELECT on schema_migrations.
5. Deploy. The configured pre-deploy command applies migrations once under a PostgreSQL advisory lock. Failure stops deployment. `/api/health` checks database reachability and migration checksums. Do not run migrations in the Docker build or on every request.
6. Open the public address and complete store setup with the setup token. Remove SETUP_TOKEN afterwards and redeploy; production then disables setup. Existing owner login continues to work. Setup is limited to one store initialization per database.

## Verify before trading

Use a separate staging database for testing; preview deployments must never write to the live store. Verify login and Secure/HttpOnly cookies, reload `/analytics` directly, register enrollment, a test sale, refund, shift close, and your actual scanner and receipt printer. Confirm incorrect origins and setup tokens are rejected. Check that unknown `/api` routes return errors instead of the frontend HTML. The API documentation is disabled in production.

Authentication attempt limits are shared through PostgreSQL, including across application restarts. Confirm the trusted proxy configuration yields distinct client addresses. Configure Railway logs/alerts and monitor `/api/health` externally; a deployment health check alone is not continuous monitoring.

## Backups and releases

Enable scheduled database backups in Railway and select an appropriate retention policy before real sales. Verify restoration to a separate database, then run the operations checks against that database using compatible PostgreSQL tools. Keep protected off-provider backups as well. Existing local backup/recovery scripts should run from a controlled administrator machine with database access; the application container is not persistent backup storage and does not contain PostgreSQL client tools.

Before each production upgrade: take a verified backup, review migrations, test in staging, and deploy during a quiet period. Code rollback does not reverse SQL migrations: use backward-compatible migrations, or plan a maintenance window. Never restore over live sales without reconciliation. Recover an owner account using the operations runbook from a trusted administrator machine.

New installations should start with an empty database. Moving existing local data requires a separate backup/restore cutover, with checkout paused and receipts verified. Deploying this repository does not transfer local data.

## Local production build

`pnpm install --frozen-lockfile` followed by `pnpm build` creates the production files. Run migrations explicitly before starting. `pnpm start` starts Node; set SERVE_WEB=true to serve the frontend. Production also needs the variables above and an HTTPS proxy. Use `docker build -t eliza .` to build the deployment image; it runs as the non-root node user. Do not use `pnpm dev` or Vite preview as the production server.

The deployment remains online-only: completing sales requires connectivity to this server. Hosting does not add offline checkout or direct card-terminal integration.

## Optional barcode lookup

New-product forms can query Open Food Facts. Read lookups need no paid key. Set OFF_CONTACT to an administrator contact email or application URL for provider identification. For live provider testing use OFF_ENV=staging (the public staging Basic Auth is applied automatically); omit it for normal use. Automated tests mock provider responses and never contribute data.

Only the scanned barcode is sent; prices, employee details and stock are not uploaded. Outbound HTTPS access to world.openfoodfacts.org and images.openfoodfacts.org is needed. Requests have timeouts and response-size limits, a bounded process cache and a PostgreSQL-shared budget of 12 uncached product requests per minute. Multiple independent databases behind one public IP must share an additional provider budget. Errors leave manual product creation available.

Imported fields retain source barcode, brand, package size and image provenance. Data is attributed to Open Food Facts contributors (ODbL / Database Contents License); imported photos are resized and credited under CC BY-SA 3.0. Preserve attribution in exports and follow the provider's database reuse terms when distributing derived catalogs; importing does not upload private inventory to Open Food Facts. Before public rollout review https://openfoodfacts.github.io/openfoodfacts-server/api/ and complete its API usage form.
