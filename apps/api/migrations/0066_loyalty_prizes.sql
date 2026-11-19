-- Gift progress is independent from the spendable points ledger.
ALTER TABLE loyalty_memberships ADD COLUMN reward_cycle integer NOT NULL DEFAULT 0 CHECK(reward_cycle>=0),
 ADD COLUMN reward_earned_baseline numeric(30,2) NOT NULL DEFAULT 0;
CREATE TABLE loyalty_prize_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL, membership_id uuid NOT NULL,
 cycle integer NOT NULL, tier text NOT NULL CHECK(tier IN ('bronze','silver','gold','diamond')),
 earned_snapshot numeric(30,2) NOT NULL, balance_snapshot numeric(14,2) NOT NULL,
 employee_id uuid NOT NULL,device_id uuid NOT NULL,request_id uuid NOT NULL,request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(store_id,request_id),UNIQUE(membership_id,cycle),UNIQUE(id,store_id),
 FOREIGN KEY(membership_id,store_id) REFERENCES loyalty_memberships(id,store_id),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id)
);
CREATE TRIGGER immutable_loyalty_prize_claims BEFORE UPDATE OR DELETE ON loyalty_prize_claims FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TABLE loyalty_prize_tokens (
 token_hash text PRIMARY KEY,store_id uuid NOT NULL,membership_id uuid NOT NULL,cycle integer NOT NULL,
 tier text NOT NULL CHECK(tier IN ('bronze','silver','gold','diamond')),expires_at timestamptz NOT NULL,
 employee_id uuid,device_id uuid,checkout_expires_at timestamptz,claim_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(membership_id,store_id) REFERENCES loyalty_memberships(id,store_id),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id),
 FOREIGN KEY(claim_id,store_id) REFERENCES loyalty_prize_claims(id,store_id),
 CHECK((employee_id IS NULL AND device_id IS NULL AND checkout_expires_at IS NULL AND claim_id IS NULL)
 OR (employee_id IS NOT NULL AND device_id IS NOT NULL AND checkout_expires_at IS NOT NULL))
);
CREATE INDEX loyalty_prize_tokens_cleanup ON loyalty_prize_tokens(membership_id,expires_at) WHERE claim_id IS NULL;
