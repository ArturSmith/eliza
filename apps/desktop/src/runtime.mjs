import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const exec = promisify(execFile);

export function postgresBin(explicit) {
  const candidates = [
    explicit,
    ...[18, 17, 16, 15, 14].flatMap((v) => [
      `/opt/homebrew/opt/postgresql@${v}/bin`,
      `/usr/local/opt/postgresql@${v}/bin`,
    ]),
  ].filter(Boolean);
  const bin = candidates.find((p) =>
    ['postgres', 'pg_ctl', 'initdb'].every((name) => existsSync(join(p, name))),
  );
  if (!bin)
    throw new Error(
      'PostgreSQL is not installed. Install PostgreSQL 14–18 with Homebrew, or set POSTGRES_BIN. Your store data has not been changed.',
    );
  return bin;
}

// A separate cluster and random credentials; never inherits a cloud DATABASE_URL.
export async function startDatabase({
  dataDir,
  root,
  bin = postgresBin(process.env.POSTGRES_BIN),
  port = 54339,
}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const cluster = join(dataDir, 'postgres');
  const credentials = join(dataDir, 'database-secret');
  let password;
  try {
    password = (await readFile(credentials, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existsSync(join(cluster, 'PG_VERSION')))
      throw new Error(
        'Database credentials are missing. Restore the database-secret file from your backup.',
      );
    password = randomBytes(32).toString('hex');
    await writeFile(credentials, password, { mode: 0o600, flag: 'wx' });
  }
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local database credentials.');
  await chmod(credentials, 0o600);
  const run = (name, args) =>
    exec(join(bin, name), args, { timeout: 60000, maxBuffer: 1024 * 1024 });
  if (!existsSync(join(cluster, 'PG_VERSION'))) {
    const pwFile = join(dataDir, 'init-password');
    await writeFile(pwFile, password, { mode: 0o600 });
    try {
      await run('initdb', [
        '-D',
        cluster,
        '-U',
        'eliza_desktop',
        '--auth-local=scram-sha-256',
        '--auth-host=scram-sha-256',
        `--pwfile=${pwFile}`,
        '--encoding=UTF8',
        '--locale=C',
      ]);
    } finally {
      await rm(pwFile, { force: true });
    }
  }
  const major = (await readFile(join(cluster, 'PG_VERSION'), 'utf8')).trim();
  const version = (await run('postgres', ['--version'])).stdout.match(/(\d+)\./)?.[1];
  if (major !== version)
    throw new Error(
      `This store uses PostgreSQL ${major}. Set POSTGRES_BIN to that version before opening it.`,
    );
  let running = false;
  try {
    await run('pg_ctl', ['-D', cluster, 'status']);
    running = true;
  } catch {}
  if (!running)
    await run('pg_ctl', [
      '-D',
      cluster,
      '-l',
      join(dataDir, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -k ""`,
      '-w',
      'start',
    ]);
  const stop = async () => {
    await run('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop']);
  };
  try {
    const require = createRequire(join(root, 'apps/api/package.json'));
    const { Client } = require('pg');
    const url = `postgresql://eliza_desktop:${password}@127.0.0.1:${port}/eliza`;
    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const client = new Client({ connectionString: adminUrl.toString() });
    try {
      await client.connect();
      if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='eliza'")).rowCount)
        await client.query('CREATE DATABASE eliza');
    } finally {
      await client.end();
    }
    return { url, stop };
  } catch (error) {
    if (!running) await stop().catch(() => {});
    throw error;
  }
}

export function runtimeEnvironment(url, origin) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1') throw new Error('Desktop requires a local database.');
  const local = new URL(origin);
  if (local.hostname !== '127.0.0.1' || local.protocol !== 'http:')
    throw new Error('Desktop requires a loopback origin.');
  return {
    DATABASE_URL: url,
    APP_ORIGIN: origin,
    HOST: '127.0.0.1',
    PORT: local.port,
    SERVE_WEB: 'true',
    NODE_ENV: 'production',
    ELIZA_DESKTOP: 'true',
    TRUST_PROXY: '',
    OPENAI_API_KEY: '',
    SETUP_TOKEN: '',
  };
}
