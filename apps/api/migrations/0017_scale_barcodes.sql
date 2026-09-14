ALTER TABLE stores ADD COLUMN scale_barcode jsonb NOT NULL DEFAULT '{"enabled":false,"prefix":"20","productDigits":5,"mode":"weight","decimals":3}';
