ALTER TABLE scanner_link_scans DROP CONSTRAINT scanner_link_scans_barcode_check;
ALTER TABLE scanner_link_scans ADD CONSTRAINT scanner_link_scans_barcode_check
  CHECK (length(barcode) BETWEEN 1 AND 4096);
