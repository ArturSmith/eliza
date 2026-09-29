-- Promotions change the checkout price without changing the product's base price.
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  UNIQUE(id,store_id),
  UNIQUE(store_id,name)
);
INSERT INTO categories(store_id,name)
SELECT DISTINCT store_id,category FROM products WHERE category<>'' ON CONFLICT DO NOTHING;
ALTER TABLE products ADD COLUMN category_id uuid;
UPDATE products p SET category_id=c.id FROM categories c
WHERE c.store_id=p.store_id AND c.name=p.category;
ALTER TABLE products ADD CONSTRAINT products_category_store_fk
  FOREIGN KEY(category_id,store_id) REFERENCES categories(id,store_id);
CREATE INDEX products_category_id_idx ON products(store_id,category_id);
CREATE FUNCTION sync_product_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS NOT NULL AND NEW.category<>'' AND
     (TG_OP='INSERT' OR NEW.category IS DISTINCT FROM OLD.category OR NEW.category_id IS NULL) THEN
    INSERT INTO categories(store_id,name) VALUES(NEW.store_id,NEW.category)
    ON CONFLICT(store_id,name) DO NOTHING;
    SELECT id INTO NEW.category_id FROM categories
    WHERE store_id=NEW.store_id AND name=NEW.category;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_sync_category BEFORE INSERT OR UPDATE OF category,category_id
ON products FOR EACH ROW EXECUTE FUNCTION sync_product_category();

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  origin text NOT NULL DEFAULT 'MANAGER' CHECK(origin IN ('MANAGER','PRODUCT_DISCOUNT','MIGRATION')),
  discount_type text NOT NULL CHECK(discount_type IN ('PERCENTAGE','FIXED_PRICE')),
  discount_value numeric(14,2) NOT NULL CHECK(discount_value>=0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  cancelled_at timestamptz,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  CHECK(ends_at IS NULL OR ends_at>starts_at),
  CHECK(discount_type<>'PERCENTAGE' OR discount_value<=100)
);
CREATE TABLE promotion_products (
  promotion_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  PRIMARY KEY(promotion_id,product_id),
  FOREIGN KEY(promotion_id,store_id) REFERENCES promotions(id,store_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id)
);
CREATE TABLE promotion_categories (
  promotion_id uuid NOT NULL,
  store_id uuid NOT NULL,
  category_id uuid NOT NULL,
  PRIMARY KEY(promotion_id,category_id),
  FOREIGN KEY(promotion_id,store_id) REFERENCES promotions(id,store_id),
  FOREIGN KEY(category_id,store_id) REFERENCES categories(id,store_id)
);
CREATE INDEX promotions_active_idx ON promotions(store_id,starts_at,ends_at)
WHERE enabled AND cancelled_at IS NULL;
CREATE INDEX promotion_products_target_idx ON promotion_products(store_id,product_id);
CREATE INDEX promotion_categories_target_idx ON promotion_categories(store_id,category_id);

