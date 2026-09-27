ALTER TABLE suppliers ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(tags)='array');
