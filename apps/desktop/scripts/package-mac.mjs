import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
if (process.platform !== 'darwin') throw new Error('Build this prototype on macOS.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const staging = join(root, '.local/desktop-staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, 'runtime/apps'), { recursive: true });
execFileSync(
  'pnpm',
  ['--filter', '@eliza/api', 'deploy', '--legacy', '--prod', join(staging, 'runtime/apps/api')],
  { cwd: root, stdio: 'inherit' },
);
cpSync(join(root, 'apps/web/dist'), join(staging, 'runtime/apps/web/dist'), { recursive: true });
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
console.log(
  'Internal unsigned prototype. PostgreSQL must be installed on the target Mac. Cloud sync is not available.',
);