-- One markdown unit is one physical piece. Its batch remains physical stock until sale.
CREATE TABLE markdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 500),
  reason text NOT NULL CHECK(reason IN ('EXPIRING_SOON','DAMAGED_PACKAGING','CLEARANCE','OVERSTOCK','OTHER')),
  base_unit_price numeric(14,2) NOT NULL,
  final_unit_price numeric(14,2) NOT NULL CHECK(final_unit_price>=0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
  CHECK(valid_until IS NULL OR valid_until>valid_from),
  CHECK(final_unit_price<base_unit_price)
);
CREATE TABLE markdown_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  markdown_id uuid NOT NULL,
  product_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  barcode text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','SOLD','CANCELLED')),
  printed_at timestamptz,
  sold_at timestamptz,
  sale_item_id uuid UNIQUE,
  cancelled_at timestamptz,
  replacement_for_id uuid REFERENCES markdown_units(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  FOREIGN KEY(markdown_id,store_id) REFERENCES markdowns(id,store_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
  FOREIGN KEY(batch_id,store_id) REFERENCES stock_batches(id,store_id)
);
CREATE INDEX markdown_units_reservation_idx ON markdown_units(store_id,batch_id)
WHERE status='AVAILABLE';
CREATE SEQUENCE markdown_barcode_seq;
CREATE FUNCTION next_markdown_barcode() RETURNS text LANGUAGE plpgsql AS $$
DECLARE base text; candidate text; weighted_sum integer;
BEGIN
  LOOP
    base := '05' || lpad(nextval('markdown_barcode_seq')::text,10,'0');
    IF length(base)<>12 THEN RAISE EXCEPTION 'Markdown barcode range exhausted'; END IF;
    SELECT sum(substring(base from digit_index for 1)::integer *
      CASE WHEN digit_index % 2=0 THEN 3 ELSE 1 END) INTO weighted_sum
      FROM generate_series(1,12) AS digits(digit_index);
    candidate := base || ((10-weighted_sum%10)%10)::text;
    IF NOT EXISTS(SELECT 1 FROM barcodes WHERE value=candidate) AND
       NOT EXISTS(SELECT 1 FROM markdown_units WHERE barcode=candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END $$;

ALTER TABLE sale_items ADD COLUMN base_unit_price numeric(14,2);
ALTER TABLE sale_items ADD COLUMN pricing_source text
  CHECK(pricing_source IN ('BASE','PRODUCT_PROMOTION','CATEGORY_PROMOTION','MARKDOWN','LEGACY_MARKDOWN'));
ALTER TABLE sale_items ADD COLUMN promotion_id uuid REFERENCES promotions(id);
ALTER TABLE sale_items ADD COLUMN markdown_unit_id uuid UNIQUE REFERENCES markdown_units(id);
ALTER TABLE sale_items ADD COLUMN discount_total numeric(14,2);
ALTER TABLE refund_lines ADD COLUMN sale_item_id uuid;
ALTER TABLE refund_lines ADD CONSTRAINT refund_lines_sale_item_store_fk
  FOREIGN KEY(sale_item_id,store_id) REFERENCES sale_items(id,store_id);
CREATE INDEX refund_lines_sale_item_idx ON refund_lines(sale_item_id) WHERE sale_item_id IS NOT NULL;
ALTER TABLE markdown_units ADD CONSTRAINT markdown_units_sale_item_fk
  FOREIGN KEY(sale_item_id) REFERENCES sale_items(id);

-- Existing all-unit discounts become product promotions in the same migration.
DO $$ DECLARE p record; promotion_uuid uuid; BEGIN
  FOR p IN SELECT id,store_id,name,price FROM products WHERE price_kind='discount_all' LOOP
    INSERT INTO promotions(store_id,name,origin,discount_type,discount_value)
    VALUES(p.store_id,'Migrated product discount: '||p.name,'MIGRATION','FIXED_PRICE',p.price)
    RETURNING id INTO promotion_uuid;
    INSERT INTO promotion_products(promotion_id,store_id,product_id)
    VALUES(promotion_uuid,p.store_id,p.id);
  END LOOP;
END $$;
ALTER TABLE products ADD COLUMN tag_last_printed_price numeric(14,2);
UPDATE products SET tag_last_printed_price=price WHERE tag_printed_version>=tag_price_version;
UPDATE products SET price=regular_price,regular_price=NULL,price_kind='standard'
WHERE price_kind='discount_all';
-- Backfill the new snapshot columns while the append-only history guard is
-- temporarily disabled. The migration runner wraps this in a transaction, so
-- a failed backfill also rolls back the trigger state.
ALTER TABLE sale_items DISABLE TRIGGER immutable_sale_items;
UPDATE sale_items i SET pricing_source=CASE WHEN p.price_kind='limited_discount'
  THEN 'LEGACY_MARKDOWN' ELSE NULL END,base_unit_price=i.price,discount_total=0
FROM products p WHERE p.id=i.product_id;
ALTER TABLE sale_items ENABLE TRIGGER immutable_sale_items;

UPDATE roles SET permissions=permissions || '["promotions.manage","markdowns.manage"]'::jsonb
WHERE name IN ('Owner','Manager')
  AND NOT permissions ? 'promotions.manage';

-- Stock corrections must not consume pieces already assigned to active labels.
CREATE OR REPLACE FUNCTION adjust_stock_batches(p_store uuid,p_product uuid,p_delta numeric) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE remaining numeric(15,3); batch record; free numeric(15,3); taken numeric(15,3);
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
  SELECT GREATEST(batch.quantity-count(*),0) INTO free FROM markdown_units u
  JOIN markdowns m ON m.id=u.markdown_id WHERE u.store_id=p_store AND u.batch_id=batch.id
    AND u.status='AVAILABLE' AND m.cancelled_at IS NULL
    AND (m.valid_until IS NULL OR m.valid_until>now());
  taken := LEAST(remaining,free);
  IF taken>0 THEN UPDATE stock_batches SET quantity=quantity-taken WHERE id=batch.id; END IF;
  remaining := remaining-taken;
 END LOOP;
 IF remaining>0 THEN RAISE EXCEPTION 'Not enough unreserved batch stock for %',p_product; END IF;
END $$;
