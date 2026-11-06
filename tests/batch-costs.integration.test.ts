import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_batch_cost_test_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(url + '/api' + path, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return { status: res.status, body: await res.json() };
  }
}
const manager = new Client(),
  register = new Client(),
  second = new Client();
let cashierId: string,
  ownerId: string,
  cashierRole: string,
  ownerRole: string,
  productId: string,
  weightedId: string,
  shiftId: string,
  receiptId: string,
  deviceId: string;
const account = {
  storeName: 'Checkout test',
  ownerName: 'Owner',
  email: 'owner@pos.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const product = {
  name: 'Milk',
  sku: 'MILK',
  category: 'Dairy',
  unit: 'piece',
  price: '115.00',
  cost: '50.00',
  taxRate: '15',
  minStock: '2',
  plu: '101',
  barcodes: ['709100'],
};
function sale(overrides: Record<string, unknown> = {}) {
  return {
    requestId: crypto.randomUUID(),
    shiftId,
    lines: [{ productId, quantity: '1', expectedPrice: '115.00', expectedTaxRate: '15' }],
    discountPercent: '0',
    payment: { method: 'cash', tendered: '120.00' },
    ...overrides,
  };
}
async function unlock(client = register, employeeCode = 'ANNA', pin = '123456') {
  return client.request('/pos/login', { employeeCode, pin });
}
async function enroll(client: Client, label: string) {
  await client.request('/auth/login', { email: account.email, password: account.password });
  const result = await client.request('/pos/enroll', { name: label });
  expect(result.status).toBe(201);
  return result.body.id;
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(original);
  parsed.pathname = `/${name}`;
  process.env.DATABASE_URL = parsed.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = original;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});

