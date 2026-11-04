-- A supplier can carry a product before a quotation is known.
-- NULL is an unknown quote; zero remains a genuine zero price.
ALTER TABLE supplier_products ALTER COLUMN pack_cost DROP NOT NULL;
