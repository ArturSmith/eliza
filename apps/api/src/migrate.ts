import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { databaseUrl } from './database.js';
const client = new pg.Client({ connectionString: databaseUrl() });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(734100)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const source = readFileSync(`${dir}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [
      name,
    ]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Applied migration was modified: ${name}`);
      continue;
    }
    await client.query(source);
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
      name,
      checksum,
    ]);
    console.log(`Applied ${name}`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
