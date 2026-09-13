CREATE TABLE shopping_lists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id),
 name text NOT NULL, notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,store_id)
);
CREATE TABLE reorder_preferences (
 product_id uuid PRIMARY KEY, store_id uuid NOT NULL, target_stock numeric(15,3) NOT NULL CHECK(target_stock>=0),
 supplier_id uuid, FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
 FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id)
);
CREATE TABLE shopping_list_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL, list_id uuid NOT NULL,
 product_id uuid NOT NULL, target_stock numeric(15,3) NOT NULL CHECK(target_stock>=0),
 quantity numeric(15,3) NOT NULL CHECK(quantity>=0), unit_cost numeric(14,2) NOT NULL CHECK(unit_cost>=0),
 tax_rate numeric(5,2) NOT NULL CHECK(tax_rate>=0 AND tax_rate<=100),
 supplier_id uuid, notes text NOT NULL DEFAULT '', purchase_id uuid,
 UNIQUE(list_id,product_id),
 FOREIGN KEY(list_id,store_id) REFERENCES shopping_lists(id,store_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),
 FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id),
 FOREIGN KEY(purchase_id,store_id) REFERENCES purchases(id,store_id)
);
CREATE INDEX shopping_lists_store ON shopping_lists(store_id,created_at DESC);
