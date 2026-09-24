ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_id_store UNIQUE(id,store_id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_id_store UNIQUE(id,store_id);
ALTER TABLE refund_lines ADD CONSTRAINT refund_lines_id_store UNIQUE(id,store_id);
CREATE TABLE stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL,
  receipt_line_id uuid,
  expiry_date date,
  quantity numeric(15,3) NOT NULL CHECK (quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  UNIQUE(receipt_line_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
  FOREIGN KEY(receipt_line_id,store_id) REFERENCES goods_receipt_lines(id,store_id)
);
CREATE UNIQUE INDEX stock_batches_unknown_product ON stock_batches(store_id,product_id) WHERE receipt_line_id IS NULL AND expiry_date IS NULL;
CREATE INDEX stock_batches_fefo ON stock_batches(store_id,product_id,expiry_date,created_at) WHERE quantity > 0;
INSERT INTO stock_batches(store_id,product_id,quantity)
SELECT store_id,id,stock FROM products WHERE stock > 0;

CREATE FUNCTION adjust_stock_batches(p_store uuid,p_product uuid,p_delta numeric) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  remaining numeric(15,3);
  batch record;
  taken numeric(15,3);
BEGIN
  IF p_delta > 0 THEN
    INSERT INTO stock_batches(store_id,product_id,quantity) VALUES(p_store,p_product,p_delta)
    ON CONFLICT(store_id,product_id) WHERE receipt_line_id IS NULL AND expiry_date IS NULL
    DO UPDATE SET quantity=stock_batches.quantity+EXCLUDED.quantity;
    RETURN;
  END IF;
  remaining := -p_delta;
  FOR batch IN
    SELECT id,quantity FROM stock_batches
    WHERE store_id=p_store AND product_id=p_product AND quantity>0
    ORDER BY expiry_date ASC NULLS LAST,created_at,id FOR UPDATE
  LOOP
    EXIT WHEN remaining=0;
    taken := LEAST(remaining,batch.quantity);
    UPDATE stock_batches SET quantity=quantity-taken WHERE id=batch.id;
    remaining := remaining-taken;
  END LOOP;
  IF remaining>0 THEN
    RAISE EXCEPTION 'Batch stock is lower than product stock for %',p_product;
  END IF;
END $$;

CREATE TABLE sale_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  sale_item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0),
  UNIQUE(sale_item_id,batch_id),
  UNIQUE(id,store_id),
  FOREIGN KEY(sale_item_id,store_id) REFERENCES sale_items(id,store_id),
  FOREIGN KEY(batch_id,store_id) REFERENCES stock_batches(id,store_id)
);
CREATE TABLE refund_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  refund_line_id uuid NOT NULL,
  sale_batch_allocation_id uuid NOT NULL,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0),
  UNIQUE(refund_line_id,sale_batch_allocation_id),
  FOREIGN KEY(refund_line_id,store_id) REFERENCES refund_lines(id,store_id),
  FOREIGN KEY(sale_batch_allocation_id,store_id) REFERENCES sale_batch_allocations(id,store_id)
);
