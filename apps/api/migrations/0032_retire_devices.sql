ALTER TABLE devices ADD COLUMN removed_at timestamptz;
CREATE INDEX devices_active_store_idx ON devices(store_id) WHERE removed_at IS NULL;
