import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { fromScaled, toScaled } from '@eliza/contracts';
import { audit, type Actor } from './operations.js';
import { shiftRow } from './register.js';

type ClosingData = { requestId: string; countedCash: string; notes: string };
/** Caller owns the transaction and authorization; the row lock serializes cash activity and closing. */
export async function closeShift(
  client: PoolClient,
  options: {
    id: string;
    actor: Actor;
    body: ClosingData;
    digest: string;
    source: 'pos' | 'management';
    approveDifference: () => Promise<string | null | HttpException>;
  },
) {
  const { id, actor, body, digest, source } = options;
  const existing = (
    await client.query(
      `SELECT status,close_hash,employee_id,device_id FROM shifts WHERE id=$1 AND store_id=$2
      ${source === 'pos' ? 'AND device_id=$3 AND employee_id=$4' : ''} FOR UPDATE`,
      source === 'pos'
        ? [id, actor.storeId, actor.deviceId, actor.employeeId]
        : [id, actor.storeId],
    )
  ).rows[0];
  if (!existing) throw new NotFoundException('Shift not found.');
  if (existing.status === 'closed') {
    if (existing.close_hash !== digest)
      throw new ConflictException('This shift is already closed.');
    return shiftRow(client, id);
  }
  const expected = (
    await client.query(
      'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1 AND store_id=$2',
      [id, actor.storeId],
    )
  ).rows[0].total;
  const difference = toScaled(body.countedCash, 2) - toScaled(expected, 2);
  const approver = difference === 0n ? null : await options.approveDifference();
  if (approver instanceof HttpException) return approver;
  await client.query(
    "UPDATE shifts SET status='closed',expected_cash=$1,counted_cash=$2,difference=$3,closed_at=now(),notes=$4,close_request_id=$5,close_hash=$6,approver_id=$7 WHERE id=$8 AND store_id=$9",
    [
      expected,
      body.countedCash,
      fromScaled(difference, 2),
      body.notes,
      body.requestId,
      digest,
      approver,
      id,
      actor.storeId,
    ],
  );
  await audit(client, actor, 'Shift closed', id, {
    expectedCash: expected,
    countedCash: body.countedCash,
    difference: fromScaled(difference, 2),
    approverId: approver,
    notes: body.notes,
    source,
    cashierId: existing.employee_id,
    registerId: existing.device_id,
  });
  return shiftRow(client, id);
}
