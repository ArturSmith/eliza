import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  client,
  localOnly,
  environment,
  binary,
  counts,
  migrations,
  integrity,
} from './operations-lib.mjs';
localOnly();
const mode = process.argv[2];
const c = client();
let temporary;
let created = false;
let retained = false;
let restored;
try {
  await c.connect();
  if (mode === 'create') {
    const dir = resolve('.local/backups');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = resolve(
      dir,
      new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.dump',
    );
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await migrations(c);
    const snapshot = (await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const tableCounts = await counts(c);
    writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
    try {
      execFileSync(
        binary('pg_dump'),
        ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, '--file', file],
        { env: environment(), stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        tables: tableCounts,
      };
      writeFileSync(file + '.json', JSON.stringify(manifest, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await c.query('COMMIT');
      console.log(JSON.stringify({ backup: file, manifest: file + '.json' }));
    } catch (e) {
      rmSync(file, { force: true });
      rmSync(file + '.json', { force: true });
      throw e;
    }
  } else if (mode === 'verify' || mode === 'restore-new') {
    const file = resolve(process.argv[3] ?? '');
    const manifest = JSON.parse(readFileSync(file + '.json', 'utf8'));
    if (
      manifest.version !== 1 ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== manifest.sha256
    )
      throw new Error('Backup checksum or manifest is invalid.');
    temporary =
      (mode === 'restore-new' ? 'eliza_restored_' : 'eliza_restore_check_') +
      randomUUID().replaceAll('-', '');
    await c.query(`CREATE DATABASE "${temporary}" TEMPLATE template0`);
    created = true;
    execFileSync(
      binary('pg_restore'),
      ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', temporary, file],
      { env: environment(temporary), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    restored = client(temporary);
    await restored.connect();
    const actual = await counts(restored);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
      throw new Error('Restored table counts differ from the backup snapshot.');
    await migrations(restored);
    const ledger = await integrity(restored);
    if (Object.values(ledger).some((n) => n !== 0))
      throw new Error('Restored ledger inconsistencies: ' + JSON.stringify(ledger));
    if (mode === 'restore-new') {
      await restored.query('TRUNCATE sessions,pos_sessions');
      retained = true;
    }
    console.log(
      JSON.stringify({
        verified: file,
        ...(retained ? { restoredDatabase: temporary, sessionsRevoked: true } : {}),
        tables: Object.keys(actual).length,
        ledger,
        sourceDatabaseUnchanged: true,
      }),
    );
  } else
    throw new Error(
      'Use: pnpm db:backup OR pnpm db:verify-backup <backup.dump> OR pnpm db:restore-new <backup.dump>',
    );
} catch (e) {
  console.error(
    'Backup operation failed: ' +
      (e.stderr
        ? 'PostgreSQL utility failed. Check permissions and POSTGRES_BIN compatibility.'
        : e.message),
  );
  process.exitCode = 1;
} finally {
  await restored?.end().catch(() => {});
  if (created && !retained)
    await c.query(`DROP DATABASE IF EXISTS "${temporary}" WITH (FORCE)`).catch(() => {
      console.error('Temporary restore database needs cleanup: ' + temporary);
      process.exitCode = 1;
    });
  await c.end().catch(() => {});
}
