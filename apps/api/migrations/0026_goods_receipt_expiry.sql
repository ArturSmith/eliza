ALTER TABLE goods_receipt_lines ADD COLUMN expiry_date date;
CREATE INDEX goods_receipt_lines_store_expiry ON goods_receipt_lines(store_id, expiry_date) WHERE expiry_date IS NOT NULL;
