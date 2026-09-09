ALTER TABLE stores ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN business_number text NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN receipt_footer text NOT NULL DEFAULT 'Thank you for shopping with us.';
ALTER TABLE stores ADD COLUMN default_tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(default_tax_rate BETWEEN 0 AND 100);
ALTER TABLE stores ADD COLUMN settings_version integer NOT NULL DEFAULT 1;
