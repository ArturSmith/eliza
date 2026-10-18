import type { Pool, PoolClient } from 'pg';
import { onboardingProgressSchema, type OnboardingProgress } from '@eliza/contracts';
import { parse } from './security.js';
type Actor = { storeId: string; employeeId: string };
export async function readOnboarding(
  client: Pool | PoolClient,
  actor: Actor,
): Promise<OnboardingProgress[]> {
  return (
    await client.query(
      'SELECT page_id AS "pageId",version,status FROM onboarding_progress WHERE store_id=$1 AND employee_id=$2 ORDER BY page_id,version',
      [actor.storeId, actor.employeeId],
    )
  ).rows;
}
export async function saveOnboarding(client: Pool | PoolClient, actor: Actor, input: unknown) {
  const body = parse(onboardingProgressSchema, input);
  await client.query(
    `INSERT INTO onboarding_progress(store_id,employee_id,page_id,version,status) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(store_id,employee_id,page_id,version) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`,
    [actor.storeId, actor.employeeId, body.pageId, body.version, body.status],
  );
  return body;
}
