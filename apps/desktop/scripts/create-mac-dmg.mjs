import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeLinks } from './build-postgres.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export function createMacInstaller(appPath) {
  if (process.platform !== 'darwin') throw new Error('Create the Mac installer on macOS.');
  verifyRuntimeLinks(appPath);
  const stage = join(root, '.local/desktop-installer');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  execFileSync('/usr/bin/ditto', [appPath, join(stage, 'Eliza.app')]);
  symlinkSync('/Applications', join(stage, 'Applications'));
  writeFileSync(
    join(stage, 'Read me.txt'),
    `Eliza for macOS — Apple ${process.arch === 'arm64' ? 'Silicon' : 'Intel'} preview\n\nDrag Eliza.app to Applications, then open it. PostgreSQL is included and starts automatically. No Homebrew or database installation is needed.\n\nThis is an unsigned, unnotarized preview. macOS may require explicit permission in System Settings > Privacy & Security. Only allow an app you obtained from a trusted source.\n\nThe store runs locally and works without internet. Railway/cloud synchronization is not implemented. Local store data and automatic backups are kept under ~/Library/Application Support/Eliza Desktop, outside the app. Keep a separate verified backup.\n`,
  );
  const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  const image = join(root, '.local/desktop-builds', `Eliza-${version}-${process.arch}.dmg`);
  execFileSync(
    '/usr/bin/hdiutil',
    [
      'create',
      '-volname',
      'Eliza',
      '-srcfolder',
      stage,
      '-fs',
      'HFS+',
      '-format',
      'UDZO',
      '-ov',
      image,
    ],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/hdiutil', ['verify', image], { stdio: 'inherit' });
  const hash = createHash('sha256').update(readFileSync(image)).digest('hex');
  writeFileSync(image + '.sha256', `${hash}  ${image.split('/').at(-1)}\n`);
  rmSync(stage, { recursive: true, force: true });
  return image;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node create-mac-dmg.mjs <Eliza.app>');
  console.log(createMacInstaller(resolve(process.argv[2])));
}
