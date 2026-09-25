CREATE TABLE device_records (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(id,store_id)
);
INSERT INTO device_records(id,store_id,name,type,created_at)
SELECT id,store_id,name,type,created_at FROM devices;
CREATE FUNCTION sync_device_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO device_records(id,store_id,name,type,created_at)
  VALUES(NEW.id,NEW.store_id,NEW.name,NEW.type,NEW.created_at)
  ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_device_record_after_write AFTER INSERT OR UPDATE OF name,type ON devices
FOR EACH ROW EXECUTE FUNCTION sync_device_record();
ALTER TABLE audits DROP CONSTRAINT audits_device_id_fkey;
ALTER TABLE audits DROP CONSTRAINT audits_device_id_store_id_fkey;
ALTER TABLE audits ADD CONSTRAINT audits_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE movements DROP CONSTRAINT movements_device_id_fkey;
ALTER TABLE movements DROP CONSTRAINT movements_device_id_store_id_fkey;
ALTER TABLE movements ADD CONSTRAINT movements_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_device_id_store_id_fkey;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_device_id_store_id_fkey;
ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE price_tag_prints DROP CONSTRAINT price_tag_prints_device_id_store_id_fkey;
ALTER TABLE price_tag_prints ADD CONSTRAINT price_tag_prints_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE purchases DROP CONSTRAINT purchases_device_id_store_id_fkey;
ALTER TABLE purchases ADD CONSTRAINT purchases_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE purchasing_commands DROP CONSTRAINT purchasing_commands_device_id_store_id_fkey;
ALTER TABLE purchasing_commands ADD CONSTRAINT purchasing_commands_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE refunds DROP CONSTRAINT refunds_device_id_store_id_fkey;
ALTER TABLE refunds ADD CONSTRAINT refunds_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE sales DROP CONSTRAINT sales_device_id_store_id_fkey;
ALTER TABLE sales ADD CONSTRAINT sales_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE scanned_documents DROP CONSTRAINT scanned_documents_device_id_store_id_fkey;
ALTER TABLE scanned_documents ADD CONSTRAINT scanned_documents_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE shifts DROP CONSTRAINT shifts_device_id_store_id_fkey;
ALTER TABLE shifts ADD CONSTRAINT shifts_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
ALTER TABLE stock_counts DROP CONSTRAINT stock_counts_device_id_store_id_fkey;
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_device_id_store_id_fkey FOREIGN KEY(device_id,store_id) REFERENCES device_records(id,store_id);
DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE removed_at IS NOT NULL);
DELETE FROM pos_sessions WHERE device_id IN (SELECT id FROM devices WHERE removed_at IS NOT NULL);
DELETE FROM price_tag_sessions WHERE device_id IN (SELECT id FROM devices WHERE removed_at IS NOT NULL);
DELETE FROM pin_attempts WHERE device_id IN (SELECT id FROM devices WHERE removed_at IS NOT NULL);
DELETE FROM devices WHERE removed_at IS NOT NULL;
