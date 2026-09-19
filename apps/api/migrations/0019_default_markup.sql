-- Suggested VAT-inclusive selling price = purchase cost * (1 + markup / 100).
ALTER TABLE stores ADD COLUMN default_markup_percent numeric(6,2) NOT NULL DEFAULT 15
  CHECK(default_markup_percent BETWEEN 0 AND 1000);
