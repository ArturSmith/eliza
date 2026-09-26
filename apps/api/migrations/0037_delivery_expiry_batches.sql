-- A receipt line keeps one financial total but may create several expiry batches.
ALTER TABLE stock_batches DROP CONSTRAINT stock_batches_receipt_line_id_key;
CREATE INDEX stock_batches_receipt_line ON stock_batches(receipt_line_id) WHERE receipt_line_id IS NOT NULL;
ALTER TABLE goods_receipt_lines ADD COLUMN expiry_batches jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Existing receipt rows remain append-only; readers interpret [] using the original quantity/date.
