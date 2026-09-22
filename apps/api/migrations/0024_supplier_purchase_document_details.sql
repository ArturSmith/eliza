-- Supplier identity and its sales contact belong to the supplier record.
ALTER TABLE suppliers ADD COLUMN contact_phone text NOT NULL DEFAULT '';

-- These details describe one supplier document and can differ on every purchase.
ALTER TABLE purchases
  ADD COLUMN buyer_name text NOT NULL DEFAULT '',
  ADD COLUMN buyer_details text NOT NULL DEFAULT '',
  ADD COLUMN driver_name text NOT NULL DEFAULT '',
  ADD COLUMN driver_phone text NOT NULL DEFAULT '',
  ADD COLUMN goods_number text NOT NULL DEFAULT '',
  ADD COLUMN buyer_tax_number text NOT NULL DEFAULT '',
  ADD COLUMN gross_weight text NOT NULL DEFAULT '',
  ADD COLUMN document_vat text NOT NULL DEFAULT '',
  ADD COLUMN return_amount text NOT NULL DEFAULT '',
  ADD COLUMN document_comment text NOT NULL DEFAULT '';
