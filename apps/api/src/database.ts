import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
export const databaseUrl = () =>
  process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new pg.Pool({
    connectionString: databaseUrl(),
    max: 10,
    connectionTimeoutMillis: 10000,
  });
  readonly db = drizzle(this.pool, { schema });
  async onModuleDestroy() {
    await this.pool.end();
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
