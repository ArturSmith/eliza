ALTER TABLE products
  ADD COLUMN images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE products ADD CONSTRAINT product_gallery_array
  CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 6);

-- Preserve existing photos and the legacy image column used by checkout and devices.
UPDATE products SET images = jsonb_build_array(image) WHERE image <> '';
