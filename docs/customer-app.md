# Customer App integration

The separate `Eliza Customer App` project has its own mobile web UI, HTTP API and PostgreSQL database for customer profiles and authentication. The platform owns loyalty programs, membership references, campaigns, redemption authorizations and the append-only bonus ledger. No customer PII is copied into platform membership records. The customer service never connects to the platform database.

Deploy the platform's migration `0060_customer_loyalty.sql` using the existing migration flow. Configure a random server-only `CUSTOMER_APP_SERVICE_TOKEN` of at least 32 characters on both API services. The integration namespace `/api/integrations/customer/v1/` authenticates that token independently of browser cookie/Origin protection; all existing management/POS routes keep their original protection. With no token configured, integration access is closed. Desktop integration remains disabled.

Owner and Manager roles receive `loyalty.manage`. Open **Loyalty & campaigns**, save an enabled program and optionally publish scheduled campaigns. Shops are undiscoverable until explicitly enabled. Campaign content does not automatically change checkout prices; use Promotions for prices.

At checkout, scan a customer membership QR to earn bonuses. To spend them, the customer creates a single-use five-minute authorization QR in their app. The platform caps spending by balance and the configured purchase limit, allocates discounts/tax/earned bonuses per line, records everything with the sale, and preserves idempotent retry behavior. Refunds reverse original earned bonuses and restore original redemptions with cumulative rounding, including partial returns. Negative balances after returning previously rewarded purchases are visible and cannot be spent.

Version 1 has no tiers, point expiration, category exclusions, email verification, recovery or message delivery. Email verification/recovery and customer privacy information remain launch work. No production database reset is necessary. Deploy the platform before the customer service, keep their databases and `APP_ORIGIN` values distinct, and back up both databases.

The independent project's README contains the Railway variables and setup steps; its API.md documents all customer/server integration endpoints. Its integration and browser suites use two disposable local databases and verify live communication with the platform. They do not modify production or existing local app data.
