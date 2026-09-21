CREATE TABLE scanned_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores,
  created_by uuid NOT NULL,
  device_id uuid NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  original_file bytea NOT NULL,
  extracted jsonb NOT NULL,
  edited jsonb NOT NULL,
  validation jsonb NOT NULL,
  document_type text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  FOREIGN KEY(created_by,store_id) REFERENCES employees(id,store_id),
  FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id)
);
CREATE INDEX scanned_documents_store_date ON scanned_documents(store_id,created_at DESC);
