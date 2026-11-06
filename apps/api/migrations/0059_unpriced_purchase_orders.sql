-- Product/quantity orders precede invoices. Actual receipt and batch costs remain required.
-- Existing orders, receipts, batches and immutable sale records are left untouched.
ALTER TABLE purchases
  ALTER COLUMN subtotal DROP NOT NULL,
  ALTER COLUMN tax DROP NOT NULL,
  ALTER COLUMN total DROP NOT NULL;
ALTER TABLE purchase_lines
  ALTER COLUMN unit_cost DROP NOT NULL,
  ALTER COLUMN subtotal DROP NOT NULL,
  ALTER COLUMN tax DROP NOT NULL,
  ALTER COLUMN total DROP NOT NULL;
ALTER TABLE purchase_lines ADD CONSTRAINT purchase_line_cost_completeness CHECK (
  (unit_cost IS NULL AND subtotal IS NULL AND tax IS NULL AND total IS NULL) OR
  (unit_cost IS NOT NULL AND subtotal IS NOT NULL AND tax IS NOT NULL AND total IS NOT NULL)
);
ALTER TABLE purchases ADD CONSTRAINT purchase_total_completeness CHECK (
  (subtotal IS NULL AND tax IS NULL AND total IS NULL) OR
  (subtotal IS NOT NULL AND tax IS NOT NULL AND total IS NOT NULL)
);
