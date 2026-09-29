import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Database } from '../apps/api/dist/database.js';

const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_pricing_migration_${Date.now()}`;
const admin = new Database();
let db: Database, client: Database['pool'];
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const url = new URL(original);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL=url.toString();
  db=new Database();
  client=db.pool;
});
afterAll(async () => {
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL=original;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe('pricing V1 migration', () => {
  it('converts all-unit discounts into rules while retaining legacy label products', async () => {
    const dir = 'apps/api/migrations';
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && f < '0047_promotions_markdowns.sql')
      .sort())
      await client.query(readFileSync(`${dir}/${file}`, 'utf8'));
    const organization = (
      await client.query("INSERT INTO organizations(name) VALUES('Migration test') RETURNING id")
    ).rows[0].id;
    const store = (
      await client.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,'Store','NOK','Europe/Oslo') RETURNING id",
        [organization],
      )
    ).rows[0].id;
    await client.query("INSERT INTO roles(store_id,name,permissions) VALUES($1,'Owner','[]')", [
      store,
    ]);
    const parent = (
      await client.query(
        `INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock,stock,regular_price,price_kind)
       VALUES($1,'Yogurt','YOGURT','Dairy','piece',50,30,0,0,70,'discount_all') RETURNING id`,
        [store],
      )
    ).rows[0].id;
    const legacy = (
      await client.query(
        `INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock,stock,regular_price,price_kind,base_product_id)
       VALUES($1,'Yogurt','YOGURT-OLD','Dairy','piece',40,30,0,0,70,'limited_discount',$2) RETURNING id`,
        [store, parent],
      )
    ).rows[0].id;
    await client.query(readFileSync(`${dir}/0047_promotions_markdowns.sql`, 'utf8'));
    const rows = (
      await client.query(
        'SELECT id,price::text,regular_price::text,price_kind,category_id FROM products WHERE store_id=$1 ORDER BY sku',
        [store],
      )
    ).rows;
    expect(rows.find((r) => r.id === parent)).toMatchObject({
      price: '70.00',
      regular_price: null,
      price_kind: 'standard',
    });
    expect(rows.find((r) => r.id === legacy)).toMatchObject({
      price: '40.00',
      regular_price: '70.00',
      price_kind: 'limited_discount',
    });
    expect(rows[0].category_id).toBe(rows[1].category_id);
    const migrated = (
      await client.query(
        `SELECT r.discount_value::text,r.origin,pp.product_id FROM promotions r
       JOIN promotion_products pp ON pp.promotion_id=r.id WHERE r.store_id=$1`,
        [store],
      )
    ).rows;
    expect(migrated).toMatchObject([
      { discount_value: '50.00', origin: 'MIGRATION', product_id: parent },
    ]);
    const role = (
      await client.query("SELECT permissions FROM roles WHERE store_id=$1 AND name='Owner'", [
        store,
      ])
    ).rows[0];
    expect(role.permissions).toContain('promotions.manage');
    expect(role.permissions).toContain('markdowns.manage');
  });
});
