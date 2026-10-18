// Restore to a new store directory only; never replace the active store.
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { startDatabase } from '../src/runtime.mjs';
import { readArchive, restoreEmptyStore } from '../src/backup.mjs';
const [input, directory] = process.argv.slice(2);
if (!input || !directory)
  throw new Error(
    'Usage: node apps/desktop/scripts/restore-store.mjs <backup.elizabackup> <new-store-directory>',
  );
const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = resolve(input),
  dataDir = resolve(directory);
let database,
  created = false,
  success = false;
try {
  await readArchive(file);
  await mkdir(dataDir, { mode: 0o700 });
  created = true;
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', done);
  });
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  database = await startDatabase({ root, dataDir, port });
  const result = await restoreEmptyStore({ root, url: database.url, file, bin: database.bin });
  success = true;
  console.log(
    JSON.stringify({
      restoredDirectory: dataDir,
      ...result,
      originalStoreUnchanged: true,
      sessionsRevoked: true,
    }),
  );
} catch {
  console.error(
    'Restore failed. Use your own valid backup and a new directory. Existing stores were not changed.',
  );
  process.exitCode = 1;
} finally {
  await database?.stop();
  if (created && !success) await rm(dataDir, { recursive: true, force: true });
}
