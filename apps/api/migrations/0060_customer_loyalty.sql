-- Customer PII and authentication belong to the separate Customer App database.
CREATE TABLE loyalty_programs (
 store_id uuid PRIMARY KEY REFERENCES stores(id), enabled boolean NOT NULL DEFAULT false,
 name text NOT NULL DEFAULT 'Your everyday rewards', description text NOT NULL DEFAULT '',
 earn_percent numeric(5,2) NOT NULL DEFAULT 3 CHECK(earn_percent BETWEEN 0 AND 25),
 redeem_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK(redeem_percent BETWEEN 0 AND 100),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loyalty_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id),
 customer_subject uuid NOT NULL, card_token text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(store_id,customer_subject), UNIQUE(id,store_id)
);
CREATE INDEX loyalty_memberships_customer ON loyalty_memberships(customer_subject);
CREATE TABLE loyalty_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id),
 title text NOT NULL, description text NOT NULL, published boolean NOT NULL DEFAULT false,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at)
);
CREATE INDEX loyalty_campaigns_store ON loyalty_campaigns(store_id,starts_at,ends_at);
CREATE TABLE loyalty_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL,
 membership_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('earned','redeemed','refund_earned','refund_redeemed')),
 amount numeric(14,2) NOT NULL CHECK(amount<>0), sale_id uuid NOT NULL,
 refund_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(membership_id,store_id) REFERENCES loyalty_memberships(id,store_id),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),
 FOREIGN KEY(refund_id,store_id) REFERENCES refunds(id,store_id),
 CHECK((kind IN ('earned','refund_redeemed') AND amount>0) OR (kind IN ('redeemed','refund_earned') AND amount<0))
);
CREATE INDEX loyalty_entries_wallet ON loyalty_entries(membership_id,created_at);
CREATE UNIQUE INDEX loyalty_entries_sale_once ON loyalty_entries(sale_id,kind) WHERE refund_id IS NULL;
CREATE UNIQUE INDEX loyalty_entries_refund_once ON loyalty_entries(refund_id,kind) WHERE refund_id IS NOT NULL;
CREATE TRIGGER immutable_loyalty_entries BEFORE UPDATE OR DELETE ON loyalty_entries FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TABLE loyalty_redemptions (
 token_hash text PRIMARY KEY, store_id uuid NOT NULL, membership_id uuid NOT NULL,
 max_points numeric(14,2) NOT NULL CHECK(max_points>0), expires_at timestamptz NOT NULL,
 sale_id uuid UNIQUE, FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id), FOREIGN KEY(membership_id,store_id) REFERENCES loyalty_memberships(id,store_id)
);
UPDATE roles SET permissions=permissions || '["loyalty.manage"]'::jsonb WHERE name IN ('Owner','Manager') AND NOT permissions ? 'loyalty.manage';
