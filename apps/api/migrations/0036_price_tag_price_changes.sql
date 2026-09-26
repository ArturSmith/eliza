ALTER TABLE products ADD COLUMN tag_price_version integer NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN tag_printed_version integer NOT NULL DEFAULT 0;
ALTER TABLE price_tag_prints ADD COLUMN completed_at timestamptz;

-- Recover pending changes where an earlier printed price is known.
UPDATE products p SET tag_price_version=1 WHERE (
 SELECT (item->>'price')::numeric FROM price_tag_prints job
 CROSS JOIN LATERAL jsonb_array_elements(job.products) item
 WHERE job.store_id=p.store_id AND item->>'id'=p.id::text
 ORDER BY job.created_at DESC LIMIT 1
) IS DISTINCT FROM p.price AND EXISTS (
 SELECT 1 FROM price_tag_prints job CROSS JOIN LATERAL jsonb_array_elements(job.products) item
 WHERE job.store_id=p.store_id AND item->>'id'=p.id::text
);

CREATE FUNCTION track_tag_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.price IS DISTINCT FROM OLD.price THEN
  NEW.tag_price_version := OLD.tag_price_version + 1;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER products_tag_price_change BEFORE UPDATE OF price ON products
FOR EACH ROW EXECUTE FUNCTION track_tag_price_change();
