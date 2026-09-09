import { spawnSync } from 'node:child_process';
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required.');
const result = spawnSync(process.execPath, ['apps/api/dist/migrate.js'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
