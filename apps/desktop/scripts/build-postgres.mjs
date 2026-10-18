// Build from pinned upstream sources, without Homebrew or third-party dylibs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const postgresSources = [
  { version: '17.11', sha256: 'dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979' },
  // Preserve databases created by the first desktop preview. No in-place major upgrade.
  { version: '14.24', sha256: 'a7fa7ed3d558172355f51406097a7bd4f6b473be80f311ef7cda96bf383d8897' },
];
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const runtimeDirectory = join(root, '.local/postgres-runtime', `darwin-${process.arch}`);
const commands = ['postgres', 'initdb', 'pg_ctl', 'pg_dump', 'pg_restore'];
const run = (file, args, options = {}) =>
  execFileSync(file, args, { encoding: 'utf8', ...options });
function files(directory, root = realpathSync(directory)) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (isAbsolute(readlinkSync(path)) || !realpathSync(path).startsWith(root + '/'))
        throw new Error(`Runtime symlink escapes its installation: ${path}`);
      return [];
    }
    return entry.isDirectory() ? files(path, root) : entry.isFile() ? [path] : [];
  });
}
export function verifyRuntimeLinks(directory) {
  files(directory);
}
function dependencies(file) {
  return run('/usr/bin/otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter(Boolean);
}
function macho(file) {
  return /Mach-O/.test(run('/usr/bin/file', ['-b', file]));
}
export function verifyPostgresRuntime(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw new Error('PostgreSQL runtime architecture does not match this build.');
  for (const source of postgresSources) {
    const major = source.version.split('.')[0],
      installation = join(directory, major);
    if (!commands.every((name) => existsSync(join(installation, 'bin', name))))
      throw new Error(`Incomplete PostgreSQL ${major} runtime.`);
    if (!run(join(installation, 'bin/postgres'), ['--version']).includes(` ${source.version}`))
      throw new Error(`Unexpected PostgreSQL ${major} version.`);
    for (const file of files(installation).filter(macho)) {
      run('/usr/bin/lipo', [file, '-verify_arch', process.arch === 'arm64' ? 'arm64' : 'x86_64']);
      for (const dependency of dependencies(file)) {
        if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/'))
          continue;
        if (
          !dependency.startsWith('@loader_path/') ||
          !existsSync(resolve(dirname(file), dependency.slice('@loader_path/'.length)))
        )
          throw new Error(`Non-relocatable dependency in ${basename(file)}: ${dependency}`);
      }
    }
  }
  return manifest;
}
export function buildPostgres() {
  if (process.platform !== 'darwin') throw new Error('Build the PostgreSQL runtime on macOS.');
  if (existsSync(join(runtimeDirectory, 'manifest.json'))) {
    const manifest = verifyPostgresRuntime(runtimeDirectory);
    if (JSON.stringify(manifest.sources) === JSON.stringify(postgresSources))
      return runtimeDirectory;
  }
  mkdirSync(runtimeDirectory, { recursive: true });
  const cache = join(root, '.local/postgres-source');
  mkdirSync(cache, { recursive: true });
  for (const source of postgresSources) {
    const archive = join(cache, `postgresql-${source.version}.tar.bz2`);
    if (!existsSync(archive))
      run('/usr/bin/curl', [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--output',
        archive,
        `https://ftp.postgresql.org/pub/source/v${source.version}/${basename(archive)}`,
      ]);
    if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== source.sha256)
      throw new Error(
        `PostgreSQL ${source.version} source checksum mismatch. Remove the cached archive and retry.`,
      );
    const work = join(cache, `build-${source.version}-${process.arch}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    run('/usr/bin/tar', ['-xjf', archive, '-C', work, '--strip-components=1']);
    const installation = join(runtimeDirectory, source.version.split('.')[0]);
    rmSync(installation, { recursive: true, force: true });
    const env = {
      ...process.env,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      CC: '/usr/bin/clang',
      CXX: '/usr/bin/clang++',
      CFLAGS: `-O2 -mmacosx-version-min=12.0 -arch ${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      LDFLAGS: `-mmacosx-version-min=12.0 -arch ${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      CPPFLAGS: '',
      PKG_CONFIG: '/usr/bin/false',
      PKG_CONFIG_PATH: '',
      DYLD_LIBRARY_PATH: '',
      MACOSX_DEPLOYMENT_TARGET: '12.0',
    };
    const log = join(cache, `build-${source.version}-${process.arch}.log`);
    console.log(`Building PostgreSQL ${source.version} (${process.arch}); log: ${log}`);
    // Capture compiler output in a file rather than flooding the packaging output.
    const invoke = (file, args) => {
      try {
        writeFileSync(log, run(file, args, { cwd: work, env, maxBuffer: 32 * 1024 * 1024 }), {
          flag: 'a',
        });
      } catch (error) {
        writeFileSync(log, String(error.stdout ?? '') + String(error.stderr ?? ''), { flag: 'a' });
        throw new Error(`PostgreSQL build failed. See ${log}`, { cause: error });
      }
    };
    writeFileSync(log, '');
    invoke('./configure', [
      `--prefix=${installation}`,
      '--without-readline',
      '--without-icu',
      '--without-openssl',
      '--without-gssapi',
      '--disable-nls',
    ]);
    invoke('/usr/bin/make', ['-j', String(Math.min(availableParallelism(), 8))]);
    invoke('/usr/bin/make', ['install']);
    cpSync(join(work, 'COPYRIGHT'), join(installation, 'COPYRIGHT'));
    const binaries = files(installation).filter(macho);
    for (const file of binaries) {
      for (const dependency of dependencies(file)) {
        if (!dependency.startsWith(installation + '/')) continue;
        const replacement = '@loader_path/' + relative(dirname(file), dependency);
        run('/usr/bin/install_name_tool', ['-change', dependency, replacement, file]);
      }
      if (file.endsWith('.dylib'))
        run('/usr/bin/install_name_tool', ['-id', '@loader_path/' + basename(file), file]);
      run('/usr/bin/codesign', ['--force', '--sign', '-', file]);
    }
    rmSync(join(installation, 'include'), { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(
    join(runtimeDirectory, 'manifest.json'),
    JSON.stringify(
      {
        platform: 'darwin',
        arch: process.arch,
        defaultMajor: '17',
        sources: postgresSources,
        minimumMacOS: '12.0',
        build: 'upstream-source-system-libraries-only',
      },
      null,
      2,
    ) + '\n',
  );
  verifyPostgresRuntime(runtimeDirectory);
  return runtimeDirectory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(buildPostgres());
