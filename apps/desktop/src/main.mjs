import { app, BrowserWindow, dialog, Menu, shell, utilityProcess, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, openSync, closeSync, writeSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = app.isPackaged
  ? join(process.resourcesPath, 'runtime')
  : fileURLToPath(new URL('../../../', import.meta.url));
app.setName('Eliza');
// Stable path: upgrades and source checkouts use the same local store, not the dev DB.
app.setPath(
  'userData',
  process.env.ELIZA_DESKTOP_DATA_DIR || join(app.getPath('appData'), 'Eliza Desktop'),
);
const origin = 'http://127.0.0.1:37931';
const pendingOperations = new Map();
let backupBusy = false;
async function authorizeBackupAccess() {
  if (!window || window.isDestroyed()) return false;
  // The main process verifies the server session itself. Never trust renderer JS
  // to report its own permissions (it can replace window.fetch).
  const allowed = await (async () => {
    const cookies = await window.webContents.session.cookies.get({
      url: origin + '/api/auth/session',
    });
    const response = await fetch(origin + '/api/auth/session', {
      headers: {
        Cookie: cookies
          .filter((c) => ['eliza_session', 'eliza_device'].includes(c.name))
          .map((c) => c.name + '=' + c.value)
          .join('; '),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const current = await response.json();
    return !!current.user?.permissions?.includes('settings.manage');
  })().catch(() => false);
  if (!allowed) {
    await dialog.showMessageBox(window, {
      type: 'info',
      message: 'Open Management and sign in with store settings access to manage backups.',
    });
    return false;
  }
  return true;
}
async function openStoreFolder(path) {
  if (await authorizeBackupAccess()) await shell.openPath(path);
}
async function backupAction(kind) {
  if (backupBusy || !worker || !(await authorizeBackupAccess())) return;
  if (backupBusy) return;
  backupBusy = true;
  try {
    let file;
    if (kind === 'backup') {
      const chosen = await dialog.showSaveDialog(window, {
        title: 'Save private store backup',
        defaultPath: 'Eliza-' + new Date().toISOString().slice(0, 10) + '.elizabackup',
        filters: [{ name: 'Eliza backup', extensions: ['elizabackup'] }],
      });
      if (chosen.canceled) return;
      file = chosen.filePath;
    } else {
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Verify your store backup',
        filters: [{ name: 'Eliza backup', extensions: ['elizabackup'] }],
        properties: ['openFile'],
      });
      if (chosen.canceled) return;
      file = chosen.filePaths[0];
    }
    const result = await new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(
        () => {
          pendingOperations.delete(id);
          reject(new Error('Backup operation timed out.'));
        },
        15 * 60 * 1000,
      );
      pendingOperations.set(id, { resolve, reject, timeout });
      worker.postMessage({ type: kind, id, file });
    });
    if (quitting || window.isDestroyed()) return;
    await dialog.showMessageBox(window, {
      type: 'info',
      message:
        kind === 'backup'
          ? 'Backup saved. Keep an additional copy on another device.'
          : 'Backup restored successfully into a temporary database and verified.',
      detail:
        kind === 'backup'
          ? 'The file contains private store information. Treat it like the store database.'
          : `${result.tables} tables verified; ${result.sales} sales. Your current store was not changed.`,
    });
  } catch {
    if (quitting || window.isDestroyed()) return;
    await dialog.showMessageBox(window, {
      type: 'error',
      message: 'Backup operation failed. The current store was not changed.',
      detail:
        'Check available disk space, PostgreSQL compatibility, and the selected file. Existing backup files are never overwritten.',
    });
  } finally {
    backupBusy = false;
  }
}
let worker,
  window,
  quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!worker || quitting) return;
    event.preventDefault();
    quitting = true;
    const timeout = setTimeout(
      () => {
        worker?.kill();
        app.exit(1);
      },
      15 * 60 * 1000,
    );
    worker.once('exit', () => {
      clearTimeout(timeout);
      worker = undefined;
      app.quit();
    });
    worker.postMessage('stop');
  });
  void app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Eliza',
            submenu: [
              { role: 'about' },
              { label: 'Local store — no cloud sync', enabled: false },
              { id: 'backup-status', label: 'Automatic backups: starting…', enabled: false },
              { label: 'Save store backup…', click: () => void backupAction('backup') },
              { label: 'Verify store backup…', click: () => void backupAction('verify') },
              {
                label: 'Show automatic backups',
                click: () => void openStoreFolder(join(app.getPath('userData'), 'backups')),
              },
              {
                label: 'Show store data',
                click: () => void openStoreFolder(app.getPath('userData')),
              },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
      // No Node bridge is exposed to the renderer. Only our loopback server is trusted.
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
        callback(
          contents.getURL().startsWith(origin + '/') &&
            ['media', 'fullscreen'].includes(permission),
        );
      });
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const local = details.url.startsWith(origin + '/');
        callback({ cancel: !local && !/^(data:|blob:)/.test(details.url) });
      });
      mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
      const log = openSync(join(app.getPath('userData'), 'server.log'), 'a', 0o600);
      worker = utilityProcess.fork(join(here, 'worker.mjs'), [], {
        env: { ...process.env, ELIZA_RUNTIME_ROOT: root, ELIZA_DATA_DIR: app.getPath('userData') },
        stdio: 'pipe',
        serviceName: 'Eliza Local Store',
      });
      worker.stdout.on('data', (chunk) => writeSync(log, chunk));
      worker.stderr.on('data', (chunk) => writeSync(log, chunk));
      let ready = false;
      const timer = setTimeout(
        () => {
          if (!ready) {
            dialog.showErrorBox(
              'Eliza',
              'Local store startup timed out. Check PostgreSQL installation and server.log in the store data folder.',
            );
            app.quit();
          }
        },
        15 * 60 * 1000,
      );
      let errorReported = false;
      worker.on('message', async (message) => {
        if (message.type === 'operation-result') {
          const pending = pendingOperations.get(message.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingOperations.delete(message.id);
            message.ok
              ? pending.resolve(message.result)
              : pending.reject(new Error('Backup failed.'));
          }
          return;
        }
        if (message.type === 'backup-ok') {
          const status = Menu.getApplicationMenu()?.getMenuItemById('backup-status');
          if (status)
            status.label = 'Last automatic backup: ' + new Date(message.createdAt).toLocaleString();
          if (window && !window.isDestroyed())
            window.setTitle('Eliza — Local store · No cloud sync');
          return;
        }
        if (message.type === 'backup-warning') {
          const status = Menu.getApplicationMenu()?.getMenuItemById('backup-status');
          if (status) status.label = 'Automatic backup failed — save a copy';
          if (window && !window.isDestroyed())
            window.setTitle('Eliza — Automatic backup failed · Check store backup');
          return;
        }
        if (message.type === 'error') {
          errorReported = true;
          clearTimeout(timer);
          dialog.showErrorBox('Eliza', message.message);
          app.quit();
          return;
        }
        if (message.type !== 'ready' || ready) return;
        ready = true;
        const status = Menu.getApplicationMenu()?.getMenuItemById('backup-status');
        if (status)
          status.label = 'Last automatic backup: ' + new Date(message.backupAt).toLocaleString();
        clearTimeout(timer);
        window = new BrowserWindow({
          width: 1440,
          height: 950,
          minWidth: 900,
          minHeight: 650,
          title: 'Eliza — Local store · No cloud sync',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            spellcheck: false,
          },
        });
        window.webContents.on('will-navigate', (event, url) => {
          if (new URL(url).origin !== origin) event.preventDefault();
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('page-title-updated', (event) => event.preventDefault());
        await window.loadURL(origin);
        window.show();
      });
      worker.on('exit', (code) => {
        clearTimeout(timer);
        closeSync(log);
        for (const pending of pendingOperations.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Local server stopped.'));
        }
        pendingOperations.clear();
        if (!quitting && !errorReported) {
          dialog.showErrorBox(
            'Eliza',
            'The local store server stopped. Reopen Eliza to recover. Do not recreate a payment whose result is unknown; check Sales first.',
          );
          app.quit();
        }
      });
    })
    .catch(() => {
      dialog.showErrorBox('Eliza', 'Desktop startup failed. Existing local data is retained.');
      app.quit();
    });
}
