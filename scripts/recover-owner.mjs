import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync, createHash } from 'node:crypto';
import { client, localOnly } from './operations-lib.mjs';
localOnly();
const email = process.argv[2];
if (!email || process.argv[3] !== '--confirm-local-recovery') {
  console.error(
    'Use: pnpm account:recover <owner-email> --confirm-local-recovery. This replaces the password and revokes that owner’s sessions.',
  );
  process.exit(1);
}
const c = client();
let output;
let committed = false;
let commitAttempted = false;
try {
  await c.connect();
  await c.query('BEGIN');
  const user = (
    await c.query(
      'SELECT e.id,e.store_id FROM employees e JOIN roles r ON r.id=e.role_id AND r.store_id=e.store_id WHERE lower(e.email)=lower($1) AND e.active AND r.permissions @> \'["settings.manage","team.manage"]\'::jsonb FOR UPDATE OF e',
      [email],
    )
  ).rows[0];
  if (!user)
    throw new Error(
      'No active owner with that email. Recovery will not reactivate disabled accounts.',
    );
  const password = randomBytes(24).toString('base64url'),
    salt = randomBytes(16).toString('hex'),
    encoded = salt + ':' + scryptSync(password, salt, 64).toString('hex');
  const device = (
    await c.query(
      "INSERT INTO devices(store_id,name,type,token_hash,active) VALUES($1,'Local account recovery','management',$2,false) RETURNING id",
      [user.store_id, createHash('sha256').update(randomBytes(32)).digest('hex')],
    )
  ).rows[0];
  await c.query('UPDATE employees SET password_hash=$2 WHERE id=$1', [user.id, encoded]);
  await c.query('DELETE FROM sessions WHERE employee_id=$1', [user.id]);
  await c.query('DELETE FROM pos_sessions WHERE employee_id=$1', [user.id]);
  await c.query(
    "INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,'Owner password recovered locally',$2,$4)",
    [
      user.store_id,
      user.id,
      device.id,
      JSON.stringify({ source: 'local recovery command', sessionsRevoked: true }),
    ],
  );
  mkdirSync(resolve('.local/recovery'), { recursive: true, mode: 0o700 });
  output = resolve('.local/recovery', randomUUID() + '.txt');
  writeFileSync(output, password + '\n', { flag: 'wx', mode: 0o600 });
  commitAttempted = true;
  await c.query('COMMIT');
  committed = true;
  console.log(
    JSON.stringify({
      credentialFile: output,
      sessionsRevoked: true,
      instruction:
        'Read this private file locally, store the password securely, then delete the file. POS PIN is unchanged.',
    }),
  );
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  if (output && !committed && !commitAttempted) rmSync(output, { force: true });
  console.error('Recovery failed: ' + e.message);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
