import { client, localOnly, binary, migrations, integrity, url } from './operations-lib.mjs';
localOnly();
const c = client();
try {
  await c.connect();
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const applied = await migrations(c),
    ledger = await integrity(c);
  const role = (await c.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
  binary('pg_dump');
  binary('pg_restore');
  console.log(
    JSON.stringify(
      {
        scope: 'local operation',
        migrations: applied,
        ledger,
        backupTools: true,
        productionReady: false,
        notes: [
          ...(role.rolsuper
            ? ['Database account is a superuser; use a restricted role before deployment.']
            : []),
          ...(url.password === 'eliza_local' ? ['Development database password is in use.'] : []),
          'Backups need an off-device copy and periodic restore verification.',
          'Card payments and refunds use an external terminal; fiscal and hardware integration are not verified.',
        ],
      },
      null,
      2,
    ),
  );
  if (Object.values(ledger).some((n) => n !== 0)) process.exitCode = 1;
  await c.query('COMMIT');
} catch (e) {
  console.error('Readiness check failed: ' + e.message);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
