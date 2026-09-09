import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
export const pg = require('pg');
if (existsSync('.env')) process.loadEnvFile('.env');
export const url = new URL(
  process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza',
);
export function localOnly() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('This tool supports local PostgreSQL only.');
}
export function environment(database = decodeURIComponent(url.pathname.slice(1))) {
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
}
export function binary(name) {
  const dirs = [
    process.env.POSTGRES_BIN,
    ...[18, 17, 16, 15, 14].flatMap((v) => [
      `/opt/homebrew/opt/postgresql@${v}/bin`,
      `/usr/lib/postgresql/${v}/bin`,
    ]),
  ].filter(Boolean);
  const dir = dirs.find((d) => existsSync(`${d}/${name}`));
  if (!dir)
    throw new Error(
      `Set POSTGRES_BIN to the installed PostgreSQL bin directory (${name} required).`,
    );
  return `${dir}/${name}`;
}
export function client(database) {
  const connection = new URL(url);
  if (database) connection.pathname = '/' + database;
  return new pg.Client({ connectionString: connection.toString() });
}
export async function counts(c) {
  const tables = (
    await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const result = {};
  for (const { tablename } of tables) {
    const identifier = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (await c.query(`SELECT count(*)::text AS n FROM ${identifier}`)).rows[0].n;
  }
  return result;
}
export async function migrations(c) {
  const rows = (await c.query('SELECT name,checksum FROM schema_migrations')).rows;
  for (const file of readdirSync(resolve('apps/api/migrations')).filter((f) =>
    f.endsWith('.sql'),
  )) {
    const sum = createHash('sha256')
      .update(readFileSync(resolve('apps/api/migrations', file)))
      .digest('hex');
    if (!rows.some((r) => r.name === file && r.checksum === sum))
      throw new Error(`Migration missing or changed: ${file}. Run pnpm db:migrate.`);
  }
  return rows.length;
}
export async function integrity(c) {
  const checks = {
    stock:
      'SELECT count(*)::text AS n FROM products p WHERE p.stock<>COALESCE((SELECT sum(quantity) FROM movements m WHERE m.product_id=p.id),0)',
    sales:
      'SELECT count(*)::text AS n FROM sales s WHERE s.total<>COALESCE((SELECT sum(total) FROM sale_items i WHERE i.sale_id=s.id),0) OR s.total<>COALESCE((SELECT sum(amount) FROM payments p WHERE p.sale_id=s.id),0)',
    refunds:
      'SELECT count(*)::text AS n FROM refunds r WHERE r.total<>COALESCE((SELECT sum(total) FROM refund_lines l WHERE l.refund_id=r.id),0)',
    drawers:
      "SELECT count(*)::text AS n FROM shifts s WHERE s.status='closed' AND s.expected_cash<>COALESCE((SELECT sum(amount) FROM cash_movements c WHERE c.shift_id=s.id),0)",
    overReturns:
      'SELECT count(*)::text AS n FROM (SELECT sale_id,product_id,sum(quantity) AS qty FROM refund_lines GROUP BY sale_id,product_id) r WHERE r.qty>COALESCE((SELECT sum(quantity) FROM sale_items i WHERE i.sale_id=r.sale_id AND i.product_id=r.product_id),0)',
  };
  const result = {};
  for (const [name, sql] of Object.entries(checks))
    result[name] = Number((await c.query(sql)).rows[0].n);
  return result;
}
