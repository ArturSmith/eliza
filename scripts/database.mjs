import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve('.local/postgres');
const candidates = [
  process.env.POSTGRES_BIN,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
  '/opt/homebrew/opt/postgresql@15/bin',
  '/opt/homebrew/opt/postgresql@14/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
].filter(Boolean);
const bin = candidates.find((p) => existsSync(`${p}/pg_ctl`));
if (!bin) {
  console.error('Install PostgreSQL and set POSTGRES_BIN, or run: docker compose up -d');
  process.exit(1);
}
const run = (name, args, stdio = 'inherit') => execFileSync(`${bin}/${name}`, args, { stdio });
if (process.argv[2] === 'stop') {
  run('pg_ctl', ['-D', dir, 'stop', '-m', 'fast']);
  process.exit(0);
}
mkdirSync(resolve('.local'), { recursive: true });
if (!existsSync(`${dir}/PG_VERSION`)) {
  const password = resolve('.local/init-password');
  writeFileSync(password, 'eliza_local', { mode: 0o600 });
  try {
    run('initdb', [
      '-D',
      dir,
      '-U',
      'eliza',
      '--auth-local=trust',
      '--auth-host=scram-sha-256',
      `--pwfile=${password}`,
      '--encoding=UTF8',
      '--locale=C',
    ]);
  } finally {
    rmSync(password, { force: true });
  }
}
let running = false;
try {
  run('pg_ctl', ['-D', dir, 'status'], 'ignore');
  running = true;
} catch {}
if (!running)
  run('pg_ctl', [
    '-D',
    dir,
    '-l',
    resolve('.local/postgres.log'),
    '-o',
    '-h 127.0.0.1 -p 54329 -k /tmp',
    '-w',
    'start',
  ]);
const env = { ...process.env, PGPASSWORD: 'eliza_local' };
const query = execFileSync(
  `${bin}/psql`,
  [
    '-h',
    '127.0.0.1',
    '-p',
    '54329',
    '-U',
    'eliza',
    '-d',
    'postgres',
    '-tAc',
    "SELECT 1 FROM pg_database WHERE datname='eliza'",
  ],
  { env, encoding: 'utf8' },
).trim();
if (query !== '1')
  execFileSync(`${bin}/createdb`, ['-h', '127.0.0.1', '-p', '54329', '-U', 'eliza', 'eliza'], {
    env,
    stdio: 'inherit',
  });
console.log('Local PostgreSQL ready on 127.0.0.1:54329. Data stays in .local/postgres.');
