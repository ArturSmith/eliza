import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  link,
  chmod,
  copyFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { postgresBin } from './runtime.mjs';
const exec = promisify(execFile);
const MAGIC = 'ELIZA-BACKUP-1 ';
function connection(root, url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1') throw new Error('Only local stores are supported.');
  const { Client } = createRequire(join(root, 'apps/api/package.json'))('pg');
  return new Client({ connectionString: url });
}
function environment(url) {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
}
async function hashFile(file, start = 0) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { start })) hash.update(chunk);
  return hash.digest('hex');
}
async function counts(client) {
  const names = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const result = {};
  for (const name of names) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unexpected table name.');
    result[name] = (await client.query(`SELECT count(*)::text AS n FROM "${name}"`)).rows[0].n;
  }
  return result;
}
async function migrations(client, root) {
  const rows = (await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name'))
    .rows;
  if (!rows.length) throw new Error('No application schema found in backup.');
  for (const row of rows) {
    if (!/^\d+_[a-z0-9_]+\.sql$/.test(row.name)) throw new Error('Invalid migration name.');
    const source = await readFile(join(root, 'apps/api/migrations', row.name));
    if (createHash('sha256').update(source).digest('hex') !== row.checksum)
      throw new Error('Backup schema does not match this application version.');
  }
  return rows;
}
export async function needsMigration({ root, url }) {
  const client = connection(root, url);
  try {
    await client.connect();
    const exists = (await client.query("SELECT to_regclass('public.schema_migrations') AS name"))
      .rows[0].name;
    if (!exists) return false; // Fresh, empty cluster has nothing to protect yet.
    const applied = await migrations(client, root);
    const files = (await readdir(join(root, 'apps/api/migrations'))).filter((n) =>
      n.endsWith('.sql'),
    );
    return files.some((n) => !applied.some((r) => r.name === n));
  } finally {
    await client.end();
  }
}

// Metadata and dump share one exported MVCC snapshot, even while checkout is active.
export async function createBackup({
  root,
  url,
  destination,
  reason = 'manual',
  bin = postgresBin(process.env.POSTGRES_BIN, { root }),
}) {
  const dir = join(destination, '..');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(dir, '.eliza-backup-'));
  const dump = join(temporary, 'store.dump');
  const archive = join(temporary, 'archive');
  const client = connection(root, url);
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const schema = await migrations(client, root);
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables = await counts(client);
    await (await open(dump, 'wx', 0o600)).close();
    await exec(
      join(bin, 'pg_dump'),
      ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, '--file', dump],
      { env: environment(url), timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
    );
    await client.query('COMMIT');
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      reason,
      sha256: await hashFile(dump),
      tables,
      migrations: schema,
    };
    const out = createWriteStream(archive, { flags: 'wx', mode: 0o600 });
    out.write(MAGIC + JSON.stringify(manifest) + '\n');
    await pipeline(createReadStream(dump), out);
    const handle = await open(archive, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Never silently replace an existing backup.
    await publishArchive(archive, destination);
    return manifest;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function publishArchive(archive, destination) {
  try {
    await link(archive, destination);
  } catch (error) {
    // exFAT/FAT USB volumes do not support hard links. Keep exclusive creation;
    // interruption leaves a partial file that fails checksum verification.
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
    await copyFile(archive, destination, constants.COPYFILE_EXCL);
    const copy = await open(destination, 'r+');
    try {
      await copy.sync();
    } finally {
      await copy.close();
    }
  }
}

export async function readArchive(file) {
  const handle = await open(file, 'r');
  let header;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0 || !buffer.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC)))
      throw new Error('Not an Eliza backup.');
    header = {
      manifest: JSON.parse(buffer.subarray(MAGIC.length, end).toString('utf8')),
      offset: end + 1,
    };
  } finally {
    await handle.close();
  }
  const m = header.manifest;
  if (
    m.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !m.tables ||
    typeof m.tables !== 'object'
  )
    throw new Error('Invalid backup metadata.');
  if ((await hashFile(file, header.offset)) !== m.sha256)
    throw new Error('Backup checksum failed. The file is damaged or incomplete.');
  return header;
}
async function unpack(file, destination) {
  const header = await readArchive(file);
  await pipeline(
    createReadStream(file, { start: header.offset }),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  // Hash again after copying, so replacement of the input file cannot bypass verification.
  if ((await hashFile(destination)) !== header.manifest.sha256)
    throw new Error('Backup changed during verification.');
  return header.manifest;
}
async function checkRestored(client, manifest, root) {
  const actual = await counts(client);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
    throw new Error('Restored table counts differ from the backup snapshot.');
  const applied = await migrations(client, root);
  if (JSON.stringify(applied) !== JSON.stringify(manifest.migrations))
    throw new Error('Restored migration history differs from the archive.');
  return {
    tables: Object.keys(actual).length,
    sales: actual.sales ?? '0',
    products: actual.products ?? '0',
  };
}
export async function verifyBackup({
  root,
  url,
  file,
  bin = postgresBin(process.env.POSTGRES_BIN, { root }),
}) {
  const temporary = await mkdtemp(join(tmpdir(), 'eliza-verify-'));
  const dump = join(temporary, 'store.dump');
  const name = 'eliza_verify_' + randomUUID().replaceAll('-', '');
  const admin = connection(root, url);
  let created = false,
    restored;
  try {
    const manifest = await unpack(file, dump);
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(url);
    target.pathname = '/' + name;
    await exec(
      join(bin, 'pg_restore'),
      ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', name, dump],
      { env: environment(target.toString()), timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
    );
    restored = connection(root, target.toString());
    await restored.connect();
    return { ...(await checkRestored(restored, manifest, root)), createdAt: manifest.createdAt };
  } finally {
    await restored?.end();
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
export async function restoreEmptyStore({
  root,
  url,
  file,
  bin = postgresBin(process.env.POSTGRES_BIN, { root }),
}) {
  const temporary = await mkdtemp(join(tmpdir(), 'eliza-restore-'));
  const client = connection(root, url);
  try {
    const dump = join(temporary, 'store.dump');
    const manifest = await unpack(file, dump);
    await client.connect();
    if ((await client.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).rowCount)
      throw new Error('Restore requires a new empty store. Existing stores are never overwritten.');
    await exec(
      join(bin, 'pg_restore'),
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        '--dbname',
        decodeURIComponent(new URL(url).pathname.slice(1)),
        dump,
      ],
      { env: environment(url), timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
    );
    const result = await checkRestored(client, manifest, root);
    // Restored copies require fresh login/enrollment. Never clone device bearer sessions.
    const sessionTables = ['sessions', 'pos_sessions', 'price_tag_sessions'];
    const present = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
        [sessionTables],
      )
    ).rows.map((r) => '"' + r.tablename + '"');
    if (present.length) await client.query('TRUNCATE ' + present.join(','));
    return result;
  } finally {
    await client.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function automaticBackup({
  root,
  url,
  dataDir,
  reason = 'automatic',
  bin = postgresBin(process.env.POSTGRES_BIN, { root, dataDir }),
}) {
  const directory = join(dataDir, 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = join(
    directory,
    'auto-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.elizabackup',
  );
  const manifest = await createBackup({ root, url, destination: file, reason, bin });
  const names = (await readdir(directory))
    .filter((n) => /^auto-\d{4}-.*\.elizabackup$/.test(n))
    .sort()
    .reverse();
  for (const old of names.slice(48)) await rm(join(directory, old));
  return { file, manifest };
}
