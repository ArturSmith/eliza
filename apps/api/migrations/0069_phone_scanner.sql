-- Temporary, narrowly scoped barcode transport. Tokens are stored only as hashes.
CREATE TABLE scanner_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores,
 owner_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL,
 device_id uuid NOT NULL,
 tab_id uuid NOT NULL,
 pairing_token_hash text UNIQUE,
 pair_expires_at timestamptz,
 phone_token_hash text UNIQUE,
 phone_seen_at timestamptz,
 desktop_seen_at timestamptz NOT NULL DEFAULT now(),
 target_id uuid,
 target_label text NOT NULL DEFAULT '',
 ready_until timestamptz,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id)
);
CREATE UNIQUE INDEX scanner_links_session_tab ON scanner_links(owner_session_id,tab_id) WHERE revoked_at IS NULL;
CREATE INDEX scanner_links_expiry ON scanner_links(expires_at);
CREATE TABLE scanner_link_scans (
 link_id uuid NOT NULL REFERENCES scanner_links(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 target_id uuid NOT NULL,
 barcode text NOT NULL CHECK(length(barcode) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 PRIMARY KEY(link_id,id)
);
CREATE UNIQUE INDEX scanner_one_pending ON scanner_link_scans(link_id) WHERE status='pending';
CREATE INDEX scanner_scans_latest ON scanner_link_scans(link_id,created_at DESC);
