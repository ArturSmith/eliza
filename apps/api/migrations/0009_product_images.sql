ALTER TABLE products ADD COLUMN image text NOT NULL DEFAULT '' CHECK (length(image) <= 60000);
