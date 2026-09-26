-- Preserve receipt costs independently of the mutable catalog cost.
ALTER TABLE stock_batches ADD COLUMN unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0);
ALTER TABLE stock_batches ADD COLUMN cost_source text NOT NULL DEFAULT 'legacy_estimate' CHECK(cost_source IN ('receipt','adjustment','legacy_estimate'));
UPDATE stock_batches b SET unit_cost=l.unit_cost,cost_source='receipt'
FROM goods_receipt_lines l WHERE l.id=b.receipt_line_id AND l.store_id=b.store_id;
UPDATE stock_batches b SET unit_cost=p.cost FROM products p
WHERE b.receipt_line_id IS NULL AND p.id=b.product_id AND p.store_id=b.store_id;
DROP INDEX stock_batches_unknown_product;
ALTER TABLE sale_items ADD COLUMN cost_total numeric(14,2) CHECK(cost_total>=0);
ALTER TABLE sale_batch_allocations ADD COLUMN unit_cost numeric(14,2) CHECK(unit_cost>=0);
ALTER TABLE sale_batch_allocations ADD COLUMN cost_total numeric(14,2) CHECK(cost_total>=0);
ALTER TABLE refund_lines ADD COLUMN restored_cost numeric(14,2) CHECK(restored_cost>=0);
-- Allocation rows and their immutable parent snapshots are inserted in the same transaction.
ALTER TABLE sale_batch_allocations ALTER CONSTRAINT sale_batch_allocations_sale_item_id_store_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE refund_batch_allocations ALTER CONSTRAINT refund_batch_allocations_refund_line_id_store_id_fkey DEFERRABLE INITIALLY DEFERRED;
CREATE OR REPLACE FUNCTION adjust_stock_batches(p_store uuid,p_product uuid,p_delta numeric) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE remaining numeric(15,3); batch record; taken numeric(15,3);
BEGIN
 IF p_delta>0 THEN
  INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source)
  SELECT p_store,p_product,p_delta,cost,'adjustment' FROM products WHERE id=p_product AND store_id=p_store;
  RETURN;
 END IF;
 remaining := -p_delta;
 FOR batch IN SELECT id,quantity FROM stock_batches WHERE store_id=p_store AND product_id=p_product AND quantity>0
 ORDER BY expiry_date ASC NULLS LAST,created_at,id FOR UPDATE LOOP
  EXIT WHEN remaining=0;
  taken := LEAST(remaining,batch.quantity);
  UPDATE stock_batches SET quantity=quantity-taken WHERE id=batch.id;
  remaining := remaining-taken;
 END LOOP;
 IF remaining>0 THEN RAISE EXCEPTION 'Batch stock is lower than product stock for %',p_product; END IF;
END $$;

-- Inflows without an explicit receipt cost use the catalog cost at the time of the inflow.
ALTER TABLE stock_batches ALTER COLUMN unit_cost DROP DEFAULT;
CREATE FUNCTION snapshot_stock_batch_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.unit_cost IS NULL THEN
  SELECT cost INTO NEW.unit_cost FROM products WHERE id=NEW.product_id AND store_id=NEW.store_id;
  NEW.cost_source := 'adjustment';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_batch_cost_snapshot BEFORE INSERT ON stock_batches FOR EACH ROW EXECUTE FUNCTION snapshot_stock_batch_cost();

CREATE FUNCTION protect_stock_batch_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost OR NEW.cost_source IS DISTINCT FROM OLD.cost_source THEN
  RAISE EXCEPTION 'Stock batch purchase costs are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_batch_cost_immutable BEFORE UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION protect_stock_batch_cost();
CREATE TRIGGER immutable_sale_batch_allocations BEFORE UPDATE OR DELETE ON sale_batch_allocations FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER immutable_refund_batch_allocations BEFORE UPDATE OR DELETE ON refund_batch_allocations FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
