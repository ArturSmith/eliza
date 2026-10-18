import { afterEach, describe, expect, it } from 'vitest';
import { runtimeEnvironment } from '../apps/desktop/src/runtime.mjs';
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
