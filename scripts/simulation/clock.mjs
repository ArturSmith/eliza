// Simulation-only clock. Imported by the local runner, never by the application.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
export const pg = require('pg');
export const RealDate = globalThis.Date;

export function simulationTarget(value) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Simulation supports local PostgreSQL only.');
  if (!/^eliza_sim_[a-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1))))
    throw new Error(
      'Simulation database must have the eliza_sim_ prefix. Existing stores are forbidden.',
    );
  // pg accepts connection overrides from URL query parameters (for example ?host=...).
  // Validate the destination the driver will actually use before creating or migrating a DB.
  const effective = new pg.Client({ connectionString: url.toString() }).connectionParameters;
  if (!['localhost', '127.0.0.1', '::1'].includes(effective.host))
    throw new Error('Simulation supports local PostgreSQL only.');
  if (effective.database !== decodeURIComponent(url.pathname.slice(1)))
    throw new Error('Simulation database cannot be overridden by connection parameters.');
  return url;
}

// Do not alter literals, quoted identifiers, comments or dollar-quoted bodies.
// Function bodies are rewritten separately at installation, only in the sandbox DB.
export function clockSql(sql) {
  const tokens =
    /(?:'(?:''|\\.|[^'\\])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\$(?:[A-Za-z_][\w]*)?\$)/gy;
  let out = '',
    i = 0;
  while (i < sql.length) {
    tokens.lastIndex = i;
    const protectedToken = tokens.exec(sql);
    if (protectedToken) {
      let value = protectedToken[0];
      if (value.startsWith('$')) {
        const end = sql.indexOf(value, i + value.length);
        if (end < 0) throw new Error('Unterminated dollar quote');
        value = sql.slice(i, end + value.length);
      }
      out += value;
      i += value.length;
      continue;
    }
    const word = /^[A-Za-z_][\w$]*/.exec(sql.slice(i));
    if (word) {
      const tail = sql.slice(i);
      const call =
        /^(?:pg_catalog\.)?(?:now|transaction_timestamp|statement_timestamp)\s*\(\s*\)/i.exec(tail);
      if (call && sql[i - 1] !== '.') {
        out += 'eliza_simulation.now()';
        i += call[0].length;
      } else if (/^current_timestamp$/i.test(word[0])) {
        out += 'eliza_simulation.now()';
        i += word[0].length;
      } else if (/^current_date$/i.test(word[0])) {
        out += '(eliza_simulation.now()::date)';
        i += word[0].length;
      } else {
        out += word[0];
        i += word[0].length;
      }
    } else out += sql[i++];
  }
  return out;
}
const identifier = (s) => '"' + s.replaceAll('"', '""') + '"';

export async function prepareClock(client, instant) {
  simulationTarget(
    client.connectionParameters
      ? `postgresql://${client.connectionParameters.host}:${client.connectionParameters.port}/${client.connectionParameters.database}`
      : process.env.DATABASE_URL,
  );
  await client.query('BEGIN');
  try {
    await client.query('CREATE SCHEMA eliza_simulation');
    await client.query(
      'CREATE TABLE eliza_simulation.clock (id boolean PRIMARY KEY DEFAULT true CHECK(id), instant timestamptz NOT NULL)',
    );
    await client.query('INSERT INTO eliza_simulation.clock(instant) VALUES($1)', [instant]);
    await client.query(
      `CREATE FUNCTION eliza_simulation.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT instant FROM eliza_simulation.clock WHERE id=true'`,
    );
    const defaults = (
      await client.query(`SELECT table_name,column_name,column_default FROM information_schema.columns
      WHERE table_schema='public' AND column_default IS NOT NULL`)
    ).rows;
    let changedDefaults = 0,
      changedFunctions = 0;
    for (const row of defaults) {
      const replacement = clockSql(row.column_default);
      if (replacement === row.column_default) continue;
      await client.query(
        `ALTER TABLE public.${identifier(row.table_name)} ALTER COLUMN ${identifier(row.column_name)} SET DEFAULT ${replacement}`,
      );
      changedDefaults++;
    }
    const functions = (
      await client.query(`SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('sql','plpgsql'))`)
    ).rows;
    for (const row of functions) {
      const body = clockSql(row.prosrc);
      if (body === row.prosrc) continue;
      // pg_get_functiondef contains the original prosrc inside a dollar quote.
      const at = row.definition.indexOf(row.prosrc);
      if (at < 0) throw new Error('Cannot locate sandbox function body');
      await client.query(
        row.definition.slice(0, at) + body + row.definition.slice(at + row.prosrc.length),
      );
      changedFunctions++;
    }
    await client.query('COMMIT');
    return { changedDefaults, changedFunctions };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function installClock(client, url) {
  simulationTarget(url);
  let instant = new RealDate(
    (await client.query('SELECT instant FROM eliza_simulation.clock WHERE id=true')).rows[0]
      .instant,
  ).getTime();
  if (!Number.isFinite(instant)) throw new Error('Invalid simulation clock');
  const originalQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function (query, ...args) {
    const text = typeof query === 'string' ? query : query?.text;
    const rewritten = typeof text === 'string' ? clockSql(text) : text;
    const next =
      typeof query === 'string' ? rewritten : text ? { ...query, text: rewritten } : query;
    return originalQuery.call(this, next, ...args);
  };
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return Reflect.construct(target, args.length ? args : [instant]);
    },
    apply() {
      return new RealDate(instant).toString();
    },
    get(target, property) {
      return property === 'now' ? () => instant : Reflect.get(target, property);
    },
  });
  return {
    get instant() {
      return new RealDate(instant).toISOString();
    },
    async set(value) {
      const next = RealDate.parse(value);
      if (!Number.isFinite(next) || next < instant)
        throw new Error('Simulation time must move forwards');
      await client.query('UPDATE eliza_simulation.clock SET instant=$1 WHERE id=true', [value]);
      instant = next;
    },
    restore() {
      globalThis.Date = RealDate;
      pg.Client.prototype.query = originalQuery;
    },
  };
}
