import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from './client.mjs';
import { Ledger, scaled, decimal, rounded, addDays, random } from './ledger.mjs';

export async function simulate({
  url,
  origin,
  db,
  clock,
  config,
  credentials,
  record,
  checkpoint,
}) {
  const oracle = new Ledger(),
    rng = random(config.seed);
  const coverage = {},
    daily = [];
  const hit = (name, n = 1) => {
    coverage[name] = (coverage[name] ?? 0) + n;
  };
  const manager = new Client(url, origin, record);
  const registers = [new Client(url, origin, record), new Client(url, origin, record)];
  const floor = new Client(url, origin, record);
  const account = { email: credentials.email, password: credentials.password };
  const approval = { employeeCode: 'MANAGER', pin: credentials.managerPin };
  const at = async (date, time) => clock.set(`${date}T${time}:00Z`);
  await at(config.from, '06:00');
  await manager.request('/auth/setup', {
    ...account,
    storeName: 'Eliza — 30 day simulation',
    ownerName: 'Simulation Manager',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const session = await manager.request('/auth/session');
  const storeId = session.store.id;
  const roles = await manager.request('/team/roles');
  const role = (name) => roles.find((r) => r.name === name).id;
  await manager.request(
    '/team/' + session.user.id,
    {
      name: 'Simulation Manager',
      employeeCode: 'MANAGER',
      roleId: role('Owner'),
      active: true,
      pin: credentials.managerPin,
    },
    { method: 'PATCH' },
  );
  const employees = [];
  for (const [i, name] of ['Anna Larsen', 'Lars Berg', 'Nora Hansen', 'Emil Olsen'].entries()) {
    const supervisor = i === 2,
      isFloor = i === 3;
    const primary = role(isFloor ? 'General employee' : 'Cashier');
    const pin = String(310001 + i);
    const employee = await manager.request('/team', {
      name,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1],
      birthYear: 1990 + i,
      gender: i % 2 ? 'male' : 'female',
      phone: `+479000010${i}`,
      employeeCode: `SIM${i + 1}`,
      pin,
      ...(i === 0 ? { email: 'cashier@simulation.test', password: credentials.password } : {}),
      roleId: primary,
      roleIds: supervisor ? [primary, role('Manager')] : [primary],
    });
    employees.push({ ...employee, name, employeeCode: `SIM${i + 1}`, pin, supervisor, isFloor });
  }
  credentials.employees = employees;
  hit('employees_created', 5);
  for (const [i, client] of registers.entries()) {
    await client.request('/auth/login', account);
    await client.request('/pos/enroll', { name: `Simulation register ${i + 1}` });
  }
  await floor.request('/auth/login', account);
  const floorSession = await floor.request('/auth/session');
  await manager.request(
    '/devices/' + floorSession.device.id,
    { name: 'Simulation floor phone', type: 'price_tags', active: true },
    { method: 'PATCH' },
  );
  hit('devices_assigned', 3);
  const supplierIds = [];
  for (let i = 0; i < 4; i++) {
    const supplier = await manager.request('/suppliers', {
      requestId: randomUUID(),
      code: `SIM-S${i + 1}`,
      name: ['Oslo Dairy', 'Fresh Produce', 'Grocery Supply', 'Drinks Wholesale'][i],
      whatsappPhone: `+479000020${i}`,
    });
    supplierIds.push(supplier.id);
  }
  hit('suppliers_created', 4);
  const names = [
    'Yogurt',
    'Milk',
    'Cheese',
    'Bread',
    'Coffee',
    'Rice',
    'Pasta',
    'Cola',
    'Chocolate',
    'Tea',
  ];
  const products = [];
  for (let i = 0; i < config.products; i++) {
    const weighted = i % 5 === 4;
    const category = weighted
      ? 'Produce'
      : ['Dairy', 'Bakery', 'Grocery', 'Drinks'][Math.floor(i / 5) % 4];
    const price = i === 0 ? 7000n : BigInt(1200 + ((i * 137) % 6800));
    const cost = i === 0 ? 5900n : rounded(price * BigInt(48 + (i % 25)), 100n);
    const tax = [0n, 1500n, 2500n][i % 3];
    const body = {
      name:
        i === 0
          ? 'Yogurt'
          : `${weighted ? 'Apples' : names[i % 10]} ${String(i + 1).padStart(3, '0')}`,
      sku: `SIM-${i + 1}`,
      category,
      unit: weighted ? 'kilogram' : 'piece',
      price: decimal(price),
      cost: decimal(cost),
      taxRate: decimal(tax),
      minStock: weighted ? '3' : '8',
      plu: String(100 + i),
      barcodes: [],
    };
    const created = await manager.request('/products', body);
    const product = {
      id: created.id,
      name: body.name,
      category,
      unit: body.unit,
      price,
      cost,
      tax,
      supplierId: supplierIds[i % 4],
      barcode: created.barcodes[0],
      shelf: category === 'Dairy' ? 5 : category === 'Bakery' ? 3 : weighted ? 8 : 60,
      index: i,
      body,
    };
    products.push(product);
    oracle.addProduct(product);
    await manager.request('/supplier-products', {
      requestId: randomUUID(),
      supplierId: product.supplierId,
      productId: product.id,
      packCost: decimal(cost),
      taxRate: '0',
      packSize: '1',
      preferred: true,
      leadTimeDays: 1,
      minimumOrder: '1',
    });
  }
  hit('products_created', products.length);
  hit('generated_product_barcodes', products.length);
  hit('supplier_offers_created', products.length);
  const knownBatches = new Set();
  async function registerBatches(planned) {
    for (const p of planned) {
      const result = await manager.request('/inventory/products/' + p.id + '/batches');
      const added = result.batches.filter((b) => !knownBatches.has(b.id));
      assert.equal(added.length, 1, 'One new received batch per delivery line');
      const b = added[0];
      oracle.equal(scaled(b.quantity, 3), p.quantity, 'received quantity');
      oracle.equal(scaled(b.unitCost), p.cost, 'received unit cost');
      oracle.equal(b.expiryDate, p.expiry, 'received expiry');
      oracle.receive(p.id, {
        id: b.id,
        quantity: p.quantity,
        cost: p.cost,
        expiry: p.expiry,
        createdAt: new Date(b.createdAt).toISOString(),
      });
      knownBatches.add(b.id);
    }
  }
  async function purchase(items, date, day, partial = false) {
    for (const supplierId of supplierIds) {
      const group = items.filter((p) => p.supplierId === supplierId);
      if (!group.length) continue;
      let order = await manager.request('/purchases', {
        requestId: randomUUID(),
        supplierId,
        expectedDate: date,
        notes: 'Generated simulation delivery',
        lines: group.map((p) => ({
          productId: p.id,
          quantity: decimal(p.quantity, 3),
          unitCost: decimal(p.cost),
          taxRate: '0',
        })),
      });
      hit('purchase_orders');
      order = await manager.request(`/purchases/${order.id}/status`, {
        requestId: randomUUID(),
        version: order.version,
        status: 'ordered',
      });
      const parts = partial ? 2 : 1;
      for (let part = 0; part < parts; part++) {
        const planned = group.map((p) => ({
          ...p,
          quantity:
            parts === 1
              ? p.quantity
              : part === 0
                ? p.unit === 'piece'
                  ? (p.quantity / 2000n) * 1000n
                  : p.quantity / 2n
                : p.quantity -
                  (p.unit === 'piece' ? (p.quantity / 2000n) * 1000n : p.quantity / 2n),
          expiry: addDays(date, p.shelf + part),
        }));
        const body = {
          requestId: randomUUID(),
          version: order.version,
          deliveryReference: `SIM-${day}-${part}`,
          lines: planned.map((p) => ({
            purchaseLineId: order.lines.find((l) => l.product_id === p.id).id,
            quantity: decimal(p.quantity, 3),
            expiryDate: p.expiry,
          })),
        };
        order = await manager.request(`/purchases/${order.id}/receipts`, body);
        await registerBatches(planned);
        if (part === 0 && partial) {
          oracle.equal(order.status, 'partially_received', 'partial receipt status');
          hit('partial_deliveries');
        }
        // Repeated receiving request must return its original result without adding stock.
        const repeated = await manager.request(`/purchases/${order.id}/receipts`, body);
        oracle.equal(repeated.version, order.version, 'receipt idempotency');
        hit('idempotent_receiving');
        hit('goods_receipts');
      }
      oracle.equal(order.status, 'received', 'completed purchase status');
      await manager.request(`/purchases/${order.id}/payment`, {
        requestId: randomUUID(),
        version: order.version,
        status: day % 3 === 0 ? 'unpaid' : 'paid',
        dueDate: addDays(date, day % 3 === 0 ? -1 : 7),
      });
      hit(day % 3 === 0 ? 'supplier_unpaid' : 'supplier_paid');
    }
  }
  async function expense(body) {
    await manager.request('/expenses', body);
    oracle.expenses.push({ ...body, amount: scaled(body.amount) });
    hit('expenses_recorded');
  }
  await expense({
    date: config.from,
    description: 'Simulation rent',
    category: 'Rent',
    amount: '9000.17',
    paymentMethod: 'bank',
    allocationMethod: 'EVEN_OVER_PERIOD',
    periodStart: config.from,
    periodEnd: config.to,
  });
  await expense({
    date: config.from,
    description: 'Simulation staffing',
    category: 'Payroll',
    amount: '18000.00',
    paymentMethod: 'bank',
    allocationMethod: 'EVEN_OVER_PERIOD',
    periodStart: config.from,
    periodEnd: config.to,
  });
  const finalLabels = [];
  let expiredLabel = null;
  async function createMarkdowns(product, date, quantity = 5) {
    const expectedPrice = (oracle.price(product.id, clock.instant) * 7n) / 10n;
    const planned = oracle.allocate(product.id, BigInt(quantity) * 1000n, clock.instant);
    const batchIds = planned.flatMap((a) => Array(Number(a.quantity / 1000n)).fill(a.batch.id));
    const body = {
      requestId: randomUUID(),
      quantity,
      price: decimal(expectedPrice),
      reason: 'EXPIRING_SOON',
      validUntil: `${date}T20:30:00Z`,
    };
    const result = await manager.request(`/products/${product.id}/pricing/limited`, body);
    const again = await manager.request(`/products/${product.id}/pricing/limited`, body);
    assert.deepEqual(result, again);
    hit('idempotent_markdowns');
    for (const [i, label] of result.labels.entries()) {
      oracle.labels.set(label.id, {
        ...label,
        price: expectedPrice,
        productId: product.id,
        batchId: batchIds[i],
        status: 'AVAILABLE',
        validUntil: body.validUntil,
      });
    }
    hit('unit_labels_created', quantity);
    // Batch assignment is metadata; independently predicted FEFO reservation must match it.
    const actual = await manager.request(`/products/${product.id}/pricing/markdowns`);
    for (const label of result.labels)
      oracle.equal(
        actual.find((l) => l.id === label.id).batchId,
        oracle.labels.get(label.id).batchId,
        'markdown FEFO reservation',
      );
    return result.labels;
  }
  async function sell(client, shift, entries, date, method = 'card', retry = false) {
    const planned = entries.map((e) =>
      oracle.line(e.product.id, e.quantity, clock.instant, e.labelId),
    );
    const total = planned.reduce((n, l) => n + l.total, 0n);
    const body = {
      requestId: randomUUID(),
      shiftId: shift.id,
      lines: planned.map((l) => ({
        productId: l.id,
        quantity: decimal(l.quantity, 3),
        expectedPrice: decimal(l.price),
        expectedTaxRate: decimal(oracle.products.get(l.id).tax),
        ...(l.labelId ? { markdownUnitId: l.labelId } : {}),
      })),
      discountPercent: '0',
      payment: {
        method,
        tendered: decimal(method === 'cash' ? ((total + 9999n) / 10000n) * 10000n : total),
      },
    };
    const receipt = await client.request('/pos/sales', body);
    oracle.sale(receipt, planned, date, shift.id);
    hit('sales');
    if (retry) {
      assert.deepEqual(await client.request('/pos/sales', body), receipt);
      hit('idempotent_sales');
    }
    return { receipt, body };
  }
  async function rejectSale(
    client,
    shift,
    product,
    quantity,
    { status = 409, labelId, price } = {},
  ) {
    await client.request(
      '/pos/sales',
      {
        requestId: randomUUID(),
        shiftId: shift.id,
        lines: [
          {
            productId: product.id,
            quantity: decimal(quantity, 3),
            expectedPrice: decimal(price ?? oracle.price(product.id, clock.instant)),
            expectedTaxRate: decimal(product.tax),
            ...(labelId ? { markdownUnitId: labelId } : {}),
          },
        ],
        discountPercent: '0',
        payment: { method: 'cash', tendered: '99999999' },
      },
      { status },
    );
  }
  async function verify(date) {
    const rows = (
      await db.query('SELECT id,stock::text FROM products WHERE store_id=$1', [storeId])
    ).rows;
    for (const p of rows)
      oracle.equal(scaled(p.stock, 3), oracle.stock(p.id), 'daily product stock ' + p.id);
    const batches = (
      await db.query('SELECT id,quantity::text FROM stock_batches WHERE store_id=$1', [storeId])
    ).rows;
    const expectedBatches = new Map(
      [...oracle.products.values()].flatMap((p) => p.batches.map((b) => [b.id, b])),
    );
    oracle.equal(batches.length, expectedBatches.size, 'batch count');
    for (const b of batches)
      oracle.equal(
        scaled(b.quantity, 3),
        expectedBatches.get(b.id)?.quantity,
        'daily batch stock ' + b.id,
      );
    const sales = (
      await db.query(
        "SELECT i.id,i.quantity::text,i.cost_total::text FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE (s.created_at AT TIME ZONE 'Europe/Oslo')::date=$1",
        [date],
      )
    ).rows;
    const expectedLines = new Map(
      [...oracle.receipts.values()].flatMap((r) => r.planned.map((l) => [l.saleItemId, l])),
    );
    for (const s of sales)
      oracle.equal(
        scaled(s.cost_total),
        expectedLines.get(s.id)?.cost,
        'historical sale batch cost',
      );
    const summary = await manager.request(`/reports/financial-summary?from=${date}&to=${date}`);
    const expected = oracle.verifyFinancial(summary, date, date);
    const analytics = await manager.request(`/reports/analytics?from=${date}&to=${date}`);
    const day = oracle.day(date);
    for (const [key, value] of Object.entries({
      total: day.sales,
      refunds: day.refunds,
      net: day.sales - day.refunds,
      cash: day.cash,
      card: day.card,
      tax: day.salesTax,
      discount: day.discounts,
    })) {
      oracle.equal(scaled(analytics.totals[key]), value, 'Analytics ' + key);
    }
    oracle.equal(Number(analytics.totals.transactions), day.transactions, 'Analytics transactions');
    const overview = await manager.request(
      `/reports/owner-dashboard?period=custom&from=${date}&to=${date}`,
    );
    for (const key of [
      'revenue',
      'cogs',
      'grossProfit',
      'grossMarginPercent',
      'inventoryLosses',
      'operatingExpenses',
      'storeOperatingProfit',
    ])
      oracle.equal(overview.financialSummary[key], expected[key], 'Overview ' + key);
    const quality = (
      await db.query(`SELECT
      (SELECT count(*)::int FROM shifts WHERE status='open') AS open,
      (SELECT count(*)::int FROM products p WHERE stock<>(SELECT COALESCE(sum(quantity),0) FROM movements m WHERE m.product_id=p.id)) AS stock,
      (SELECT count(*)::int FROM sales s WHERE total<>(SELECT COALESCE(sum(total),0) FROM sale_items i WHERE i.sale_id=s.id) OR total<>(SELECT COALESCE(sum(amount),0) FROM payments p WHERE p.sale_id=s.id)) AS sales,
      (SELECT count(*)::int FROM refunds r WHERE total<>(SELECT COALESCE(sum(total),0) FROM refund_lines l WHERE l.refund_id=r.id)) AS refunds,
      (SELECT count(*)::int FROM shifts s WHERE status='closed' AND expected_cash<>(SELECT COALESCE(sum(amount),0) FROM cash_movements m WHERE m.shift_id=s.id)) AS drawers`)
    ).rows[0];
    for (const [key, value] of Object.entries(quality))
      oracle.equal(value, 0, 'ledger integrity ' + key);
    const result = { date, ...expected, checks: oracle.checks };
    daily.push(result);
    record({ type: 'daily_reconciliation', ...result });
    await checkpoint({ daily, coverage, checks: oracle.checks });
    console.log(
      `Simulation ${daily.length}/${config.days}: ${date}, ${day.transactions} sales, revenue ${expected.revenue}, profit ${expected.storeOperatingProfit}; reconciled`,
    );
  }
  for (let day = 0; day < config.days; day++) {
    const date = addDays(config.from, day);
    await at(date, '07:00');
    // Sessions genuinely expire as days advance; re-authenticate instead of bypassing auth.
    if (day) await manager.request('/auth/login', account);
    await floor.request(
      '/price-tags/login',
      day % 2
        ? { qrCredential: employees[3].qrCredential }
        : { employeeCode: employees[3].employeeCode, pin: employees[3].pin },
    );
    hit(day % 2 ? 'qr_unlocks' : 'pin_unlocks');
    if (expiredLabel) {
      const testClient = registers[0];
      await testClient.request('/pos/login', { qrCredential: employees[0].qrCredential });
      const unavailable = await testClient.request(
        '/pos/products?code=' + expiredLabel.barcode,
        undefined,
        { status: 409 },
      );
      oracle.equal(
        unavailable.message,
        'This markdown label is no longer valid.',
        'expired label is rejected by POS lookup',
      );
      hit('expired_labels_rejected');
      expiredLabel = null;
    }
    // Remove expired physical stock before accepting new deliveries.
    for (const p of products) {
      const expired = oracle.products
        .get(p.id)
        .batches.filter((b) => b.expiry && b.expiry <= date)
        .reduce((n, b) => n + b.quantity, 0n);
      if (!expired) continue;
      await manager.request('/inventory/adjustments', {
        requestId: randomUUID(),
        productId: p.id,
        quantity: decimal(-expired, 3),
        reason: 'expired',
        notes: 'Simulation expiry check',
      });
      oracle.remove(p.id, expired, clock.instant, true);
      hit('expired_stock_writeoffs');
    }
    const needed = products.filter(
      (p) => day === 0 || oracle.free(p.id, clock.instant) < (p.unit === 'piece' ? 8000n : 3000n),
    );
    await purchase(
      needed.map((p) => ({
        ...p,
        quantity:
          day === 0 ? (p.unit === 'piece' ? 40000n : 18000n) : p.unit === 'piece' ? 30000n : 12000n,
        cost: p.cost + BigInt(day % 5) * 17n,
      })),
      date,
      day,
      day % 7 === 0,
    );
    if (day % 7 === 0) {
      const p = products[0];
      let pending = await manager.request('/purchases', {
        requestId: randomUUID(),
        supplierId: p.supplierId,
        expectedDate: addDays(date, 2),
        notes: 'Simulation pending delivery',
        lines: [{ productId: p.id, quantity: '5', unitCost: decimal(p.cost), taxRate: '0' }],
      });
      if (day % 14 === 0) {
        pending = await manager.request(`/purchases/${pending.id}/status`, {
          requestId: randomUUID(),
          version: pending.version,
          status: 'ordered',
        });
        hit('pending_orders');
      } else hit('draft_orders');
      let cancelled = await manager.request('/purchases', {
        requestId: randomUUID(),
        supplierId: p.supplierId,
        lines: [{ productId: p.id, quantity: '2', unitCost: decimal(p.cost), taxRate: '0' }],
      });
      cancelled = await manager.request(`/purchases/${cancelled.id}/status`, {
        requestId: randomUUID(),
        version: cancelled.version,
        status: 'ordered',
      });
      await manager.request(`/purchases/${cancelled.id}/status`, {
        requestId: randomUUID(),
        version: cancelled.version,
        status: 'cancelled',
        reason: 'Simulation supplier unavailable',
      });
      hit('cancelled_orders');
    }
    if (day % 7 === 0) {
      await expense({
        date,
        description: 'Simulation utilities and cleaning',
        category: 'Utilities',
        amount: '175.25',
        paymentMethod: 'bank',
      });
      await manager.request('/shopping-lists', {
        requestId: randomUUID(),
        name: `Replenishment ${date}`,
        pieceStockLimit: '35',
        kilogramStockLimit: '15',
      });
      hit('shopping_lists');
    }
    await at(date, '08:00');
    const shifts = [];
    for (const [i, client] of registers.entries()) {
      const employee = employees[(day + i) % 3];
      await client.request(
        '/pos/login',
        day % 2
          ? { qrCredential: employee.qrCredential }
          : { employeeCode: employee.employeeCode, pin: employee.pin },
      );
      hit(day % 2 ? 'qr_unlocks' : 'pin_unlocks');
      const body = { requestId: randomUUID(), openingCash: '1500.00' };
      const shift = await client.request('/pos/shifts', body);
      oracle.equal(
        (await client.request('/pos/shifts', body)).id,
        shift.id,
        'open shift idempotency',
      );
      shifts.push({ ...shift, employee });
      oracle.drawers.set(shift.id, 150000n);
      hit('shifts_opened');
      if (employee.supervisor) {
        for (const [direction, amount] of [
          ['in', '100.00'],
          ['out', '50.00'],
        ]) {
          await client.request('/pos/cash', {
            requestId: randomUUID(),
            direction,
            amount,
            reason: 'Simulation cash movement',
          });
          oracle.drawers.set(
            shift.id,
            oracle.drawers.get(shift.id) + (direction === 'in' ? 1n : -1n) * scaled(amount),
          );
          hit('cash_movements');
        }
      } else {
        await client.request(
          '/pos/cash',
          {
            requestId: randomUUID(),
            direction: 'out',
            amount: '1',
            reason: 'Must require permission',
          },
          { status: 403 },
        );
        hit('permission_rejections');
      }
    }
    // A cashier management session cannot change catalogue prices.
    if (day === 0) {
      const cashier = new Client(url, origin, record);
      await cashier.request('/auth/login', {
        email: 'cashier@simulation.test',
        password: credentials.password,
      });
      await cashier.request(
        `/products/${products[0].id}/pricing`,
        { kind: 'regular', price: '1' },
        { status: 403 },
      );
      hit('permission_rejections');
    }
    // Product promotions and category promotions overlap; the lower price wins.
    if (day % 7 === 0) {
      const categories = await manager.request('/promotions/categories');
      for (const target of [
        { category: 'Dairy', type: 'PERCENTAGE', value: 1000n },
        { productId: products[0].id, type: 'FIXED_PRICE', value: 6000n },
      ]) {
        const start = clock.instant,
          end = `${addDays(date, 3)}T08:00:00Z`;
        const promo = await manager.request('/promotions', {
          name: `Simulation ${target.category ?? 'Yogurt'} ${date}`,
          discountType: target.type,
          discountValue: decimal(target.value),
          startsAt: start,
          endsAt: end,
          ...(target.productId
            ? { productIds: [target.productId] }
            : { categoryIds: [categories.find((c) => c.name === target.category).id] }),
        });
        oracle.promotions.push({ ...target, id: promo.id, start, end });
        hit(target.productId ? 'product_promotions' : 'category_promotions');
      }
    }
    if (day % 7 === 3) {
      const active = oracle.promotions.find(
        (p) => !p.cancelled && p.productId && p.end > clock.instant,
      );
      if (active) {
        await manager.request(`/promotions/${active.id}/cancel`, {});
        active.cancelled = true;
        hit('promotions_cancelled');
      }
    }
    if (day % 6 === 2) {
      const p = products[1];
      p.price += 100n;
      oracle.products.get(p.id).price = p.price;
      await manager.request(`/products/${p.id}/pricing`, {
        kind: 'regular',
        price: decimal(p.price),
      });
      hit('base_price_changes');
    }
    const labelProduct = products.find(
      (p) => p.unit === 'piece' && oracle.free(p.id, clock.instant) >= 5000n,
    );
    assert.ok(labelProduct);
    const labels = await createMarkdowns(labelProduct, date);
    const replacing = labels[0];
    const replacement = (
      await manager.request(
        `/products/${labelProduct.id}/pricing/markdowns/${replacing.id}/replace`,
        {},
      )
    ).label;
    const old = oracle.labels.get(replacing.id);
    old.status = 'CANCELLED';
    oracle.labels.set(replacement.id, {
      ...old,
      ...replacement,
      price: old.price,
      status: 'AVAILABLE',
    });
    hit('labels_replaced');
    await rejectSale(registers[0], shifts[0], labelProduct, 1000n, {
      labelId: replacing.id,
      price: old.price,
    });
    hit('replaced_labels_rejected');
    await manager.request(
      `/products/${labelProduct.id}/pricing/markdowns/${labels[1].id}/cancel`,
      {},
    );
    oracle.labels.get(labels[1].id).status = 'CANCELLED';
    hit('labels_cancelled');
    await rejectSale(registers[0], shifts[0], labelProduct, 1000n, {
      labelId: labels[1].id,
      price: old.price,
    });
    hit('cancelled_labels_rejected');
    const printable = await floor.request('/price-tags/markdown-labels');
    assert.ok(printable.some((l) => l.id === replacement.id));
    const printLabels = await floor.request('/price-tags/markdown-prints', {
      unitIds: [replacement.id, labels[2].id],
    });
    oracle.equal(printLabels.labels.length, 2, 'floor markdown print data');
    hit('markdown_print_payloads');
    const job = await floor.request('/price-tags/prints', {
      productIds: products.slice(0, 3).map((p) => p.id),
    });
    await floor.request(`/price-tags/prints/${job.id}/complete`, {});
    hit('simulated_price_tag_prints');
    const lookup = await registers[0].request('/pos/products?code=' + replacement.barcode);
    oracle.equal(lookup[0]?.markdownUnitId, replacement.id, 'markdown barcode lookup');
    hit('markdown_barcode_lookups');
    const first = await sell(
      registers[0],
      shifts[0],
      [{ product: labelProduct, quantity: 1000n, labelId: replacement.id }],
      date,
      'cash',
      true,
    );
    await rejectSale(registers[1], shifts[1], labelProduct, 1000n, {
      labelId: replacement.id,
      price: old.price,
    });
    hit('used_labels_rejected');
    await sell(
      registers[1],
      shifts[1],
      [{ product: labelProduct, quantity: 1000n, labelId: labels[2].id }],
      date,
    );
    expiredLabel = labels[3];
    await rejectSale(registers[0], shifts[0], products[0], oracle.stock(products[0].id) + 1000n);
    hit('overselling_rejected');
    await rejectSale(registers[0], shifts[0], products[0], 1000n, {
      price: oracle.price(products[0].id, clock.instant) + 1n,
    });
    hit('stale_price_rejected');
    // Both registers race for the same last free units. Exactly one may succeed.
    if (day % 7 === 0) {
      const product = [...products]
        .reverse()
        .find((p) => p.unit === 'piece' && oracle.free(p.id, clock.instant) >= 1000n);
      assert.ok(product);
      const quantity = oracle.free(product.id, clock.instant);
      const line = oracle.line(product.id, quantity, clock.instant);
      const responses = await Promise.all(
        registers.map((client, i) =>
          client.request(
            '/pos/sales',
            {
              requestId: randomUUID(),
              shiftId: shifts[i].id,
              lines: [
                {
                  productId: product.id,
                  quantity: decimal(quantity, 3),
                  expectedPrice: decimal(line.price),
                  expectedTaxRate: decimal(product.tax),
                },
              ],
              discountPercent: '0',
              payment: { method: 'card', tendered: decimal(line.total) },
            },
            { status: [201, 409] },
          ),
        ),
      );
      const winners = responses.map((r, i) => ({ r, i })).filter(({ r }) => r.receiptNumber);
      oracle.equal(winners.length, 1, 'only one register can sell the last stock');
      oracle.sale(winners[0].r, [line], date, shifts[winners[0].i].id);
      hit('sales');
      hit('concurrent_overselling_rejected');
    }
    if (day === 0) {
      const product = products[products.length - 1];
      await manager.request(
        '/products/' + product.id + '/status',
        { active: false },
        { method: 'PATCH' },
      );
      await rejectSale(registers[0], shifts[0], product, 1000n, { status: 400 });
      hit('inactive_products_rejected');
      await manager.request(
        '/products/' + product.id + '/status',
        { active: true },
        { method: 'PATCH' },
      );
    }
    const receipts = [first.receipt];
    const weekend = [0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay());
    const count =
      config.salesPerDay +
      (weekend ? Math.floor(config.salesPerDay / 3) : 0) +
      Math.floor(rng() * Math.max(1, config.salesPerDay / 4));
    for (let i = 2; i < count; i++) {
      const minute = Math.floor(((i - 2) / (count - 2)) * 600);
      await at(
        date,
        `${String(9 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      );
      const entries = [],
        used = new Set();
      const wanted = 1 + Math.floor(rng() * 3);
      for (let attempt = 0; attempt < 20 && entries.length < wanted; attempt++) {
        const bound = rng() < 0.5 ? Math.min(20, products.length) : products.length;
        const p = products[Math.floor(rng() * bound)];
        if (used.has(p.id)) continue;
        const quantity =
          p.unit === 'piece'
            ? BigInt(1 + Math.floor(rng() * 3)) * 1000n
            : [250n, 500n, 750n, 1250n][Math.floor(rng() * 4)];
        if (oracle.free(p.id, clock.instant) < quantity) continue;
        used.add(p.id);
        entries.push({ product: p, quantity });
      }
      if (!entries.length) {
        hit('stockout_baskets_skipped');
        continue;
      }
      const index = i % 2;
      const result = await sell(
        registers[index],
        shifts[index],
        entries,
        date,
        rng() < 0.4 ? 'cash' : 'card',
        i % 25 === 0,
      );
      receipts.push(result.receipt);
    }
    await at(date, '19:30');
    await manager.request('/auth/login', account);
    // Return a prior-day sale as well as today's sales. Original costs survive later deliveries.
    const candidates = [...oracle.receipts.values()].filter((r) =>
      r.planned.some((l) => !l.labelId && l.returned < l.quantity),
    );
    const chosen = [candidates[0], candidates[candidates.length - 1]].filter(Boolean);
    for (const [i, r] of chosen.entries()) {
      const line = r.planned.find((l) => !l.labelId && l.returned < l.quantity);
      if (!line) continue;
      const product = oracle.products.get(line.id);
      const remaining = line.quantity - line.returned;
      const quantity =
        product.unit === 'piece'
          ? remaining >= 1000n
            ? 1000n
            : remaining
          : remaining >= 250n
            ? 250n
            : remaining;
      const body = {
        requestId: randomUUID(),
        saleId: r.id,
        reason: i ? 'Damaged item' : 'Customer return',
        method: r.payment.method,
        confirmed: true,
        approval,
        lines: [
          {
            productId: line.id,
            saleItemId: line.saleItemId,
            quantity: decimal(quantity, 3),
            restock: i === 0,
          },
        ],
      };
      const refunded = await registers[0].request('/pos/refunds', body);
      const expected = oracle.refund(r.id, line, quantity, i === 0, date, shifts[0].id);
      oracle.equal(scaled(refunded.total), expected.amount, 'refund amount');
      assert.deepEqual(await registers[0].request('/pos/refunds', body), refunded);
      hit('idempotent_refunds');
      hit(i ? 'non_resellable_refunds' : 'restocked_refunds');
      await registers[0].request(
        '/pos/refunds',
        {
          ...body,
          requestId: randomUUID(),
          lines: [{ ...body.lines[0], quantity: decimal(line.quantity + 1000n, 3) }],
        },
        { status: 409 },
      );
      hit('over_refunds_rejected');
    }
    const damaged = products.find((p) => oracle.free(p.id, clock.instant) >= 1000n);
    if (damaged) {
      await manager.request('/inventory/adjustments', {
        requestId: randomUUID(),
        productId: damaged.id,
        quantity: '-1',
        reason: 'damaged',
        notes: 'Simulation damaged packaging',
      });
      oracle.remove(damaged.id, 1000n, clock.instant, true);
      hit('damaged_writeoffs');
    }
    if (day % 7 === 5) {
      const counted = products
        .filter((p) => p.unit === 'piece' && oracle.free(p.id, clock.instant) >= 1000n)
        .slice(0, 3);
      let count = await manager.request('/stock-counts', {
        requestId: randomUUID(),
        name: `Weekly count ${date}`,
        productIds: counted.map((p) => p.id),
      });
      count = await manager.request(`/stock-counts/${count.id}/action`, {
        requestId: randomUUID(),
        version: count.version,
        action: 'start',
      });
      count = await manager.request(`/stock-counts/${count.id}/quantities`, {
        requestId: randomUUID(),
        version: count.version,
        lines: counted.map((p, i) => ({
          productId: p.id,
          quantity: decimal(oracle.stock(p.id) - (i === 0 ? 1000n : 0n), 3),
        })),
      });
      count = await manager.request(`/stock-counts/${count.id}/action`, {
        requestId: randomUUID(),
        version: count.version,
        action: 'review',
      });
      await manager.request(`/stock-counts/${count.id}/finalize`, {
        requestId: randomUUID(),
        version: count.version,
      });
      oracle.remove(counted[0].id, 1000n, clock.instant, false);
      hit('stock_counts_finalized');
    }
    await at(date, '20:00');
    for (const [i, client] of registers.entries()) {
      // Price Tags and POS credentials expire after twelve virtual hours; last login was 08:00.
      const employee = shifts[i].employee;
      await client.request('/pos/login', { qrCredential: employee.qrCredential });
      hit('qr_unlocks');
      const expected = oracle.drawers.get(shifts[i].id),
        difference = day % 9 === 4 && i === 0 ? -100n : 0n;
      const close = {
        requestId: randomUUID(),
        countedCash: decimal(expected + difference),
        notes: 'Simulation end of day',
        ...(difference ? { approval } : {}),
      };
      const result = await client.request(`/pos/shifts/${shifts[i].id}/close`, close);
      oracle.equal(scaled(result.expectedCash), expected, 'expected drawer cash');
      oracle.equal(scaled(result.difference), difference, 'drawer variance');
      assert.deepEqual(await client.request(`/pos/shifts/${shifts[i].id}/close`, close), result);
      hit('shifts_closed');
      if (difference) hit('approved_cash_differences');
    }
    await verify(date);
    if (day === config.days - 1)
      finalLabels.push(
        ...[...oracle.labels.values()].filter(
          (l) => l.status === 'AVAILABLE' && l.validUntil > clock.instant,
        ),
      );
  }
  const financial = await manager.request(
    `/reports/financial-summary?from=${config.from}&to=${config.to}`,
  );
  oracle.verifyFinancial(financial, config.from, config.to);
  const replenishment = await manager.request('/reports/replenishment?historyDays=28');
  oracle.equal(replenishment.total, products.length, 'replenishment product count');
  hit('replenishment_report');
  await manager.request('/reports/action-center');
  hit('action_center_report');
  await manager.request('/reports/sales?page=2');
  hit('sales_pagination');
  await manager.request('/purchases?page=2');
  hit('purchase_pagination');
  await manager.request('/inventory/movements/history?page=2');
  hit('movements_pagination');
  const dates = (
    await db.query(`SELECT count(DISTINCT (created_at AT TIME ZONE 'Europe/Oslo')::date)::int AS days,
    bool_and(created_at=(receipt->>'createdAt')::timestamptz) AS matching FROM sales`)
  ).rows[0];
  oracle.equal(dates.days, config.days, 'sales across distinct virtual dates');
  oracle.equal(dates.matching, true, 'database and receipt clocks match');
  const triggers = (
    await db.query(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'`,
    )
  ).rows[0].n;
  oracle.equal(triggers, 0, 'all append-only and integrity triggers remain enabled');
  return {
    storeId,
    coverage,
    daily,
    checks: oracle.checks,
    financial,
    availableMarkdownLabels: finalLabels.length,
    replenishment: {
      total: replenishment.total,
      completedDays: replenishment.historyDays,
      example: replenishment.rows.slice(0, 3),
    },
    limitations: [
      'Synthetic demand is not a forecast validation.',
      'Physical printing, camera, external payments, WhatsApp delivery, AI provider and offline Electron sync are not exercised.',
      'Price tag print completion is simulated, no printer is contacted.',
      'HTTP workflows are checked; browser layout and multi-user load need separate tests.',
    ],
  };
}
