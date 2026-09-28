CREATE TABLE employee_qr_credentials (
  employee_id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, store_id) REFERENCES employees(id, store_id) ON DELETE CASCADE
);
CREATE INDEX employee_qr_credentials_store_idx ON employee_qr_credentials(store_id);
