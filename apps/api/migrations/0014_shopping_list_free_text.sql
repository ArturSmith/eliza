ALTER TABLE shopping_list_lines ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE shopping_list_lines ADD COLUMN label text NOT NULL DEFAULT '';
ALTER TABLE shopping_list_lines ADD COLUMN position integer NOT NULL DEFAULT 0;
ALTER TABLE shopping_list_lines DROP CONSTRAINT shopping_list_lines_list_id_product_id_key;
CREATE UNIQUE INDEX shopping_list_lines_product ON shopping_list_lines(list_id,product_id) WHERE product_id IS NOT NULL;
ALTER TABLE shopping_list_lines ADD CONSTRAINT shopping_list_lines_kind CHECK((product_id IS NOT NULL) <> (label <> ''));
ALTER TABLE shopping_list_lines ADD CONSTRAINT shopping_list_lines_free_text_unplanned CHECK(product_id IS NOT NULL OR purchase_id IS NULL);
CREATE INDEX shopping_list_lines_order ON shopping_list_lines(list_id,position,id);
