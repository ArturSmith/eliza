import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { toScaled, fromScaled } from '@eliza/contracts';
import { audit, type Actor } from './operations.js';
import { hash, token } from './security.js';

const tiers = [
  ['bronze', 10000n],
  ['silver', 30000n],
  ['gold', 50000n],
  ['diamond', 100000n],
] as const;
export function prizeTier(progress: string) {
  return tiers.filter(([, threshold]) => toScaled(progress, 2) >= threshold).at(-1)?.[0] ?? null;
}
const expired = 'This prize code has expired or was already used. Ask the customer to refresh it.';
export async function prizeState(
  c: PoolClient,
  membershipId: string,
  identity: { customer?: string; store?: string },
  lock = false,
) {
  const member = (
    await c.query(
      `SELECT m.id,m.store_id,m.reward_cycle,m.reward_earned_baseline::text AS baseline,p.enabled
     FROM loyalty_memberships m JOIN loyalty_programs p ON p.store_id=m.store_id
     WHERE m.id=$1 AND ($2::uuid IS NULL OR m.customer_subject=$2) AND ($3::uuid IS NULL OR m.store_id=$3)
     ${lock ? 'FOR UPDATE OF m FOR SHARE OF p' : ''}`,
      [membershipId, identity.customer ?? null, identity.store ?? null],
    )
  ).rows[0];
  if (!member) throw new NotFoundException('This loyalty membership is not available.');
  const wallet = (
    await c.query(
      `SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS balance,
     COALESCE(sum(amount) FILTER(WHERE kind IN ('earned','refund_earned')),0)::numeric(30,2)::text AS earned
     FROM loyalty_entries WHERE membership_id=$1 AND store_id=$2`,
      [member.id, member.store_id],
    )
  ).rows[0];
  const progress = toScaled(wallet.earned, 2) - toScaled(member.baseline, 2);
  const levelProgress = fromScaled(progress > 0n ? progress : 0n, 2);
  return {
    id: member.id as string,
    storeId: member.store_id as string,
    enabled: member.enabled as boolean,
    rewardCycle: member.reward_cycle as number,
    levelProgress,
    rewardTier: prizeTier(levelProgress),
    balance: wallet.balance as string,
    totalEarned: wallet.earned as string,
  };
}
export async function issuePrizeQr(c: PoolClient, customer: string, id: string) {
  const state = await prizeState(c, id, { customer }, true);
  if (!state.enabled || !state.rewardTier)
    throw new ConflictException('Reach Bronze to claim a prize.');
  const secret = token();
  const qr = (
    await c.query(
      `INSERT INTO loyalty_prize_tokens(token_hash,store_id,membership_id,cycle,tier,expires_at)
     VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '30 seconds')
     RETURNING expires_at AS "qrExpiresAt",clock_timestamp() AS "qrServerTime"`,
      [hash(secret), state.storeId, id, state.rewardCycle, state.rewardTier],
    )
  ).rows[0];
  await c.query(
    `DELETE FROM loyalty_prize_tokens WHERE token_hash IN
    (SELECT token_hash FROM loyalty_prize_tokens WHERE membership_id=$1 AND claim_id IS NULL
     AND expires_at<clock_timestamp()-interval '10 minutes'
     AND COALESCE(checkout_expires_at,expires_at)<clock_timestamp()-interval '10 minutes' LIMIT 100)`,
    [id],
  );
  return { qrCode: 'ELIZA-PRIZE:' + secret, ...qr };
}
async function scannedPrize(c: PoolClient, actor: Actor, code: string, bind: boolean) {
  const digest = hash(code.slice('ELIZA-PRIZE:'.length));
  const reference = (
    await c.query(
      'SELECT membership_id FROM loyalty_prize_tokens WHERE token_hash=$1 AND store_id=$2',
      [digest, actor.storeId],
    )
  ).rows[0];
  if (!reference) throw new ConflictException(expired);
  const state = await prizeState(c, reference.membership_id, { store: actor.storeId }, true);
  const qr = (
    await c.query(
      `SELECT *,expires_at>clock_timestamp() AS fresh,checkout_expires_at>clock_timestamp() AS checkout_valid FROM loyalty_prize_tokens WHERE token_hash=$1 FOR UPDATE`,
      [digest],
    )
  ).rows[0];
  if (
    !state.enabled ||
    qr.claim_id ||
    qr.cycle !== state.rewardCycle ||
    qr.tier !== state.rewardTier
  )
    throw new ConflictException(expired);
  if (qr.device_id && (qr.device_id !== actor.deviceId || qr.employee_id !== actor.employeeId))
    throw new ConflictException(
      'This prize code was scanned at another checkout. Ask the customer to refresh it.',
    );
  if (qr.device_id ? !qr.checkout_valid : !bind || !qr.fresh) throw new ConflictException(expired);
  if (!qr.device_id)
    await c.query(
      `UPDATE loyalty_prize_tokens SET device_id=$2,employee_id=$3,checkout_expires_at=clock_timestamp()+interval '5 minutes' WHERE token_hash=$1`,
      [digest, actor.deviceId, actor.employeeId],
    );
  return { state, digest };
}
export async function resolvePrize(c: PoolClient, actor: Actor, code: string) {
  const { state } = await scannedPrize(c, actor, code, true);
  return {
    kind: 'prize' as const,
    code,
    tier: state.rewardTier!,
    progress: state.levelProgress,
    balance: state.balance,
  };
}
export async function claimPrize(
  c: PoolClient,
  actor: Actor,
  body: { code: string; requestId: string; confirmed: true },
) {
  const fingerprint = hash(JSON.stringify({ ...body, ...actor }));
  const replay = async () => {
    const row = (
      await c.query('SELECT * FROM loyalty_prize_claims WHERE store_id=$1 AND request_id=$2', [
        actor.storeId,
        body.requestId,
      ])
    ).rows[0];
    if (!row) return null;
    if (row.request_hash !== fingerprint)
      throw new ConflictException('This request was already used for a different operation.');
    return {
      id: row.id,
      tier: row.tier,
      balance: row.balance_snapshot,
      rewardCycle: row.cycle + 1,
      createdAt: row.created_at,
    };
  };
  // Serialize request retries, then the membership lock serializes different codes in one cycle.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    actor.storeId + body.requestId,
  ]);
  const existing = await replay();
  if (existing) return existing;
  const shift = await c.query(
    "SELECT id FROM shifts WHERE store_id=$1 AND device_id=$2 AND employee_id=$3 AND status='open' FOR UPDATE",
    [actor.storeId, actor.deviceId, actor.employeeId],
  );
  if (!shift.rowCount)
    throw new BadRequestException('Start your shift before handing out a prize.');
  const { state, digest } = await scannedPrize(c, actor, body.code, false);
  const result = (
    await c.query(
      `INSERT INTO loyalty_prize_claims(store_id,membership_id,cycle,tier,earned_snapshot,balance_snapshot,employee_id,device_id,request_id,request_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,tier,balance_snapshot AS balance,cycle+1 AS "rewardCycle",created_at AS "createdAt"`,
      [
        actor.storeId,
        state.id,
        state.rewardCycle,
        state.rewardTier,
        state.totalEarned,
        state.balance,
        actor.employeeId,
        actor.deviceId,
        body.requestId,
        fingerprint,
      ],
    )
  ).rows[0];
  await c.query(
    'UPDATE loyalty_memberships SET reward_cycle=reward_cycle+1,reward_earned_baseline=$2 WHERE id=$1 AND store_id=$3',
    [state.id, state.totalEarned, actor.storeId],
  );
  await c.query('UPDATE loyalty_prize_tokens SET claim_id=$2 WHERE token_hash=$1', [
    digest,
    result.id,
  ]);
  await audit(c, actor, 'Loyalty prize handed over', result.id, {
    membershipId: state.id,
    tier: state.rewardTier,
    cycle: state.rewardCycle,
    progressUsed: state.levelProgress,
    balance: state.balance,
  });
  return result;
}
