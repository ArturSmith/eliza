import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { buildPostgres, verifyPostgresRuntime, verifyRuntimeLinks } from './build-postgres.mjs';
import { createMacInstaller } from './create-mac-dmg.mjs';
if (process.platform !== 'darwin') throw new Error('Build this prototype on macOS.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const postgres = buildPostgres();
const staging = join(root, '.local/desktop-staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, 'runtime/apps'), { recursive: true });
execFileSync(
  'pnpm',
  [
    '--config.verify-deps-before-run=false',
    '--filter',
    '@eliza/api',
    'deploy',
    '--legacy',
    '--prod',
    join(staging, 'runtime/apps/api'),
  ],
  { cwd: root, stdio: 'inherit' },
);
// Legacy pnpm deploy leaves an API self-reference pointing back to the checkout.
const api = join(staging, 'runtime/apps/api');
const self = join(api, 'node_modules/.pnpm/node_modules/@eliza/api');
mkdirSync(dirname(self), { recursive: true });
rmSync(self, { force: true });
symlinkSync(relative(dirname(self), api), self);
cpSync(join(root, 'apps/web/dist'), join(staging, 'runtime/apps/web/dist'), { recursive: true });
cpSync(postgres, join(staging, 'runtime/postgres'), { recursive: true, verbatimSymlinks: true });
verifyPostgresRuntime(join(staging, 'runtime/postgres'));
const paths = await packager({
  dir: join(root, 'apps/desktop'),
  out: join(root, '.local/desktop-builds'),
  platform: 'darwin',
  arch: process.arch,
  name: 'Eliza',
  appBundleId: 'com.eliza.store',
  appCategoryType: 'public.app-category.business',
  extendInfo: {
    NSCameraUsageDescription:
      'Eliza uses the camera to scan product barcodes, employee QR codes and documents.',
  },
  overwrite: true,
  prune: false,
  ignore: [/^\/node_modules/, /^\/scripts/],
  extraResource: [join(staging, 'runtime')],
});
console.log(paths.join('\n'));
for (const path of paths) {
  // Packager resolves resource symlinks to staging paths. Preserve the deploy tree verbatim.
  const runtime = join(path, 'Eliza.app/Contents/Resources/runtime');
  rmSync(runtime, { recursive: true, force: true });
  cpSync(join(staging, 'runtime'), runtime, { recursive: true, verbatimSymlinks: true });
  verifyRuntimeLinks(runtime);
  verifyPostgresRuntime(join(runtime, 'postgres'));
  console.log(createMacInstaller(join(path, 'Eliza.app')));
}
console.log(
  'Internal unsigned preview. PostgreSQL is bundled; no separate database installation is needed. Cloud sync is not available.',
);
