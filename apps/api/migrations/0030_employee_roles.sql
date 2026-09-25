CREATE TABLE employee_roles (
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  PRIMARY KEY(employee_id,role_id),
  FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
  FOREIGN KEY(role_id,store_id) REFERENCES roles(id,store_id)
);
CREATE INDEX employee_roles_store_role_idx ON employee_roles(store_id,role_id);
INSERT INTO employee_roles(employee_id,role_id,store_id) SELECT id,role_id,store_id FROM employees;
INSERT INTO roles(store_id,name,permissions)
SELECT s.id,'General employee','[]'::jsonb FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.store_id=s.id AND r.name='General employee');
INSERT INTO employee_roles(employee_id,role_id,store_id)
SELECT e.id,r.id,e.store_id FROM employees e JOIN roles r ON r.store_id=e.store_id AND r.name='General employee'
WHERE e.price_tags_access ON CONFLICT DO NOTHING;
