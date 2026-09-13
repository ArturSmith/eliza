ALTER TABLE shopping_lists ADD COLUMN sections jsonb NOT NULL DEFAULT '[]';
ALTER TABLE shopping_list_lines ADD COLUMN section_id uuid;
