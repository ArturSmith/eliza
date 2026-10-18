CREATE TABLE onboarding_progress (
  store_id uuid NOT NULL REFERENCES stores(id),
  employee_id uuid NOT NULL,
  page_id text NOT NULL CHECK (length(page_id) BETWEEN 1 AND 64),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('completed','skipped')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,employee_id,page_id,version),
  FOREIGN KEY (employee_id,store_id) REFERENCES employees(id,store_id)
);
