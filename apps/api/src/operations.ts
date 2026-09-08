import { Injectable, HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
export type Actor = { storeId: string; employeeId: string; deviceId: string };
export async function audit(
  client: PoolClient,
  actor: Actor,
  action: string,
  entityId: string,
  details: unknown,
) {
  await client.query(
    'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [actor.storeId, actor.employeeId, actor.deviceId, action, entityId, JSON.stringify(details)],
  );
}
@Injectable()
export class Operations {
  constructor(private database: Database) {}
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    let result: T;
    try {
      await client.query('BEGIN');
      result = await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    // Authentication failures are returned so their attempt counters commit before we throw.
    if (result instanceof HttpException) throw result;
    return result;
  }
}