let supplierId: string;
const today = () => new Date().toISOString().slice(0, 10);
async function receive(productId: string, quantity: string, unitCost: string, expiryDate: string) {
  const draft = await manager.request('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId,
    lines: [{ productId, quantity, unitCost, taxRate: '0' }],
  });
  expect(draft.status).toBe(201);
  const placed = await manager.request('/purchases/' + draft.body.id + '/status', {
    requestId: crypto.randomUUID(),
    version: draft.body.version,
    status: 'ordered',
  });
  expect(placed.status).toBe(201);
  const received = await manager.request('/purchases/' + draft.body.id + '/receipts', {
    requestId: crypto.randomUUID(),
    version: placed.body.version,
    lines: [{ purchaseLineId: placed.body.lines[0].id, quantity, expiryDate }],
  });
  expect(received.status).toBe(201);
}
async function refund(quantity: string, restock: boolean) {
  const response = await register.request('/pos/refunds', {
    requestId: crypto.randomUUID(),
    saleId: receiptId,
    reason: 'Return',
    method: 'cash',
    confirmed: true,
    lines: [{ productId, quantity, restock }],
    approval: { employeeCode: 'OWNER', pin: '654321' },
  });
  expect(response.status).toBe(201);
  return (
    await db.pool.query('SELECT restored_cost FROM refund_lines WHERE refund_id=$1', [
      response.body.id,
    ])
  ).rows[0].restored_cost;
}
describe.sequential('batch purchase costs', () => {
  it('receives separate costs for the same product and values stock at their actual costs', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const session = (await manager.request('/auth/session')).body;
    await manager.request(
      '/team/' + session.user.id,
      {
        name: 'Owner',
        employeeCode: 'OWNER',
        roleId: (await manager.request('/team/roles')).body.find((r: any) => r.name === 'Owner').id,
        active: true,
        pin: '654321',
      },
      'PATCH',
    );
    const roles = (await manager.request('/team/roles')).body;
    await manager.request('/team', {
      name: 'Anna',
      employeeCode: 'ANNA',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '123456',
    });
    await enroll(register, 'Refund register');
    expect((await unlock(register)).status).toBe(200);
    shiftId = (
      await register.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '100' })
    ).body.id;

    supplierId = (
      await manager.request('/suppliers', {
        requestId: crypto.randomUUID(),
        code: 'COLA',
        name: 'Cola supplier',
      })
    ).body.id;
    productId = (
      await manager.request('/products', {
        ...product,
        name: 'Cola',
        sku: 'COLA',
        price: '2.00',
        cost: '9.00',
        taxRate: '0',
        barcodes: [],
        plu: '',
      })
    ).body.id;
    await receive(productId, '10', '1.00', '2030-01-01');
    await receive(productId, '10', '1.20', '2030-02-01');
    const batches = (await manager.request('/inventory/products/' + productId + '/batches')).body
      .batches;
    expect(batches.map((b: any) => [b.quantity, b.unitCost, b.costSource])).toEqual([
      ['10.000', '1.00', 'receipt'],
      ['10.000', '1.20', 'receipt'],
    ]);
    expect(
      (await manager.request('/products')).body.find((p: any) => p.id === productId),
    ).toMatchObject({ cost: '1.20', stockValue: '22.00' });
    await db.pool.query('UPDATE products SET cost=99 WHERE id=$1', [productId]);
    expect(
      (await manager.request('/products')).body.find((p: any) => p.id === productId).stockValue,
    ).toBe('22.00');
  });
  it('uses the exact cost of both consumed batches and keeps it out of cashier responses', async () => {
    const response = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId, quantity: '12', expectedPrice: '2.00', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '24.00' },
      }),
    );
    expect(response.status).toBe(201);
    receiptId = response.body.id;
    const costs = (
      await db.pool.query('SELECT cost_total FROM sale_items WHERE sale_id=$1', [receiptId])
    ).rows;
    expect(costs[0].cost_total).toBe('12.40');
    expect(JSON.stringify(response.body)).not.toContain('costTotal');
    const report = (
      await manager.request(
        `/reports/gross-profit?from=${today()}&to=${today()}&productId=${productId}`,
      )
    ).body;
    expect(report).toMatchObject({ soldCost: '12.40', grossProfit: '11.60' });
    expect(
      (await manager.request('/products')).body.find((p: any) => p.id === productId).stockValue,
    ).toBe('9.60');
  });
  it('restores the original costs on partial refunds, including non-restocked returns', async () => {
    expect(await refund('9', true)).toBe('9.00');
    expect(await refund('1', false)).toBe('1.00');
    expect(await refund('2', true)).toBe('2.40');
    const batches = (await manager.request('/inventory/products/' + productId + '/batches')).body
      .batches;
    expect(batches.map((b: any) => [b.quantity, b.unitCost])).toEqual([
      ['9.000', '1.00'],
      ['10.000', '1.20'],
    ]);
    const report = (
      await manager.request(
        `/reports/gross-profit?from=${today()}&to=${today()}&productId=${productId}`,
      )
    ).body;
    expect(report).toMatchObject({
      soldCost: '12.40',
      restoredCost: '12.40',
      costOfGoodsSold: '0.00',
      grossProfit: '0.00',
    });
  });
  it('uses FEFO costs even when the earlier expiry belongs to a newer, more expensive receipt', async () => {
    const id = (
      await manager.request('/products', {
        ...product,
        name: 'FEFO',
        sku: 'FEFO',
        price: '2.00',
        taxRate: '0',
        barcodes: [],
        plu: '',
      })
    ).body.id;
    await receive(id, '2', '1.00', '2030-02-01');
    await receive(id, '2', '1.20', '2030-01-01');
    const response = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: id, quantity: '1', expectedPrice: '2.00', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '2.00' },
      }),
    );
    expect(response.status).toBe(201);
    expect(
      (
        await db.pool.query('SELECT cost_total FROM sale_items WHERE sale_id=$1', [
          response.body.id,
        ])
      ).rows[0].cost_total,
    ).toBe('1.20');
  });
  it('conserves cents across fractional refunds and preserves costs through catalog edits', async () => {
    productId = (
      await manager.request('/products', {
        ...product,
        name: 'Weighted',
        sku: 'WEIGHTED-COST',
        unit: 'kilogram',
        price: '2.00',
        taxRate: '0',
        barcodes: [],
        plu: '',
      })
    ).body.id;
    await receive(productId, '1', '0.05', '2030-01-01');
    const response = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId, quantity: '0.333', expectedPrice: '2.00', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '1.00' },
      }),
    );
    expect(response.status).toBe(201);
    receiptId = response.body.id;
    expect(
      (await db.pool.query('SELECT cost_total FROM sale_items WHERE sale_id=$1', [receiptId]))
        .rows[0].cost_total,
    ).toBe('0.02');
    await db.pool.query('UPDATE products SET cost=99 WHERE id=$1', [productId]);
    expect(await refund('0.111', true)).toBe('0.01');
    expect(await refund('0.111', true)).toBe('0.00');
    expect(await refund('0.111', true)).toBe('0.01');
    expect(
      (await manager.request('/inventory/products/' + productId + '/batches')).body.batches[0],
    ).toMatchObject({ quantity: '1.000', unitCost: '0.05' });
  });
  it('values 250 units from three purchases at 315 and never reprices an earlier sale', async () => {
    const created = await manager.request('/products', {
      name: 'Three cost Cola',
      sku: 'THREE-COST',
      category: 'Drinks',
      unit: 'piece',
      price: '2',
      minStock: '0',
      barcodes: [],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const expiry = '2099-12-31';
    await receive(id, '100', '1.00', expiry);
    await receive(id, '100', '1.50', expiry);
    await receive(id, '50', '1.30', expiry);
    const summary = (await manager.request('/products')).body.find((p: any) => p.id === id);
    expect(summary).toMatchObject({
      stock: '250.000',
      averageCost: '1.26',
      stockValue: '315.00',
      lastPurchaseCost: '1.30',
    });
    const sold = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: id, quantity: '120', expectedPrice: '2', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '240' },
      }),
    );
    expect(sold.status).toBe(201);
    const before = (
      await db.pool.query('SELECT cost_total::text,cost::text FROM sale_items WHERE sale_id=$1', [
        sold.body.id,
      ])
    ).rows;
    expect(before[0].cost_total).toBe('130.00');
    await receive(id, '10', '10.00', expiry);
    expect(
      (
        await db.pool.query('SELECT cost_total::text,cost::text FROM sale_items WHERE sale_id=$1', [
          sold.body.id,
        ])
      ).rows,
    ).toEqual(before);
    const report = (
      await manager.request(`/reports/gross-profit?from=${today()}&to=${today()}&productId=${id}`)
    ).body;
    expect(report).toMatchObject({ soldCost: '130.00', grossProfit: '110.00' });
  });

  it('keeps unknown opening costs distinct from free stock through sale, refund and losses', async () => {
    const created = await manager.request('/products', {
      name: 'Unknown opening stock',
      sku: 'UNKNOWN-OPENING',
      category: 'Dairy',
      unit: 'piece',
      price: '10',
      minStock: '0',
      barcodes: [],
    });
    const id = created.body.id;
    const added = await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: id,
      quantity: '4',
      reason: 'opening_balance',
      unitCost: null,
    });
    expect(added.status).toBe(201);
    const batches = (await manager.request(`/inventory/products/${id}/batches`)).body.batches;
    expect(batches[0]).toMatchObject({ quantity: '4.000', unitCost: null, costSource: 'unknown' });
    expect((await manager.request('/products')).body.find((p: any) => p.id === id)).toMatchObject({
      stock: '4.000',
      averageCost: null,
      stockValue: null,
      unknownCostQuantity: '4.000',
    });
    const sold = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: id, quantity: '2', expectedPrice: '10', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '20' },
      }),
    );
    expect(sold.status).toBe(201);
    expect(
      (
        await db.pool.query('SELECT cost,cost_total FROM sale_items WHERE sale_id=$1', [
          sold.body.id,
        ])
      ).rows[0],
    ).toMatchObject({ cost: null, cost_total: null });
    const report = (
      await manager.request(`/reports/gross-profit?from=${today()}&to=${today()}&productId=${id}`)
    ).body;
    expect(report).toMatchObject({
      netRevenue: '20.00',
      soldCost: null,
      grossProfit: null,
      costOfGoodsSold: null,
    });
    const returned = await register.request(`/pos/refunds`, {
      saleId: sold.body.id,
      requestId: crypto.randomUUID(),
      shiftId,
      reason: 'Return',
      method: 'cash',
      confirmed: true,
      lines: [{ productId: id, quantity: '1', restock: true }],
      approval: { employeeCode: 'OWNER', pin: '654321' },
    });
    expect(returned.status).toBe(201);
    expect(
      (
        await db.pool.query('SELECT restored_cost FROM refund_lines WHERE refund_id=$1', [
          returned.body.id,
        ])
      ).rows[0].restored_cost,
    ).toBeNull();
    expect(
      (await manager.request(`/inventory/products/${id}/batches`)).body.batches[0],
    ).toMatchObject({ quantity: '3.000', unitCost: null });
    const loss = await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: id,
      quantity: '-1',
      reason: 'damaged',
    });
    expect(loss.status).toBe(201);
    expect(loss.body.costTotal).toBeNull();
    expect(
      (
        await manager.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: id,
          quantity: '1',
          reason: 'other',
          unitCost: '2',
        })
      ).status,
    ).toBe(201);
    const mixedSale = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: id, quantity: '3', expectedPrice: '10', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '30' },
      }),
    );
    expect(mixedSale.status).toBe(201);
    expect(
      (
        await db.pool.query('SELECT cost_total FROM sale_items WHERE sale_id=$1', [
          mixedSale.body.id,
        ])
      ).rows[0].cost_total,
    ).toBeNull();
    const allocations = (
      await db.pool.query(
        'SELECT a.unit_cost,a.cost_total FROM sale_batch_allocations a JOIN sale_items i ON i.id=a.sale_item_id WHERE i.sale_id=$1 ORDER BY a.unit_cost NULLS FIRST',
        [mixedSale.body.id],
      )
    ).rows;
    expect(allocations).toEqual([
      { unit_cost: null, cost_total: null },
      { unit_cost: '2.00', cost_total: '2.00' },
    ]);
    const free = (
      await manager.request('/products', {
        name: 'Free stock',
        sku: 'GENUINELY-FREE',
        category: 'Dairy',
        unit: 'piece',
        price: '10',
        minStock: '0',
        barcodes: [],
      })
    ).body;
    expect(
      (
        await manager.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: free.id,
          quantity: '1',
          reason: 'opening_balance',
          unitCost: '0',
        })
      ).status,
    ).toBe(201);
    expect(
      (await manager.request('/products')).body.find((p: any) => p.id === free.id),
    ).toMatchObject({ averageCost: '0.00', stockValue: '0.00', unknownCostQuantity: '0' });
    const freeSale = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: free.id, quantity: '1', expectedPrice: '10', expectedTaxRate: '0' }],
        payment: { method: 'cash', tendered: '10' },
      }),
    );
    expect(freeSale.status).toBe(201);
    expect(
      (
        await db.pool.query('SELECT cost_total FROM sale_items WHERE sale_id=$1', [
          freeSale.body.id,
        ])
      ).rows[0].cost_total,
    ).toBe('0.00');
    expect(
      (
        await manager.request(
          `/reports/gross-profit?from=${today()}&to=${today()}&productId=${free.id}`,
        )
      ).body,
    ).toMatchObject({ grossProfit: '10.00', soldCost: '0.00' });
  });

  it('requires supplier and actual cost for manual deliveries and preserves their provenance', async () => {
    const id = (
      await manager.request('/products', {
        name: 'Manual delivery',
        sku: 'MANUAL-COST',
        category: 'Food',
        unit: 'piece',
        price: '10',
        minStock: '0',
        barcodes: [],
      })
    ).body.id;
    const command = {
      requestId: crypto.randomUUID(),
      productId: id,
      quantity: '5',
      reason: 'received',
      unitCost: '3.20',
    };
    expect((await manager.request('/inventory/adjustments', command)).status).toBe(400);
    const received = await manager.request('/inventory/adjustments', { ...command, supplierId });
    expect(received.status).toBe(201);
    expect(
      (await manager.request('/inventory/adjustments', { ...command, supplierId })).body.id,
    ).toBe(received.body.id);
    const batches = (await manager.request(`/inventory/products/${id}/batches`)).body.batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      unitCost: '3.20',
      supplierName: 'Cola supplier',
      supplierId,
      supplierCode: 'COLA',
    });
    expect(
      (await manager.request(`/suppliers/${supplierId}/products`)).body.find(
        (offer: any) => offer.productId === id,
      ),
    ).toMatchObject({ lastPaidCost: '3.20', packCost: null });
    const item = (await manager.request('/products')).body.find((p: any) => p.id === id);
    expect(item).toMatchObject({
      cost: null,
      averageCost: '3.20',
      stockValue: '16.00',
      lastPurchaseCost: '3.20',
    });
    const edited = await manager.request(
      `/products/${id}`,
      {
        name: item.name,
        sku: item.sku,
        category: item.category,
        unit: item.unit,
        price: '12',
        minStock: '0',
        barcodes: item.barcodes,
      },
      'PATCH',
    );
    expect(edited.status).toBe(200);
    expect(
      (await manager.request(`/inventory/products/${id}/batches`)).body.batches[0].unitCost,
    ).toBe('3.20');
  });
});
