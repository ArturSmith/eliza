// macOS-only: first build with pnpm desktop:postgres. Uses disposable stores only.
import { strict as assert } from 'node:assert';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { startDatabase, postgresBin } from '../../apps/desktop/src/runtime.mjs';
import {
  runtimeDirectory,
  verifyPostgresRuntime,
} from '../../apps/desktop/scripts/build-postgres.mjs';

const root = resolve('.');
const { Client } = createRequire(join(root, 'apps/api/package.json'))('pg');
const directory = await mkdtemp(join(tmpdir(), 'Eliza embedded database '));
const relocated = join(directory, 'Moved application/runtime');
const oldPath = process.env.PATH;
let running;
try {
  await cp(runtimeDirectory, join(relocated, 'postgres'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  verifyPostgresRuntime(join(relocated, 'postgres'));
  for (const major of ['17', '14']) {
    const dataDir = join(directory, `store-${major}`);
    const options = { root: relocated, dataDir, packaged: true };
    const bundled = join(relocated, 'postgres', major, 'bin');
    const homebrew = '/opt/homebrew/opt/postgresql@14/bin';
    // If available, create the old preview format with the original Homebrew build.
    const firstBin = major === '14' && existsSync(join(homebrew, 'postgres')) ? homebrew : bundled;
    running = await startDatabase({ root, dataDir, bin: firstBin, port: 54341 });
    let client = new Client({ connectionString: running.url });
    try {
      await client.connect();
      await client.query(
        'CREATE TABLE retained_sale(id integer PRIMARY KEY, revenue numeric(14,2), cost numeric(14,2))',
      );
      await client.query('INSERT INTO retained_sale VALUES(1,70,59)');
    } finally {
      await client.end();
    }
    await running.stop();
    running = undefined;
    const credentials = await readFile(join(dataDir, 'database-secret'));
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    assert.equal(postgresBin('/nonexistent-system-postgres', options), bundled);
    running = await startDatabase({
      root,
      dataDir,
      bin: postgresBin(undefined, options),
      port: 54341,
    });
    client = new Client({ connectionString: running.url });
    try {
      await client.connect();
      assert.equal(
        (await client.query('SHOW server_version')).rows[0].server_version.split('.')[0],
        major,
      );
      assert.deepEqual((await client.query('SELECT revenue,cost FROM retained_sale')).rows[0], {
        revenue: '70.00',
        cost: '59.00',
      });
      assert.deepEqual(await readFile(join(dataDir, 'database-secret')), credentials);
      // A wrong-major runtime must not modify or initialize this store.
      const wrongBin = join(relocated, 'postgres', major === '14' ? '17' : '14', 'bin');
      await assert.rejects(
        startDatabase({ root, dataDir, bin: wrongBin, port: 54342 }),
        /does not match/,
      );
    } finally {
      await client.end();
    }
    await running.stop();
    running = undefined;
    console.log(
      `PASS: relocated PostgreSQL ${major}, existing data retained, no system PATH dependency, incompatible runtime refused.`,
    );
  }
} finally {
  process.env.PATH = oldPath;
  await running?.stop();
  await rm(directory, { recursive: true, force: true });
}
