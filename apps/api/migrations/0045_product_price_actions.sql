-- A limited markdown is a separately labelled stock item. Its own product and
-- stock batch keep checkout, refunds and historical cost allocation unchanged.
ALTER TABLE products ADD COLUMN base_product_id uuid;
ALTER TABLE products ADD COLUMN regular_price numeric(14,2) CHECK (regular_price IS NULL OR regular_price >= 0);
ALTER TABLE products ADD COLUMN price_kind text NOT NULL DEFAULT 'standard'
  CHECK (price_kind IN ('standard','discount_all','limited_discount'));
ALTER TABLE products ADD CONSTRAINT products_base_product_store_fk
  FOREIGN KEY (base_product_id,store_id) REFERENCES products(id,store_id);
ALTER TABLE products ADD CONSTRAINT products_price_state_check CHECK (
  (price_kind='standard' AND regular_price IS NULL AND base_product_id IS NULL)
  OR (price_kind='discount_all' AND regular_price IS NOT NULL AND base_product_id IS NULL AND price<regular_price)
  OR (price_kind='limited_discount' AND regular_price IS NOT NULL AND base_product_id IS NOT NULL AND price<regular_price)
);
ALTER TABLE stock_batches ADD COLUMN origin_batch_id uuid REFERENCES stock_batches(id);
CREATE INDEX products_base_product_id_idx ON products(base_product_id) WHERE base_product_id IS NOT NULL;
CREATE TABLE price_action_requests (
  store_id uuid NOT NULL REFERENCES stores(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,request_id)
);

-- A tag must also change when a discount badge is added or removed at the same price.
CREATE OR REPLACE FUNCTION track_tag_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.price IS DISTINCT FROM OLD.price
    OR NEW.regular_price IS DISTINCT FROM OLD.regular_price
    OR NEW.price_kind IS DISTINCT FROM OLD.price_kind THEN
  NEW.tag_price_version := OLD.tag_price_version + 1;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER products_tag_price_change ON products;
CREATE TRIGGER products_tag_price_change BEFORE UPDATE OF price,regular_price,price_kind ON products
FOR EACH ROW EXECUTE FUNCTION track_tag_price_change();
