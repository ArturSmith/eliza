ALTER TABLE scanned_documents DROP CONSTRAINT scanned_documents_status_check;
ALTER TABLE scanned_documents ALTER COLUMN status SET DEFAULT 'draft';
UPDATE scanned_documents SET status='saved' WHERE status='completed';
ALTER TABLE scanned_documents ADD CONSTRAINT scanned_documents_status_check CHECK (status IN ('draft','saved'));
