ALTER TABLE stores ADD COLUMN no_sales_threshold_days integer NOT NULL DEFAULT 60 CHECK (no_sales_threshold_days BETWEEN 7 AND 365);
CREATE TABLE manager_insight_states (
  store_id uuid NOT NULL REFERENCES stores(id),
  insight_id text NOT NULL,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','SEEN','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED')),
  snapshot jsonb NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  snoozed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (store_id,insight_id),
  FOREIGN KEY (updated_by,store_id) REFERENCES employees(id,store_id)
);
CREATE INDEX manager_insight_states_status ON manager_insight_states(store_id,status,snoozed_until);
CREATE INDEX IF NOT EXISTS sale_items_store_product ON sale_items(store_id,product_id,sale_id);
