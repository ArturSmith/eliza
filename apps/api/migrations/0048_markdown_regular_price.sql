ALTER TABLE markdowns ADD COLUMN original_unit_price numeric(14,2);

-- Older markdowns did not snapshot the undiscounted product price. Use the
-- current base price as the best available value without altering past sales.
UPDATE markdowns m SET original_unit_price=p.price
FROM products p WHERE p.id=m.product_id AND p.store_id=m.store_id;

ALTER TABLE markdowns ALTER COLUMN original_unit_price SET NOT NULL;
