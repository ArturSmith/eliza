CREATE TABLE store_layouts (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  layout jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
