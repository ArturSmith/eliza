-- Display tokens expire after 30 seconds. POS scanning binds a separate
-- checkout authorization to a cashier/device and consumes it with one sale.
-- Permanent membership card_token values remain for history, but are not accepted.
CREATE TABLE loyalty_qr_tokens (
 token_hash text PRIMARY KEY,
 store_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 checkout_token_hash text UNIQUE,
 checkout_expires_at timestamptz,
 device_id uuid REFERENCES devices(id),
 employee_id uuid REFERENCES employees(id),
 sale_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(membership_id,store_id) REFERENCES loyalty_memberships(id,store_id),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),
 CHECK ((checkout_token_hash IS NULL AND checkout_expires_at IS NULL AND device_id IS NULL AND employee_id IS NULL AND sale_id IS NULL)
 OR (checkout_token_hash IS NOT NULL AND checkout_expires_at IS NOT NULL AND device_id IS NOT NULL AND employee_id IS NOT NULL))
);
CREATE INDEX loyalty_qr_tokens_cleanup ON loyalty_qr_tokens(membership_id,expires_at) WHERE sale_id IS NULL;
