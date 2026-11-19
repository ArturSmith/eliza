import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { Database } from '../apps/api/dist/database.js';
import { loyaltyFinancials } from '../apps/api/dist/loyalty-financials.js';
const source = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
if (!['127.0.0.1', 'localhost'].includes(new URL(source).hostname))
  throw new Error('Local PostgreSQL is required.');
const db = new Database();
let client: PoolClient;
const store = crypto.randomUUID(),
  otherStore = crypto.randomUUID(),
  a = crypto.randomUUID(),
  b = crypto.randomUUID();
beforeAll(async () => {
  client = await db.pool.connect();
  // The query is exercised on an isolated temporary ledger, never live history.
  await client.query(
    'CREATE TEMP TABLE loyalty_entries(store_id uuid,membership_id uuid,kind text,amount numeric(30,2),created_at timestamptz)',
  );
});
beforeEach(async () => {
  await client.query('TRUNCATE pg_temp.loyalty_entries');
});
afterAll(async () => {
  if (client) {
    await client.query('DROP TABLE pg_temp.loyalty_entries');
    client.release();
  }
  await db.onModuleDestroy();
});
async function entry(member: string, kind: string, amount: string, time: string, shop = store) {
  await client.query('INSERT INTO pg_temp.loyalty_entries VALUES($1,$2,$3,$4,$5)', [
    shop,
    member,
    kind,
    amount,
    time,
  ]);
}
const period = { from: '2026-03-29', to: '2026-03-29', timezone: 'Europe/Oslo' };
describe('loyalty finance ledger reconciliation', () => {
  it('uses store-local DST boundaries, separates refund events and excludes other shops', async () => {
    await entry(a, 'earned', '100', '2026-03-28T22:59:59Z');
    await entry(a, 'redeemed', '-20', '2026-03-28T23:00:00Z');
    await entry(a, 'refund_earned', '-3', '2026-03-29T10:00:00Z');
    await entry(a, 'refund_redeemed', '5', '2026-03-29T21:59:59Z');
    await entry(a, 'earned', '999', '2026-03-29T22:00:00Z');
    await entry(a, 'earned', '999', '2026-03-29T12:00:00Z', otherStore);
    expect(await loyaltyFinancials(client, store, period)).toMatchObject({
      issued: '0.00',
      redeemed: '20.00',
      reversed: '3.00',
      restored: '5.00',
      netRedeemed: '15.00',
      netIssued: '-3.00',
      openingAvailable: '100.00',
      closingAvailable: '82.00',
      openingNegative: '0.00',
      closingNegative: '0.00',
    });
  });
  it('does not offset positive customer balances with negative balances or truncate older activity', async () => {
    await entry(a, 'earned', '100', '2026-03-27T10:00:00Z');
    await entry(a, 'redeemed', '-100', '2026-03-29T10:00:00Z');
    await entry(a, 'refund_earned', '-40', '2026-03-29T11:00:00Z');
    await entry(b, 'earned', '30', '2026-03-29T12:00:00Z');
    await client.query(
      "INSERT INTO pg_temp.loyalty_entries SELECT $1,$2,'earned',0.01,'2026-03-29T13:00:00Z'::timestamptz FROM generate_series(1,101)",
      [store, b],
    );
    expect(await loyaltyFinancials(client, store, period)).toMatchObject({
      issued: '31.01',
      redeemed: '100.00',
      reversed: '40.00',
      restored: '0.00',
      openingAvailable: '100.00',
      closingAvailable: '31.01',
      closingNegative: '-40.00',
    });
  });
  it('returns exact zeros when there is no history', async () => {
    const result = await loyaltyFinancials(client, store, period);
    for (const [key, value] of Object.entries(result))
      if (!['valuation', 'accountingModel'].includes(key)) expect(value).toBe('0.00');
  });
});
