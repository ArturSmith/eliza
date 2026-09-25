ALTER TABLE employees ADD COLUMN price_tags_access boolean NOT NULL DEFAULT false;
UPDATE employees SET price_tags_access=true WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Owner','Manager'));
CREATE TABLE price_tag_sessions (
  token_hash text PRIMARY KEY,
  device_id uuid NOT NULL UNIQUE REFERENCES devices(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE price_tag_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  device_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  products jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id),
  FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id)
);
