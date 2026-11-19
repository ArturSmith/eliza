import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hash, token } from './security.js';
import type { Actor } from './operations.js';
export const expiredLoyaltyQr =
  'This QR code has expired or was already used. Ask the customer to refresh it.';
export async function issueLoyaltyQr(c: Pool | PoolClient, customer: string, membership: string) {
  const secret = token();
  const row = (
    await c.query(
      `INSERT INTO loyalty_qr_tokens(token_hash,store_id,membership_id,expires_at)
 SELECT $1,m.store_id,m.id,clock_timestamp()+interval '30 seconds' FROM loyalty_memberships m JOIN loyalty_programs p ON p.store_id=m.store_id
 WHERE m.id=$2 AND m.customer_subject=$3 AND p.enabled RETURNING expires_at AS "qrExpiresAt",clock_timestamp() AS "qrServerTime"`,
      [hash(secret), membership, customer],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('This loyalty membership is not available.');
  await c.query(
    `DELETE FROM loyalty_qr_tokens WHERE token_hash IN (SELECT token_hash FROM loyalty_qr_tokens WHERE membership_id=$1 AND sale_id IS NULL AND expires_at<clock_timestamp()-interval '10 minutes' AND COALESCE(checkout_expires_at,expires_at)<clock_timestamp()-interval '10 minutes' LIMIT 100)`,
    [membership],
  );
  return { qrCode: 'ELIZA-LOYALTY:' + secret, ...row };
}
export type QrToken = {
  token_hash: string;
  checkout_token_hash: string | null;
  checkout_expires_at: Date | null;
  device_id: string | null;
  employee_id: string | null;
  sale_id: string | null;
  display_valid: boolean;
  checkout_valid: boolean;
};
export async function claimLoyaltyQr(c: PoolClient, actor: Actor, code: string, qr: QrToken) {
  if (qr.device_id && (qr.device_id !== actor.deviceId || qr.employee_id !== actor.employeeId))
    throw new ConflictException(
      'This QR code was already scanned at another checkout. Ask the customer to refresh it.',
    );
  if (qr.checkout_token_hash && !qr.checkout_valid) throw new ConflictException(expiredLoyaltyQr);
  const key = process.env.CUSTOMER_APP_SERVICE_TOKEN;
  if (!key || key.length < 32)
    throw new ConflictException('The customer app connection is not configured.');
  // A repeat of the same scan can recover the same authorization without storing its plaintext.
  const secret = createHmac('sha256', key)
    .update('eliza.loyalty.checkout.v1:' + code + ':' + actor.deviceId + ':' + actor.employeeId)
    .digest('hex');
  if (qr.checkout_token_hash && qr.checkout_token_hash !== hash(secret))
    throw new ConflictException(expiredLoyaltyQr);
  if (!qr.checkout_token_hash)
    await c.query(
      `UPDATE loyalty_qr_tokens SET checkout_token_hash=$2,checkout_expires_at=clock_timestamp()+interval '5 minutes',device_id=$3,employee_id=$4 WHERE token_hash=$1`,
      [qr.token_hash, hash(secret), actor.deviceId, actor.employeeId],
    );
  return 'ELIZA-LOYALTY:' + secret;
}
