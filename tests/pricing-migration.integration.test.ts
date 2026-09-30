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
  process.env.DATABASE_URL = url.toString();
  db = new Database();
  client = db.pool;
});
afterAll(async () => {
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = original;
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
    const roleId = (
      await client.query(
        "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Owner','[]') RETURNING id",
        [store],
      )
    ).rows[0].id;
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
    const employee = (
      await client.query(
        "INSERT INTO employees(store_id,role_id,name,email,password_hash,employee_code) VALUES($1,$2,'Owner','migration@test.local','hash','OWNER') RETURNING id",
        [store, roleId],
      )
    ).rows[0].id;
    const device = (
      await client.query(
        "INSERT INTO devices(store_id,name,token_hash) VALUES($1,'Register','token') RETURNING id",
        [store],
      )
    ).rows[0].id;
    const shift = (
      await client.query(
        "INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,0,gen_random_uuid(),'open') RETURNING id",
        [store, device, employee],
      )
    ).rows[0].id;
    const sale = (
      await client.query(
        "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt) VALUES($1,$2,$3,$4,gen_random_uuid(),'sale','MIGRATION-1',40,0,30,'{}') RETURNING id",
        [store, device, employee, shift],
      )
    ).rows[0].id;
    const historicalLine = (
      await client.query(
        'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total) VALUES($1,$2,$3,1,40,30,0,40) RETURNING id',
        [store, sale, legacy],
      )
    ).rows[0].id;
    await client.query(readFileSync(`${dir}/0047_promotions_markdowns.sql`, 'utf8'));
    expect(
      (
        await client.query(
          'SELECT price::text,total::text,pricing_source,base_unit_price::text,discount_total::text FROM sale_items WHERE id=$1',
          [historicalLine],
        )
      ).rows[0],
    ).toMatchObject({
      price: '40.00',
      total: '40.00',
      pricing_source: 'LEGACY_MARKDOWN',
      base_unit_price: '40.00',
      discount_total: '0.00',
    });
    await expect(
      client.query('UPDATE sale_items SET price=41 WHERE id=$1', [historicalLine]),
    ).rejects.toThrow('History is append-only');
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
    const markdown = (
      await client.query(
        `INSERT INTO markdowns(store_id,product_id,quantity,reason,base_unit_price,final_unit_price)
         VALUES($1,$2,1,'EXPIRING_SOON',60,50) RETURNING id`,
        [store, parent],
      )
    ).rows[0].id;
    await client.query(readFileSync(`${dir}/0048_markdown_regular_price.sql`, 'utf8'));
    expect(
      (
        await client.query(
          'SELECT base_unit_price::text,original_unit_price::text FROM markdowns WHERE id=$1',
          [markdown],
        )
      ).rows[0],
    ).toMatchObject({ base_unit_price: '60.00', original_unit_price: '70.00' });
    expect(
      (
        await client.query('SELECT price::text,total::text FROM sale_items WHERE id=$1', [
          historicalLine,
        ])
      ).rows[0],
    ).toMatchObject({ price: '40.00', total: '40.00' });
  });
});
