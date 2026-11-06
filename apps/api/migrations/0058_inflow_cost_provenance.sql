-- Unknown acquisition costs are NULL, never a fabricated zero.
ALTER TABLE stock_batches ALTER COLUMN unit_cost DROP NOT NULL;
ALTER TABLE sale_items ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE stock_batches DROP CONSTRAINT stock_batches_cost_source_check;
ALTER TABLE stock_batches ADD CONSTRAINT stock_batches_cost_source_check
 CHECK(cost_source IN ('receipt','adjustment','legacy_estimate','unknown'));
ALTER TABLE stock_batches ADD CONSTRAINT stock_batches_unknown_cost_check
 CHECK ((unit_cost IS NULL) = (cost_source='unknown'));
-- Manual receipts can identify their supplier without manufacturing a purchase order.
ALTER TABLE stock_batches ADD COLUMN supplier_id uuid;
ALTER TABLE stock_batches ADD FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id);
ALTER TABLE movements ADD COLUMN supplier_id uuid;
ALTER TABLE movements ADD FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id);
CREATE OR REPLACE FUNCTION snapshot_stock_batch_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.cost_source='unknown' THEN
  NEW.unit_cost := NULL;
 ELSIF NEW.unit_cost IS NULL THEN
  SELECT cost INTO NEW.unit_cost FROM products WHERE id=NEW.product_id AND store_id=NEW.store_id;
  NEW.cost_source := CASE WHEN NEW.unit_cost IS NULL THEN 'unknown' ELSE 'adjustment' END;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION consume_adjustment_batches_costed(p_store uuid,p_product uuid,p_quantity numeric)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE remaining numeric(15,3) := p_quantity;
        batch record;
        taken numeric(15,3);
        available numeric(15,3);
        cost numeric(14,2) := 0;
        reliable boolean := true;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  FOR batch IN
    SELECT b.id,b.quantity,b.unit_cost,b.cost_source,
      COALESCE((SELECT count(*) FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
        WHERE u.store_id=b.store_id AND u.batch_id=b.id AND u.status='AVAILABLE'
          AND m.cancelled_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>now())),0) AS reserved
    FROM stock_batches b WHERE b.store_id=p_store AND b.product_id=p_product AND b.quantity>0
    ORDER BY b.expiry_date ASC NULLS LAST,b.created_at,b.id FOR UPDATE OF b
  LOOP
    EXIT WHEN remaining=0;
    available := batch.quantity-batch.reserved;
    IF available<=0 THEN CONTINUE; END IF;
    taken := LEAST(remaining,available);
    UPDATE stock_batches SET quantity=quantity-taken WHERE id=batch.id;
    cost := cost+round(batch.unit_cost*taken,2);
    IF batch.unit_cost IS NULL OR batch.cost_source='legacy_estimate' THEN reliable := false; END IF;
    remaining := remaining-taken;
  END LOOP;
  IF remaining>0 THEN RAISE EXCEPTION 'Batch stock is lower than available product stock'; END IF;
  IF reliable THEN RETURN cost; END IF;
  RETURN NULL;
END $$;
