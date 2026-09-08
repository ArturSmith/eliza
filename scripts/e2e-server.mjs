import { spawn, execFileSync } from 'node:child_process';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const name = `eliza_e2e_${process.pid}`;
await admin.pool.query(`CREATE DATABASE ${name}`);
const url = new URL(
  process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza',
);
url.pathname = `/${name}`;
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  PORT: '3002',
  APP_ORIGIN: 'http://localhost:5174',
};
let child,
  cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (child && child.exitCode === null && child.signalCode === null && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
}
try {
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env });
  child = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'inherit' });
  child.on('exit', () => {
    if (!cleaning) void cleanup().then(() => process.exit());
  });
} catch (error) {
  await cleanup();
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void cleanup().then(() => process.exit());
  });
