import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresBin, runtimeEnvironment } from '../apps/desktop/src/runtime.mjs';
import { validateProduction, setupAuthorized } from '../apps/api/src/production';
const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
describe('desktop isolation', () => {
  const url = 'postgresql://eliza_desktop:random-secret@127.0.0.1:54339/eliza';
  it('allows production loopback only for the constrained desktop runtime', () => {
    Object.assign(process.env, runtimeEnvironment(url, 'http://127.0.0.1:37931'));
    expect(() => validateProduction()).not.toThrow();
    expect(setupAuthorized(undefined)).toBe(true);
    process.env.HOST = '0.0.0.0';
    expect(() => validateProduction()).toThrow();
  });
  it('rejects cloud databases, remote origins and forwarded proxies', () => {
    expect(() =>
      runtimeEnvironment('postgresql://user:secret@remote.test/eliza', 'http://127.0.0.1:37931'),
    ).toThrow();
    expect(() => runtimeEnvironment(url, 'https://example.test')).toThrow();
    Object.assign(process.env, runtimeEnvironment(url, 'http://127.0.0.1:37931'), {
      TRUST_PROXY: '1',
    });
    expect(() => validateProduction()).toThrow();
  });
  it('keeps cloud HTTPS and setup-token requirements', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ELIZA_DESKTOP: '',
      DATABASE_URL: url,
      APP_ORIGIN: 'http://127.0.0.1:37931',
      SETUP_TOKEN: '',
    });
    expect(() => validateProduction()).toThrow();
    expect(setupAuthorized(undefined)).toBe(false);
  });
});

describe('bundled PostgreSQL selection', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'eliza-runtime-selection-'));
    const bundled = join(root, 'postgres');
    mkdirSync(bundled);
    writeFileSync(
      join(bundled, 'manifest.json'),
      JSON.stringify({ platform: process.platform, arch: process.arch, defaultMajor: '17' }),
    );
    for (const major of ['14', '17']) {
      const bin = join(bundled, major, 'bin');
      mkdirSync(bin, { recursive: true });
      for (const name of ['postgres', 'pg_ctl', 'initdb', 'pg_dump', 'pg_restore'])
        writeFileSync(join(bin, name), 'fixture');
    }
    return { root, bundled, options: { root, packaged: true } };
  }
  it('uses the bundled default for a new store even with an external override', () => {
    const f = fixture();
    try {
      expect(postgresBin('/missing-homebrew', f.options)).toBe(join(f.bundled, '17/bin'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it('selects the matching bundled major for an existing store', () => {
    const f = fixture(),
      dataDir = join(f.root, 'store');
    mkdirSync(join(dataDir, 'postgres'), { recursive: true });
    writeFileSync(join(dataDir, 'postgres/PG_VERSION'), '14\n');
    try {
      expect(postgresBin(undefined, { ...f.options, dataDir })).toBe(join(f.bundled, '14/bin'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it('refuses unsupported store versions instead of initializing a different database', () => {
    const f = fixture(),
      dataDir = join(f.root, 'store');
    mkdirSync(join(dataDir, 'postgres'), { recursive: true });
    writeFileSync(join(dataDir, 'postgres/PG_VERSION'), '16\n');
    try {
      expect(() => postgresBin(undefined, { ...f.options, dataDir })).toThrow(
        'Existing data is unchanged',
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it('does not fall back to Homebrew when a packaged runtime is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'eliza-runtime-missing-'));
    try {
      expect(() => postgresBin(undefined, { root, packaged: true })).toThrow('Reinstall Eliza');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
