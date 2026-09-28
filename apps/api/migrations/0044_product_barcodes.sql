CREATE SEQUENCE internal_product_barcode_seq;

CREATE FUNCTION next_internal_product_barcode(p_store_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  weighted_sum integer;
BEGIN
  LOOP
    base := '04' || lpad(nextval('internal_product_barcode_seq')::text, 10, '0');
    IF length(base) <> 12 THEN
      RAISE EXCEPTION 'Internal barcode range exhausted';
    END IF;
    SELECT sum(substring(base from digit_index for 1)::integer *
               CASE WHEN digit_index % 2 = 0 THEN 3 ELSE 1 END)
      INTO weighted_sum FROM generate_series(1, 12) AS digits(digit_index);
    candidate := base || ((10 - weighted_sum % 10) % 10)::text;
    IF NOT EXISTS (SELECT 1 FROM barcodes WHERE store_id = p_store_id AND value = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  product record;
BEGIN
  FOR product IN
    SELECT p.id, p.store_id FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM barcodes b WHERE b.product_id = p.id)
    ORDER BY p.store_id, p.id
  LOOP
    INSERT INTO barcodes (store_id, product_id, value)
    VALUES (product.store_id, product.id, next_internal_product_barcode(product.store_id));
  END LOOP;
END;
$$;
