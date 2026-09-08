UPDATE roles SET permissions=permissions || '["counts.manage","counts.finalize"]'::jsonb WHERE name IN ('Owner','Manager');
CREATE TABLE stock_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores,
 name text NOT NULL,notes text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','counting','review','finalized','cancelled')),
 version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,device_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finalized_at timestamptz,finalized_by uuid,
 UNIQUE(id,store_id),FOREIGN KEY(created_by,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id),FOREIGN KEY(finalized_by,store_id) REFERENCES employees(id,store_id)
);
CREATE UNIQUE INDEX one_active_stock_count ON stock_counts(store_id) WHERE status IN ('draft','counting','review');
CREATE TABLE stock_count_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL, count_id uuid NOT NULL,product_id uuid NOT NULL,
 product_name text NOT NULL,sku text NOT NULL,unit text NOT NULL,system_quantity numeric(15,3),
 movement_count bigint,counted_quantity numeric(15,3) CHECK(counted_quantity>=0),counted_by uuid,counted_at timestamptz,
 UNIQUE(count_id,product_id),FOREIGN KEY(count_id,store_id) REFERENCES stock_counts(id,store_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id),FOREIGN KEY(counted_by,store_id) REFERENCES employees(id,store_id)
);
CREATE TABLE stock_count_commands (
 store_id uuid NOT NULL REFERENCES stores,request_id uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,request_id)
);
ALTER TABLE movements ADD COLUMN stock_count_id uuid;
ALTER TABLE movements ADD CONSTRAINT movement_count_store FOREIGN KEY(stock_count_id,store_id) REFERENCES stock_counts(id,store_id);
CREATE INDEX movements_product_history ON movements(product_id);
CREATE FUNCTION protect_stock_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('finalized','cancelled') THEN RAISE EXCEPTION 'Completed stock counts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_completed_count BEFORE UPDATE OR DELETE ON stock_counts FOR EACH ROW EXECUTE FUNCTION protect_stock_count();
CREATE FUNCTION protect_stock_count_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM stock_counts WHERE id=CASE WHEN TG_OP='INSERT' THEN NEW.count_id ELSE OLD.count_id END AND status IN ('finalized','cancelled')) THEN RAISE EXCEPTION 'Completed stock count lines are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_completed_count_lines BEFORE INSERT OR UPDATE OR DELETE ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION protect_stock_count_line();
CREATE TRIGGER immutable_count_commands BEFORE UPDATE OR DELETE ON stock_count_commands FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
