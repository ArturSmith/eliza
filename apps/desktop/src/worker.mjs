import { pathToFileURL } from 'node:url';
import { trackHttpShutdown } from './http-shutdown.mjs';
import { startDatabase, runtimeEnvironment, DatabaseRuntimeError } from './runtime.mjs';
import { automaticBackup, createBackup, verifyBackup, needsMigration } from './backup.mjs';
const root = process.env.ELIZA_RUNTIME_ROOT;
let database,
  server,
  closing = false;
let jobs = Promise.resolve(),
  backupTimer,
  closeHttp;
const dataDir = process.env.ELIZA_DATA_DIR;
function enqueue(job) {
  const result = jobs.then(job);
  jobs = result.catch(() => {});
  return result;
}
function backup(reason) {
  return automaticBackup({ root, url: database.url, dataDir, reason, bin: database.bin });
}
const send = (message) => process.parentPort?.postMessage(message);
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(backupTimer);
  try {
    await closeHttp?.();
    await server?.close();
    await jobs;
    if (database && server) await backup('shutdown').catch(() => send({ type: 'backup-warning' }));
    await database?.stop();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.parentPort?.on('message', (event) => {
  if (event.data === 'stop') {
    void stop();
    return;
  }
  const request = event.data;
  if (closing || !server || !['backup', 'verify'].includes(request?.type)) return;
  void enqueue(async () => {
    try {
      const result =
        request.type === 'backup'
          ? await createBackup({
              root,
              url: database.url,
              destination: request.file,
              bin: database.bin,
            })
          : await verifyBackup({ root, url: database.url, file: request.file, bin: database.bin });
      send({ type: 'operation-result', id: request.id, ok: true, result });
    } catch {
      send({ type: 'operation-result', id: request.id, ok: false });
    }
  });
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop());
try {
  database = await startDatabase({ root, dataDir });
  if (await needsMigration({ root, url: database.url })) {
    const saved = await backup('before-migration');
    await verifyBackup({ root, url: database.url, file: saved.file, bin: database.bin });
  }
  Object.assign(process.env, runtimeEnvironment(database.url, 'http://127.0.0.1:37931'));
  // Each release applies the existing transactional, checksum-verified migrations.
  await import(pathToFileURL(`${root}/apps/api/dist/migrate.js`).href);
  const { createApp } = await import(pathToFileURL(`${root}/apps/api/dist/app.js`).href);
  server = await createApp();
  closeHttp = trackHttpShutdown(server.getHttpServer());
  await server.listen(37931, '127.0.0.1');
  const initialBackup = await backup('startup');
  backupTimer = setInterval(
    () => {
      if (!closing)
        void enqueue(() => backup('automatic'))
          .then((saved) => send({ type: 'backup-ok', createdAt: saved.manifest.createdAt }))
          .catch(() => send({ type: 'backup-warning' }));
    },
    30 * 60 * 1000,
  );
  send({
    type: 'ready',
    origin: process.env.APP_ORIGIN,
    backupAt: initialBackup.manifest.createdAt,
  });
} catch (error) {
  // Do not forward raw database errors: they can include credentials or personal data.
  send({
    type: 'error',
    message:
      error instanceof DatabaseRuntimeError
        ? error.message
        : 'Local store could not start. Check available ports 37931/54339 and server.log in the store data folder. Existing store data is retained.',
  });
  await stop();
}
