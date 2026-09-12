ALTER TABLE products ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000);
