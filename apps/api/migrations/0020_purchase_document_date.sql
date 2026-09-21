-- Date printed on the supplier document, separate from expected delivery.
ALTER TABLE purchases ADD COLUMN document_date date;
