import { timingSafeEqual } from 'node:crypto';

export function validateProduction() {
  if (process.env.NODE_ENV !== 'production') return;
  const origin = process.env.APP_ORIGIN;
  const desktop = process.env.ELIZA_DESKTOP === 'true';
  const local =
    desktop &&
    origin === 'http://127.0.0.1:37931' &&
    process.env.HOST === '127.0.0.1' &&
    !process.env.TRUST_PROXY;
  if (desktop && !local)
    throw new Error('Desktop server must use its loopback origin and bind address.');
  if (!origin || new URL(origin).origin !== origin || (!origin.startsWith('https://') && !local))
    throw new Error('APP_ORIGIN must be an HTTPS origin without a trailing slash.');
  const database = process.env.DATABASE_URL;
  if (!database) throw new Error('DATABASE_URL is required in production.');
  const parsed = new URL(database);
  if (desktop && (parsed.hostname !== '127.0.0.1' || parsed.port !== '54339'))
    throw new Error('Desktop server must use its isolated local database.');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.password ||
    parsed.password === 'eliza_local'
  )
    throw new Error('Use a private PostgreSQL connection with non-development credentials.');
}

export function setupAuthorized(value: unknown) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected)
    return (
      process.env.NODE_ENV !== 'production' ||
      (process.env.ELIZA_DESKTOP === 'true' && process.env.APP_ORIGIN === 'http://127.0.0.1:37931')
    );
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
