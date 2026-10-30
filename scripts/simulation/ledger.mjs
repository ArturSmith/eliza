// Independent oracle: no imports from application pricing, stock or finance code.
import assert from 'node:assert/strict';
export const scaled = (value, precision = 2) => {
  const [whole, fraction = ''] = String(value).split('.');
  assert.ok(fraction.length <= precision);
  const negative = whole.startsWith('-');
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole.replace('-', '')) * 10n ** BigInt(precision) +
      BigInt(fraction.padEnd(precision, '0')))
  );
};
export const decimal = (value, precision = 2) => {
  const sign = value < 0n ? '-' : '';
  const s = (value < 0n ? -value : value).toString().padStart(precision + 1, '0');
  return sign + s.slice(0, -precision) + '.' + s.slice(-precision);
};
export const rounded = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
export const addDays = (date, days) =>
  new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export const json = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
export function random(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let v = n;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}
export class Ledger {
  products = new Map();
  labels = new Map();
  promotions = [];
  days = new Map();
  receipts = new Map();
  drawers = new Map();
  expenses = [];
  checks = 0;
  day(date) {
    if (!this.days.has(date))
      this.days.set(date, {
        sales: 0n,
        refunds: 0n,
        soldCost: 0n,
        returnedCost: 0n,
        losses: 0n,
        cash: 0n,
        card: 0n,
        tax: 0n,
        salesTax: 0n,
        discounts: 0n,
        transactions: 0,
      });
    return this.days.get(date);
  }
  equal(actual, expected, context) {
    assert.equal(actual, expected, context);
    this.checks++;
  }
  addProduct(product) {
    this.products.set(product.id, { ...product, batches: [] });
  }
  receive(id, batch) {
    this.products.get(id).batches.push({ ...batch });
  }
  reserved(batchId, instant) {
    return (
      BigInt(
        [...this.labels.values()].filter(
          (l) =>
            l.batchId === batchId &&
            l.status === 'AVAILABLE' &&
            (!l.validUntil || l.validUntil > instant),
        ).length,
      ) * 1000n
    );
  }
  ordered(product) {
    return [...product.batches].sort(
      (a, b) =>
        (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  }
  free(id, instant, includeExpired = false) {
    return this.products
      .get(id)
      .batches.reduce(
        (sum, b) =>
          sum +
          (includeExpired || !b.expiry || b.expiry > instant.slice(0, 10)
            ? b.quantity - this.reserved(b.id, instant)
            : 0n),
        0n,
      );
  }
  stock(id) {
    return this.products.get(id).batches.reduce((sum, b) => sum + b.quantity, 0n);
  }
  price(id, instant) {
    const product = this.products.get(id);
    let result = product.price;
    for (const promo of this.promotions) {
      if (
        promo.cancelled ||
        promo.start > instant ||
        (promo.end && promo.end <= instant) ||
        !(promo.productId === id || promo.category === product.category)
      )
        continue;
      const candidate =
        promo.type === 'PERCENTAGE'
          ? rounded(product.price * (10000n - promo.value), 10000n)
          : promo.value;
      if (candidate < result) result = candidate;
    }
    return result;
  }
  allocate(id, quantity, instant, { batchId, includeExpired = false } = {}) {
    const allocations = [];
    let remaining = quantity;
    for (const batch of this.ordered(this.products.get(id))) {
      if (
        (batchId && batch.id !== batchId) ||
        (!includeExpired && batch.expiry && batch.expiry <= instant.slice(0, 10))
      )
        continue;
      const free = batch.quantity - (batchId ? 0n : this.reserved(batch.id, instant));
      const taken = free < remaining ? free : remaining;
      if (taken <= 0n) continue;
      allocations.push({
        batch,
        quantity: taken,
        cost: rounded(batch.cost * taken, 1000n),
        returned: 0n,
      });
      remaining -= taken;
      if (!remaining) break;
    }
    assert.equal(remaining, 0n, 'Oracle: insufficient free batch stock');
    return allocations;
  }
  line(id, quantity, instant, labelId) {
    const product = this.products.get(id),
      label = labelId ? this.labels.get(labelId) : null;
    const price = label?.price ?? this.price(id, instant);
    const total = rounded(price * quantity, 1000n);
    const gross = rounded(product.price * quantity, 1000n);
    const tax = rounded(total * product.tax, 10000n + product.tax);
    const allocations = this.allocate(id, quantity, instant, { batchId: label?.batchId });
    return {
      id,
      quantity,
      price,
      total,
      gross,
      tax,
      discount: gross - total,
      cost: allocations.reduce((n, a) => n + a.cost, 0n),
      allocations,
      labelId,
      returned: 0n,
    };
  }
  sale(receipt, planned, date, shiftId) {
    const totals = { total: 0n, tax: 0n, subtotal: 0n, discount: 0n };
    for (const [i, line] of planned.entries()) {
      const actual = receipt.lines[i];
      this.equal(actual.productId, line.id, 'receipt product');
      this.equal(scaled(actual.total), line.total, 'receipt line total');
      this.equal(scaled(actual.tax), line.tax, 'receipt line tax');
      this.equal(scaled(actual.price), line.price, 'receipt unit price');
      this.equal(scaled(actual.gross), line.gross, 'receipt original price');
      for (const a of line.allocations) a.batch.quantity -= a.quantity;
      if (line.labelId) this.labels.get(line.labelId).status = 'SOLD';
      line.saleItemId = actual.saleItemId;
      totals.total += line.total;
      totals.tax += line.tax;
      totals.subtotal += line.gross;
      totals.discount += line.discount;
    }
    for (const [key, value] of Object.entries(totals))
      this.equal(scaled(receipt[key]), value, 'receipt ' + key);
    const day = this.day(date);
    day.sales += totals.total;
    day.tax += totals.tax;
    day.salesTax += totals.tax;
    day.discounts += totals.discount;
    day.transactions++;
    day.soldCost += planned.reduce((n, l) => n + l.cost, 0n);
    day[receipt.payment.method] += totals.total;
    if (receipt.payment.method === 'cash')
      this.drawers.set(shiftId, this.drawers.get(shiftId) + totals.total);
    this.receipts.set(receipt.id, { ...receipt, planned });
  }
  refund(receiptId, line, quantity, restock, date, shiftId) {
    const receipt = this.receipts.get(receiptId),
      day = this.day(date);
    const delta = (value) =>
      rounded(value * (line.returned + quantity), line.quantity) -
      rounded(value * line.returned, line.quantity);
    const amount = delta(line.total),
      tax = delta(line.tax);
    let remaining = quantity,
      cost = 0n;
    for (const a of line.allocations) {
      const free = a.quantity - a.returned,
        taken = free < remaining ? free : remaining;
      if (taken <= 0n) continue;
      cost +=
        rounded(a.cost * (a.returned + taken), a.quantity) -
        rounded(a.cost * a.returned, a.quantity);
      a.returned += taken;
      remaining -= taken;
      if (restock) a.batch.quantity += taken;
    }
    assert.equal(remaining, 0n);
    line.returned += quantity;
    day.refunds += amount;
    day.returnedCost += cost;
    day.tax -= tax;
    if (!restock) day.losses += cost;
    if (receipt.payment.method === 'cash')
      this.drawers.set(shiftId, this.drawers.get(shiftId) - amount);
    return { amount, tax, cost };
  }
  remove(id, quantity, instant, loss) {
    const allocations = this.allocate(id, quantity, instant, { includeExpired: true });
    for (const a of allocations) a.batch.quantity -= a.quantity;
    const cost = allocations.reduce((n, a) => n + a.cost, 0n);
    if (loss) this.day(instant.slice(0, 10)).losses += cost;
    return cost;
  }
  financial(from, to) {
    let sales = 0n,
      refunds = 0n,
      sold = 0n,
      returned = 0n,
      losses = 0n,
      transactions = 0;
    for (const [date, d] of this.days)
      if (date >= from && date <= to) {
        sales += d.sales;
        refunds += d.refunds;
        sold += d.soldCost;
        returned += d.returnedCost;
        losses += d.losses;
        transactions += d.transactions;
      }
    let expenses = 0n;
    for (const e of this.expenses) {
      if (e.periodStart) {
        const count = (Date.parse(e.periodEnd) - Date.parse(e.periodStart)) / 86400000 + 1;
        // Allocate each cent deterministically, including non-divisible period totals.
        const before = Math.max(
          0,
          Math.min(count, (Date.parse(from) - Date.parse(e.periodStart)) / 86400000),
        );
        const through = Math.max(
          0,
          Math.min(count, (Date.parse(to) - Date.parse(e.periodStart)) / 86400000 + 1),
        );
        expenses +=
          (e.amount / BigInt(count)) * BigInt(through - before) +
          BigInt(Math.max(0, Math.min(Number(e.amount % BigInt(count)), through) - before));
      } else if (e.date >= from && e.date <= to) expenses += e.amount;
    }
    const revenue = sales - refunds,
      cogs = sold - returned,
      gross = revenue - cogs;
    const abs = gross < 0n ? -gross : gross;
    return {
      revenue: decimal(revenue),
      cogs: decimal(cogs),
      grossProfit: decimal(gross),
      grossMarginPercent:
        revenue > 0n ? decimal((gross < 0n ? -1n : 1n) * rounded(abs * 10000n, revenue)) : null,
      inventoryLosses: decimal(losses),
      operatingExpenses: decimal(expenses),
      storeOperatingProfit: decimal(gross - losses - expenses),
      transactionCount: transactions,
    };
  }
  verifyFinancial(actual, from, to) {
    const expected = this.financial(from, to);
    for (const [key, value] of Object.entries(expected))
      this.equal(actual[key], value, `${from}..${to}: ${key}`);
    this.equal(actual.dataQuality.costComplete, true, 'historical costs complete');
    this.equal(actual.dataQuality.lossCostComplete, true, 'loss costs complete');
    return expected;
  }
}
