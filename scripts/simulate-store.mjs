#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pg, RealDate, simulationTarget, prepareClock, installClock } from './simulation/clock.mjs';
import { addDays, json } from './simulation/ledger.mjs';
import { simulate } from './simulation/scenario.mjs';

const command = process.argv[2] ?? 'run';
function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z]+$/.test(args[i]) || args[i + 1] === undefined)
      throw new Error('Options use --name value');
    const key = args[i].slice(2);
    if (!['days', 'products', 'sales', 'seed', 'end', 'run', 'port'].includes(key))
      throw new Error('Unknown option ' + args[i]);
    result[key] = args[i + 1];
  }
  return result;
}
function integer(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Expected integer ${min}..${max}, got ${value}`);
  return n;
}
function save(path, value) {
  writeFileSync(path, json(value) + '\n', { mode: 0o600 });
}
const args = options(process.argv.slice(3));
const root = resolve('.local/simulations');
const output = console.log.bind(console);
let app, db, clock, admin, runDir, apiLog, config, report;
try {
  if (!['run', 'serve'].includes(command))
    throw new Error('Use: node scripts/simulate-store.mjs run|serve [--name value]');
  if (process.env.NODE_ENV === 'production')
    throw new Error('The simulator cannot run in production mode');
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (process.env.NODE_ENV === 'production')
    throw new Error('The simulator cannot use a production environment');
  // Do not allow a .env file to enable paid providers for synthetic workloads.
  for (const key of Object.keys(process.env))
    if (/^(OPENAI|ANTHROPIC|GEMINI|AI_PROVIDER|AI_API)/.test(key)) delete process.env[key];
  if (command === 'serve') {
    runDir = args.run
      ? resolve(args.run)
      : JSON.parse(readFileSync(resolve(root, 'latest.json'), 'utf8')).directory;
    config = JSON.parse(readFileSync(resolve(runDir, 'config.json'), 'utf8'));
    simulationTarget(config.databaseUrl);
    process.env.DATABASE_URL = config.databaseUrl;
    db = new pg.Client({ connectionString: config.databaseUrl });
    await db.connect();
    clock = await installClock(db, config.databaseUrl);
    const port = integer(args.port, 5183, 1024, 65535);
    process.env.APP_ORIGIN = `http://localhost:${port}`;
    process.env.SERVE_WEB = 'true';
    if (!existsSync('apps/web/dist/index.html'))
      throw new Error('Build the web app first: pnpm --filter @eliza/web build');
    const { createApp } = await import('../apps/api/dist/app.js');
    app = await createApp();
    await app.listen(port, '127.0.0.1');
    output(`Simulation store: http://localhost:${port}`);
    output(`Virtual time is frozen at ${clock.instant}. This is a test store.`);
    output(`Login details: ${resolve(runDir, 'credentials.json')}`);
    const stop = async () => {
      await app.close();
      clock.restore();
      await db.end();
      process.exit(0);
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } else {
    const to =
      args.end ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Oslo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new RealDate());
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      Number.isNaN(RealDate.parse(to)) ||
      new RealDate(to).toISOString().slice(0, 10) !== to
    )
      throw new Error('Use a valid --end YYYY-MM-DD');
    const days = integer(args.days, 30, 2, 90),
      products = integer(args.products, 100, 10, 500),
      salesPerDay = integer(args.sales, 80, 6, 1000),
      seed = integer(args.seed, 42, 0, 4294967295);
    const source = new URL(
      process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza',
    );
    if (
      !['postgres:', 'postgresql:'].includes(source.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)
    )
      throw new Error(
        'Only local PostgreSQL is allowed. Remote and Railway databases are forbidden.',
      );
    const name = `eliza_sim_${to.replaceAll('-', '')}_${RealDate.now()}_${randomBytes(2).toString('hex')}`;
    const target = new URL(source);
    target.pathname = '/' + name;
    simulationTarget(target.toString());
    config = {
      name,
      days,
      products,
      salesPerDay,
      seed,
      from: addDays(to, 1 - days),
      to,
      databaseUrl: target.toString(),
      startedAt: new RealDate().toISOString(),
    };
    mkdirSync(root, { recursive: true, mode: 0o700 });
    runDir = resolve(root, name);
    mkdirSync(runDir, { mode: 0o700 });
    save(resolve(runDir, 'config.json'), config);
    const credentials = {
      email: 'manager@simulation.test',
      password: randomBytes(18).toString('base64url'),
      managerPin: String(100000 + Math.floor(Math.random() * 900000)),
    };
    save(resolve(runDir, 'credentials.json'), credentials);
    source.pathname = '/postgres';
    admin = new pg.Client({ connectionString: source.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    admin = null;
    process.env.DATABASE_URL = target.toString();
    const migrationLog = openSync(resolve(runDir, 'migration.log'), 'w', 0o600);
    try {
      execFileSync(process.execPath, ['apps/api/dist/migrate.js'], {
        env: process.env,
        stdio: ['ignore', migrationLog, migrationLog],
      });
    } finally {
      closeSync(migrationLog);
    }
    db = new pg.Client({ connectionString: target.toString() });
    await db.connect();
    const clockInstallation = await prepareClock(db, config.from + 'T05:00:00Z');
    clock = await installClock(db, target.toString());
    apiLog = resolve(runDir, 'api.log');
    writeFileSync(apiLog, '', { mode: 0o600 });
    console.log = (...values) => {
      const line = values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
      if (line.startsWith('Simulation ')) output(line);
      else appendFileSync(apiLog, line + '\n');
    };
    const journal = resolve(runDir, 'journal.jsonl');
    writeFileSync(journal, '', { mode: 0o600 });
    let requests = 0;
    const record = (entry) => {
      if (entry.type === 'http') requests++;
      appendFileSync(journal, JSON.stringify({ instant: clock.instant, ...entry }) + '\n');
    };
    process.env.APP_ORIGIN = 'http://localhost:5183';
    process.env.SERVE_WEB = 'false';
    const { createApp } = await import('../apps/api/dist/app.js');
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl(),
      start = performance.now();
    output(
      `Simulation starting: ${days} days, ${products} products, seed ${seed}; isolated database ${name}`,
    );
    report = {
      status: 'running',
      period: { from: config.from, to },
      configuration: { days, products, salesPerDay, seed },
      clockInstallation,
    };
    const result = await simulate({
      url,
      origin: process.env.APP_ORIGIN,
      db,
      clock,
      config,
      credentials,
      record,
      checkpoint: async (progress) => {
        save(resolve(runDir, 'report.json'), { ...report, ...progress, requests });
        save(resolve(runDir, 'credentials.json'), credentials);
      },
    });
    report = {
      ...report,
      ...result,
      status: 'passed',
      requests,
      elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
      virtualNow: clock.instant,
    };
    save(resolve(runDir, 'report.json'), report);
    save(resolve(runDir, 'credentials.json'), credentials);
    save(resolve(root, 'latest.json'), { directory: runDir });
    const f = report.financial;
    writeFileSync(
      resolve(runDir, 'report.md'),
      `# Store simulation\n\nStatus: PASSED\n\n${config.from} — ${to}; seed ${seed}.\n\n${report.coverage.sales} sales, ${report.coverage.shifts_closed} closed shifts, ${report.checks} assertions, ${requests} HTTP requests.\n\n| Metric | NOK |\n|---|---:|\n| Revenue | ${f.revenue} |\n| Cost of goods sold | ${f.cogs} |\n| Gross profit | ${f.grossProfit} |\n| Inventory losses | ${f.inventoryLosses} |\n| Operating expenses | ${f.operatingExpenses} |\n| Store operating profit | ${f.storeOperatingProfit} |\n\n## Coverage\n\n${Object.entries(
        report.coverage,
      )
        .map(([k, v]) => `- ${k}: ${v}`)
        .join(
          '\n',
        )}\n\n## Limitations\n\n${report.limitations.map((v) => '- ' + v).join('\n')}\n\n## Open the store\n\nRun \`npm run simulate:serve -- --run ${runDir}\`. Credentials are in \`credentials.json\` (local only). The server clock remains frozen at ${clock.instant}.\n`,
      { mode: 0o600 },
    );
    await app.close();
    app = null;
    clock.restore();
    clock = null;
    await db.end();
    db = null;
    console.log = output;
    output(
      `Simulation PASSED: ${report.coverage.sales} sales, ${report.checks} assertions in ${report.elapsedSeconds}s`,
    );
    output(`Report: ${resolve(runDir, 'report.md')}`);
    output('Open the test store: npm run simulate:serve');
  }
} catch (error) {
  console.log = output;
  if (runDir && command === 'run') {
    const previous = existsSync(resolve(runDir, 'report.json'))
      ? JSON.parse(readFileSync(resolve(runDir, 'report.json'), 'utf8'))
      : report;
    save(resolve(runDir, 'report.json'), {
      ...previous,
      status: 'failed',
      virtualNow: clock?.instant,
      error: error.stack,
    });
  }
  console.error('Simulation failed:', error.stack);
  if (app) await app.close().catch(() => {});
  clock?.restore();
  if (db) await db.end().catch(() => {});
  if (admin) await admin.end().catch(() => {});
  process.exitCode = 1;
}
