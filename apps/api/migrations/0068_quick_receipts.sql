CREATE TABLE quick_receipt_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
  FOREIGN KEY(created_by,store_id) REFERENCES employees(id,store_id),
  FOREIGN KEY(updated_by,store_id) REFERENCES employees(id,store_id)
);
CREATE INDEX quick_receipt_shortcuts_store ON quick_receipt_shortcuts(store_id,created_at);
ALTER TABLE purchases ADD COLUMN quick_receipt_shortcut_id uuid;
ALTER TABLE purchases ADD CONSTRAINT purchase_quick_receipt_store FOREIGN KEY(quick_receipt_shortcut_id,store_id) REFERENCES quick_receipt_shortcuts(id,store_id);
UPDATE roles SET permissions=permissions || '["purchases.quick_receive"]'::jsonb
WHERE permissions ? 'purchases.write' AND permissions ? 'purchases.receive' AND NOT permissions ? 'purchases.quick_receive';
INSERT INTO roles(store_id,name,permissions)
SELECT id,'Receiving clerk','["purchases.quick_receive"]'::jsonb FROM stores s
WHERE NOT EXISTS(SELECT 1 FROM roles r WHERE r.store_id=s.id AND r.name='Receiving clerk');
