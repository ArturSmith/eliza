# Customer App integration

The separate `Eliza Customer App` project has its own mobile web UI, HTTP API and PostgreSQL database for customer profiles and authentication. The platform owns loyalty programs, membership references, campaigns, redemption authorizations and the append-only bonus ledger. No customer PII is copied into platform membership records. The customer service never connects to the platform database.

Deploy the platform's migration `0060_customer_loyalty.sql` and `0061_loyalty_collect_spend.sql` using the existing migration flow. Configure a random server-only `CUSTOMER_APP_SERVICE_TOKEN` of at least 32 characters on both API services. The integration namespace `/api/integrations/customer/v1/` authenticates that token independently of browser cookie/Origin protection; all existing management/POS routes keep their original protection. With no token configured, integration access is closed. Desktop integration remains disabled.

Owner and Manager roles receive `loyalty.manage`. Open **Loyalty & campaigns**, save an enabled program and optionally publish scheduled campaigns. Shops are undiscoverable until explicitly enabled. Campaign content does not automatically change checkout prices; use Promotions for prices.

At checkout, scan the customer's normal membership QR. The cashier sees the current balance and asks the customer to choose **Collect** or **Spend**. Collect earns bonuses without spending any. Spend uses the smaller of the positive balance and purchase total, earns no new bonuses, and permits a fully bonus-paid purchase. A customer with 100 points buying a product for 50 spends 50 points, pays no cash and retains 50 points. Any amount not covered by the balance is paid by cash/card. There is no percentage cap or second customer authorization QR in this flow.

The platform rechecks/locks the membership in the sale transaction. Resolving a card never changes its balance, and safe request retries cannot debit it twice. Refunds restore the original spent bonuses and reverse original earned bonuses with cumulative rounding, including partial returns and purchases paid entirely with points. Negative balances after returning previously rewarded purchases are visible and cannot be spent. Historical receipt snapshots stay unchanged.

Legacy one-time authorization endpoints/codes remain supported for older clients; the Customer App no longer generates them. The old `redeem_percent` database column is retained for compatibility at 100%. Migration 0061 changes existing programs and advances their optimistic versions without altering past sales or balances.

Version 1 has no tiers, point expiration, category exclusions, email verification, recovery or message delivery. Email verification/recovery and customer privacy information remain launch work. No production database reset is necessary. Deploy the platform before the customer service, keep their databases and `APP_ORIGIN` values distinct, and back up both databases.

The independent project's README contains the Railway variables and setup steps; its API.md documents all customer/server integration endpoints. Its integration and browser suites use two disposable local databases and verify live communication with the platform. They do not modify production or existing local app data.
