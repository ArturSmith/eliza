-- Preserve the valuation of future inventory losses without fabricating historical values.
ALTER TABLE movements ADD COLUMN cost_total numeric(14,2) CHECK (cost_total >= 0);
ALTER TABLE refund_lines ADD COLUMN loss_cost numeric(14,2) CHECK (loss_cost >= 0);

-- Existing expenses remain one-time expenses on their recorded expense_date.
-- Payment timing for those historical rows is unknown.
ALTER TABLE expenses ADD COLUMN payment_date date;
ALTER TABLE expenses ADD COLUMN allocation_method text NOT NULL DEFAULT 'ONE_TIME'
  CHECK (allocation_method IN ('ONE_TIME','EVEN_OVER_PERIOD'));
ALTER TABLE expenses ADD COLUMN period_start date;
ALTER TABLE expenses ADD COLUMN period_end date;
ALTER TABLE expenses ADD CONSTRAINT expenses_allocation_period CHECK (
  (allocation_method = 'ONE_TIME' AND period_start IS NULL AND period_end IS NULL)
  OR (allocation_method = 'EVEN_OVER_PERIOD' AND period_start IS NOT NULL
      AND period_end IS NOT NULL AND period_end >= period_start)
);
CREATE INDEX expenses_period_overlap ON expenses(store_id,period_start,period_end)
  WHERE allocation_method = 'EVEN_OVER_PERIOD';

-- Same FEFO cost-layer order as POS. The caller holds the product lock.
-- Legacy-estimated layers remain unknown for financial reporting.
CREATE FUNCTION consume_adjustment_batches_costed(p_store uuid,p_product uuid,p_quantity numeric)
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
    IF batch.cost_source='legacy_estimate' THEN reliable := false; END IF;
    remaining := remaining-taken;
  END LOOP;
  IF remaining>0 THEN RAISE EXCEPTION 'Batch stock is lower than available product stock'; END IF;
  IF reliable THEN RETURN cost; END IF;
  RETURN NULL;
END $$;
