CREATE TABLE expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 expense_date date NOT NULL,
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 200),
 category text NOT NULL CHECK(length(category) BETWEEN 1 AND 100),
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','card','bank','other')),
 payee text NOT NULL DEFAULT '',
 reference text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_store_date ON expenses(store_id,expense_date DESC,created_at DESC);
UPDATE roles SET permissions=permissions || '["expenses.read","expenses.manage"]'::jsonb WHERE name IN ('Owner','Manager');
