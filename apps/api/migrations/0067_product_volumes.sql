ALTER TABLE products ADD COLUMN brand text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN volume text NOT NULL DEFAULT '';
UPDATE products SET brand=COALESCE(source->>'brand',''), volume=COALESCE(source->>'quantity','');
