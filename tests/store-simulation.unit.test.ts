import { describe, it, expect } from 'vitest';
import { clockSql, simulationTarget } from '../scripts/simulation/clock.mjs';
import { Ledger, scaled, decimal, random } from '../scripts/simulation/ledger.mjs';

describe('simulation isolation and virtual clock SQL', () => {
  it('refuses real store databases and remote hosts', () => {
    for (const url of [
      'postgresql://localhost/eliza',
      'postgresql://railway.example/eliza_sim_test',
      'postgresql://localhost/eliza_sim_test;DROP%20DATABASE',
      'https://localhost/eliza_sim_test',
      'postgresql://localhost/eliza_sim_test?host=remote.example',
      'postgresql://localhost/eliza_sim_test?host=127.0.0.2',
      'postgresql://localhost/eliza_sim_test?host=%72emote.example',
    ])
      expect(() => simulationTarget(url)).toThrow();
    expect(simulationTarget('postgresql://127.0.0.1:54329/eliza_sim_test').pathname).toBe(
      '/eliza_sim_test',
    );
  });
  it('changes clock expressions without changing text, identifiers, comments or function literals', () => {
    expect(
      clockSql(`SELECT now(), CURRENT_TIMESTAMP, current_date, pg_catalog.now(), transaction_timestamp(), statement_timestamp(),
      'now() and current_date', "now", $$ SELECT now() $$, $body$ CURRENT_TIMESTAMP $body$
      /* now() */ -- current_date
      FROM products WHERE created_at < now() - interval '30 days'`),
    ).toBe(
      `SELECT eliza_simulation.now(), eliza_simulation.now(), (eliza_simulation.now()::date), eliza_simulation.now(), eliza_simulation.now(), eliza_simulation.now(),
      'now() and current_date', "now", $$ SELECT now() $$, $body$ CURRENT_TIMESTAMP $body$
      /* now() */ -- current_date
      FROM products WHERE created_at < eliza_simulation.now() - interval '30 days'`,
    );
    const once = clockSql("SELECT now(), 'customer''s now()'");
    expect(clockSql(once)).toBe(once);
  });
});

describe('independent simulation ledger', () => {
  it('uses exact decimal quantities and reproducible scenario randomness', () => {
    expect(scaled('-1.25', 3)).toBe(-1250n);
    expect(decimal(-1250n, 3)).toBe('-1.250');
    const a = random(42),
      b = random(42),
      c = random(43);
    const sequence = Array.from({ length: 10 }, () => a());
    expect(sequence).toEqual(Array.from({ length: 10 }, () => b()));
    expect(sequence).not.toEqual(Array.from({ length: 10 }, () => c()));
  });
  it('preserves base price while choosing promotions, excluding expired and reserved batch stock', () => {
    const ledger = new Ledger();
    ledger.addProduct({ id: 'yogurt', price: 7000n, tax: 0n, category: 'Dairy' });
    ledger.receive('yogurt', {
      id: 'expired',
      quantity: 1000n,
      cost: 5800n,
      expiry: '2026-10-01',
      createdAt: '2026-09-01',
    });
    ledger.receive('yogurt', {
      id: 'early',
      quantity: 2000n,
      cost: 5900n,
      expiry: '2026-10-03',
      createdAt: '2026-09-02',
    });
    ledger.receive('yogurt', {
      id: 'late',
      quantity: 5000n,
      cost: 6000n,
      expiry: '2026-10-04',
      createdAt: '2026-09-02',
    });
    const instant = '2026-10-02T10:00:00Z';
    ledger.promotions.push({
      category: 'Dairy',
      type: 'PERCENTAGE',
      value: 1000n,
      start: '2026-10-01',
      end: '2026-10-05',
    });
    ledger.promotions.push({
      productId: 'yogurt',
      type: 'FIXED_PRICE',
      value: 6000n,
      start: '2026-10-01',
      end: '2026-10-05',
    });
    ledger.labels.set('label', {
      batchId: 'early',
      price: 5500n,
      status: 'AVAILABLE',
      validUntil: '2026-10-02T20:00:00Z',
    });
    expect(ledger.free('yogurt', instant)).toBe(6000n);
    const regular = ledger.line('yogurt', 2000n, instant);
    expect(regular.price).toBe(6000n);
    expect(regular.cost).toBe(11900n); // one unit at 59, one at 60
    expect(regular.allocations.map((a) => a.batch.id)).toEqual(['early', 'late']);
    const label = ledger.line('yogurt', 1000n, instant, 'label');
    expect(label.total).toBe(5500n);
    expect(label.gross).toBe(7000n);
    expect(label.discount).toBe(1500n);
    expect(label.cost).toBe(5900n);
    expect(ledger.price('yogurt', '2026-10-06T10:00:00Z')).toBe(7000n);
  });
  it('reconciles partial refunds across batch costs, returned stock and non-resellable losses', () => {
    const ledger = new Ledger();
    ledger.addProduct({ id: 'apples', price: 100n, tax: 0n, category: 'Fruit' });
    ledger.receive('apples', {
      id: 'a',
      quantity: 333n,
      cost: 51n,
      expiry: null,
      createdAt: '2026-09-01',
    });
    ledger.receive('apples', {
      id: 'b',
      quantity: 667n,
      cost: 60n,
      expiry: null,
      createdAt: '2026-09-02',
    });
    const line = ledger.line('apples', 1000n, '2026-10-01T10:00:00Z');
    expect(line.cost).toBe(57n);
    for (const a of line.allocations) a.batch.quantity -= a.quantity;
    ledger.receipts.set('receipt', { payment: { method: 'card' }, planned: [line] });
    const first = ledger.refund('receipt', line, 333n, true, '2026-10-02', 'drawer');
    const second = ledger.refund('receipt', line, 667n, false, '2026-10-02', 'drawer');
    expect(first).toEqual({ amount: 33n, tax: 0n, cost: 17n });
    expect(second).toEqual({ amount: 67n, tax: 0n, cost: 40n });
    expect(ledger.stock('apples')).toBe(333n);
    expect(ledger.financial('2026-10-02', '2026-10-02')).toMatchObject({
      revenue: '-1.00',
      cogs: '-0.57',
      inventoryLosses: '0.40',
      storeOperatingProfit: '-0.83',
    });
  });
  it('allocates a period expense cent-exactly across daily and monthly reports', () => {
    const ledger = new Ledger();
    ledger.expenses.push({ amount: 100n, periodStart: '2026-10-01', periodEnd: '2026-10-03' });
    expect(ledger.financial('2026-10-01', '2026-10-01').operatingExpenses).toBe('0.34');
    expect(ledger.financial('2026-10-02', '2026-10-02').operatingExpenses).toBe('0.33');
    expect(ledger.financial('2026-10-01', '2026-10-03').operatingExpenses).toBe('1.00');
    expect(ledger.financial('2026-09-01', '2026-09-30').operatingExpenses).toBe('0.00');
  });
});
