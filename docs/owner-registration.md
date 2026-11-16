# Independent store owners

Hosted self-registration is **disabled by default**. To enable it, explicitly set `ALLOW_REGISTRATION=true` on the API service and redeploy. The web app reads `/api/auth/status`; the login page then shows **Create a store account**, linking to `/register`.

Each registration creates a new organization, one store, its four default roles, an owner and a store-specific management device/session. The organization, store, roles and owner are provisioned in one transaction; the management device/session is issued afterwards. Email addresses remain globally unique for existing email/password login; duplicate or concurrent requests do not leave empty organizations behind. Registration never accepts an existing store, organization or role ID from the caller.

The original `/api/auth/setup` is still a one-time, protected bootstrap endpoint. Its `SETUP_TOKEN` rules have not changed. `/api/auth/register` is a separate, opt-in endpoint: new owners do not need the server's bootstrap token. Both use the existing request-origin protection and shared database-backed authentication rate limit.

Catalog, stock, employees, devices, receipts and financial reports continue to use the authenticated store. Management login and registration create/reuse a device belonging to that store. Successful management login discards stale workspace cookies from other stores without changing their devices or sessions.

Use `/login` to sign into an existing account. Setting `ALLOW_REGISTRATION=false` closes new registrations and hides the link while preserving login. Desktop installations always keep self-registration disabled and retain their local first-store setup.

Registration creates independent owners/stores. Shared ownership of an existing store continues to use Team roles. The current account identity is still an employee of one store; a single owner's multi-store switching and email verification are separate work.

Verification: `tests/owner-registration.integration.test.ts` provisions two owners, checks concurrent/duplicate requests and rollback, attempts cross-store operations, records a real sale, reconciles financial summaries, and exercises browser/device switching. Use disposable databases for tests. No production database reset is required.
