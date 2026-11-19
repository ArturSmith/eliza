import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  ParseUUIDPipe,
  Req,
  UseGuards,
  Module,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  applyLoyaltyDiscount,
  loyaltyProgramSchema,
  loyaltySaleSchema,
  toScaled,
  fromScaled,
  type Receipt,
  type LoyaltyMember,
} from '@eliza/contracts';
import { Database } from './database.js';
import { loyaltyMembers } from './loyalty-members.js';
import { issueLoyaltyQr, claimLoyaltyQr, expiredLoyaltyQr, type QrToken } from './loyalty-qr.js';
import type { Actor } from './operations.js';
import { ShopNewsController } from './shop-news.js';
import { AuthModule } from './auth.js';
import { RegisterModule, RegisterService } from './register.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, Require, parse, token, hash, type AuthRequest } from './security.js';

/** Only the customer server owns this credential. Never accept it in browser bundles. */
export function customerServiceAuthorized(req: Request) {
  const expected = process.env.CUSTOMER_APP_SERVICE_TOKEN;
  if (!expected || expected.length < 32 || process.env.ELIZA_DESKTOP === 'true') return false;
  const supplied = req.headers.authorization;
  if (typeof supplied !== 'string' || !supplied.startsWith('Bearer ')) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(supplied.slice(7)), digest(expected));
}
@Injectable()
class CustomerServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!customerServiceAuthorized(context.switchToHttp().getRequest()))
      throw new UnauthorizedException('Customer integration is not authorized.');
    return true;
  }
}
const programSelect = `SELECT enabled,name,description,earn_percent::text AS "earnPercent",redeem_percent::text AS "redeemPercent",version FROM loyalty_programs WHERE store_id=$1`;
export async function membership(
  c: PoolClient,
  store: string,
  code: string,
  lock = false,
  actor?: Actor,
): Promise<LoyaltyMember & { qrToken: QrToken }> {
  const input = parse(loyaltySaleSchema, { code }).code;
  if (!input.startsWith('ELIZA-LOYALTY:')) throw new ConflictException(expiredLoyaltyQr);
  const digest = hash(input.slice(14));
  const column = actor ? 'checkout_token_hash' : 'token_hash';
  const reference = (
    await c.query(
      `SELECT membership_id,token_hash FROM loyalty_qr_tokens WHERE store_id=$1 AND ${column}=$2`,
      [store, digest],
    )
  ).rows[0];
  if (!reference) throw new ConflictException(expiredLoyaltyQr);
  const row = (
    await c.query(
      `SELECT m.id,p.name AS "programName",p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent",s.currency FROM loyalty_memberships m JOIN loyalty_programs p ON p.store_id=m.store_id JOIN stores s ON s.id=m.store_id WHERE m.id=$1 AND m.store_id=$2 AND p.enabled ${lock ? 'FOR UPDATE OF m FOR SHARE OF p' : ''}`,
      [reference.membership_id, store],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('This loyalty card is not valid for this shop.');
  const qr: QrToken = (
    await c.query(
      `SELECT *,expires_at>clock_timestamp() AS display_valid,checkout_expires_at>clock_timestamp() AS checkout_valid FROM loyalty_qr_tokens WHERE token_hash=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [reference.token_hash],
    )
  ).rows[0];
  if (
    !qr ||
    qr.sale_id ||
    (actor
      ? !qr.checkout_valid || qr.device_id !== actor.deviceId || qr.employee_id !== actor.employeeId
      : !qr.display_valid)
  )
    throw new ConflictException(expiredLoyaltyQr);
  const balance = (
    await c.query(
      'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS value FROM loyalty_entries WHERE membership_id=$1 AND store_id=$2',
      [row.id, store],
    )
  ).rows[0].value;
  return { ...row, code, balance, qrToken: qr };
}

@Controller('loyalty')
@UseGuards(AccessGuard)
export class LoyaltyManagementController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get() @Require('loyalty.manage') async get(@Req() req: AuthRequest) {
    const program = (await this.database.pool.query(programSelect, [req.context.store.id]))
      .rows[0] ?? {
      enabled: false,
      name: 'Your everyday rewards',
      description: '',
      earnPercent: '3.00',
      redeemPercent: '100.00',
      version: 0,
    };
    const members = (
      await this.database.pool.query(
        'SELECT count(*)::int AS total FROM loyalty_memberships WHERE store_id=$1',
        [req.context.store.id],
      )
    ).rows[0].total;
    return { program, members };
  }
  @Get('members') @Require('loyalty.manage') members(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      z
        .object({
          from: z.iso.date(),
          to: z.iso.date(),
          page: z.coerce.number().int().min(1).max(1000000).default(1),
        })
        .refine((v) => v.from <= v.to, 'Start date must not follow end date'),
      input,
    );
    return loyaltyMembers(this.database.pool, req.context.store.id, req.context.store.timezone, b);
  }
  @Put('program') @Require('loyalty.manage') async save(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(loyaltyProgramSchema, input);
    return this.operations.transaction(async (c) => {
      const params = [
        req.context.store.id,
        b.enabled,
        b.name,
        b.description,
        b.earnPercent,
        b.redeemPercent ?? null,
      ];
      const result =
        b.version === 0
          ? await c.query(
              'INSERT INTO loyalty_programs(store_id,enabled,name,description,earn_percent,redeem_percent) VALUES($1,$2,$3,$4,$5,COALESCE($6::numeric,100)) ON CONFLICT(store_id) DO NOTHING RETURNING version',
              params,
            )
          : await c.query(
              'UPDATE loyalty_programs SET enabled=$2,name=$3,description=$4,earn_percent=$5,redeem_percent=COALESCE($6::numeric,redeem_percent),version=version+1,updated_at=now() WHERE store_id=$1 AND version=$7 RETURNING version',
              [...params, b.version],
            );
      if (!result.rowCount)
        throw new ConflictException('The loyalty program changed. Reload and try again.');
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Loyalty program updated',
        req.context.store.id,
        b,
      );
      return { ok: true };
    });
  }
}

@Controller('integrations/customer/v1')
@UseGuards(CustomerServiceGuard)
export class CustomerIntegrationController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get('shop-directory') async directory() {
    return (
      await this.database.pool.query(
        `SELECT s.id,s.name,s.currency,s.address,s.phone,s.business_number AS "businessNumber",COALESCE(p.name,'') AS "programName",COALESCE(p.description,'') AS description,COALESCE(p.enabled,false) AS "loyaltyEnabled",COALESCE(p.earn_percent,0)::text AS "earnPercent",COALESCE(p.redeem_percent,100)::text AS "redeemPercent" FROM stores s LEFT JOIN loyalty_programs p ON p.store_id=s.id ORDER BY s.name,s.id`,
      )
    ).rows;
  }
  @Get('stores') async stores() {
    return (
      await this.database.pool.query(
        `SELECT s.id,s.name,s.currency,s.address,s.phone,s.business_number AS "businessNumber",p.name AS "programName",p.description,p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent" FROM stores s JOIN loyalty_programs p ON p.store_id=s.id WHERE p.enabled ORDER BY s.name,s.id`,
      )
    ).rows;
  }
  @Get('customers/:customer/memberships') async list(
    @Param('customer', ParseUUIDPipe) customer: string,
    @Query('storeId') input?: string,
  ) {
    const store = input === undefined ? null : parse(z.string().uuid(), input);
    const rows = (
      await this.database.pool.query(
        `SELECT m.id,m.store_id AS "storeId",s.name AS "storeName",s.currency,p.name AS "programName",p.enabled,p.description,p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent",COALESCE(wallet.balance,0)::numeric(14,2)::text AS balance,GREATEST(0,-COALESCE(wallet.used,0))::numeric(30,2)::text AS "totalSaved" FROM loyalty_memberships m JOIN stores s ON s.id=m.store_id JOIN loyalty_programs p ON p.store_id=m.store_id LEFT JOIN LATERAL (SELECT sum(e.amount) AS balance,sum(e.amount) FILTER (WHERE e.kind IN ('redeemed','refund_redeemed')) AS used FROM loyalty_entries e WHERE e.membership_id=m.id AND e.store_id=m.store_id) wallet ON true WHERE m.customer_subject=$1 AND ($2::uuid IS NULL OR m.store_id=$2) ORDER BY m.created_at`,
        [customer, store],
      )
    ).rows;
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(row.enabled
          ? await issueLoyaltyQr(this.database.pool, customer, row.id)
          : { qrCode: '', qrExpiresAt: null, qrServerTime: null }),
      })),
    );
  }
  @Post('customers/:customer/memberships/:id/qr') issueQr(
    @Param('customer', ParseUUIDPipe) customer: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return issueLoyaltyQr(this.database.pool, customer, id);
  }
  @Post('customers/:customer/stores/:store/join') join(
    @Param('customer', ParseUUIDPipe) customer: string,
    @Param('store', ParseUUIDPipe) store: string,
  ) {
    return this.operations.transaction(async (c) => {
      const program = (
        await c.query(
          'SELECT store_id FROM loyalty_programs WHERE store_id=$1 AND enabled FOR SHARE',
          [store],
        )
      ).rows[0];
      if (!program) throw new NotFoundException('This shop is not accepting memberships.');
      await c.query(
        'INSERT INTO loyalty_memberships(store_id,customer_subject,card_token) VALUES($1,$2,$3) ON CONFLICT(store_id,customer_subject) DO NOTHING',
        [store, customer, token()],
      );
      return { ok: true };
    });
  }
  @Get('customers/:customer/activity') async activity(
    @Param('customer', ParseUUIDPipe) customer: string,
    @Query('storeId') input?: string,
  ) {
    const store = input === undefined ? null : parse(z.string().uuid(), input);
    return (
      await this.database.pool.query(
        `SELECT e.id,e.kind,e.amount::text,e.created_at AS "createdAt",e.store_id AS "storeId",s.name AS "storeName",s.currency FROM loyalty_entries e JOIN loyalty_memberships m ON m.id=e.membership_id JOIN stores s ON s.id=e.store_id WHERE m.customer_subject=$1 AND ($2::uuid IS NULL OR e.store_id=$2) ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
        [customer, store],
      )
    ).rows;
  }
  @Get('news') async news(@Query('storeId') input?: string) {
    const store = input === undefined ? null : parse(z.string().uuid(), input);
    return (
      await this.database.pool.query(
        `SELECT n.id,n.title,n.body,n.published_at AS "publishedAt",n.updated_at AS "updatedAt",s.id AS "storeId",s.name AS "storeName" FROM shop_news n JOIN stores s ON s.id=n.store_id WHERE n.published AND ($1::uuid IS NULL OR n.store_id=$1) ORDER BY n.published_at DESC,n.id DESC LIMIT 100`,
        [store],
      )
    ).rows;
  }
  @Get('campaigns') async campaigns(@Query('storeId') input?: string) {
    const store = input === undefined ? null : parse(z.string().uuid(), input);
    return (
      await this.database.pool.query(
        `SELECT c.id,c.title,c.description,c.image,r.id AS "promotionId",r.starts_at AS "startsAt",r.ends_at AS "endsAt",
       r.discount_type AS "discountType",r.discount_value::text AS "discountValue",s.currency,
       s.name AS "storeName",s.id AS "storeId",
       COALESCE((SELECT jsonb_agg(p.name ORDER BY p.name) FROM promotion_products pp
         JOIN products p ON p.id=pp.product_id AND p.store_id=pp.store_id
         WHERE pp.promotion_id=r.id AND pp.store_id=r.store_id),'[]'::jsonb) AS products,
       COALESCE((SELECT jsonb_agg(cat.name ORDER BY cat.name) FROM promotion_categories pc
         JOIN categories cat ON cat.id=pc.category_id AND cat.store_id=pc.store_id
         WHERE pc.promotion_id=r.id AND pc.store_id=r.store_id),'[]'::jsonb) AS categories
       FROM promotion_campaigns c JOIN promotions r ON r.id=c.promotion_id AND r.store_id=c.store_id
       JOIN stores s ON s.id=c.store_id
       WHERE c.published AND r.enabled AND r.cancelled_at IS NULL AND ($1::uuid IS NULL OR c.store_id=$1)
         AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())
       ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,
        [store],
      )
    ).rows;
  }
  // Compatibility for customer servers deployed before promotion campaigns.
  @Get('customers/:customer/campaigns') customerCampaigns(
    @Param('customer', ParseUUIDPipe) _customer: string,
  ) {
    return this.campaigns();
  }
  @Post('customers/:customer/memberships/:id/redemptions') redeem() {
    throw new GoneException('Use the refreshing membership QR code.');
  }
}

@Controller('pos/loyalty')
export class PosLoyaltyController {
  constructor(
    private operations: Operations,
    private registers: RegisterService,
  ) {}
  @Post('resolve') resolve(@Body() input: unknown, @Req() req: Request) {
    const b = parse(loyaltySaleSchema, input);
    return this.operations.transaction(async (c) => {
      const a = await this.registers.operator(c, req);
      const { qrToken, ...member } = await membership(c, a.storeId, b.code, true);
      return { ...member, code: await claimLoyaltyQr(c, a, b.code, qrToken) };
    });
  }
}

export async function prepareLoyalty(
  c: PoolClient,
  store: string,
  input: z.infer<typeof loyaltySaleSchema> | undefined,
  lines: Receipt['lines'],
  actor: Actor,
) {
  if (!input) return;
  const member = await membership(c, store, input.code, true, actor);
  const mode = input.mode ?? 'collect';
  if (mode === 'spend' && toScaled(member.balance, 2) <= 0n)
    throw new ConflictException(
      'No bonuses are available. Scan the card again and choose Collect.',
    );
  const calculation = applyLoyaltyDiscount(lines, { ...member, mode });
  if (mode === 'spend' && toScaled(calculation.spent, 2) === 0n)
    throw new ConflictException('No points can be used for this purchase. Choose Collect.');
  if (
    input.expectedSpent !== undefined &&
    toScaled(input.expectedSpent, 2) !== toScaled(calculation.spent, 2)
  )
    throw new ConflictException(
      'The available points or redemption limit changed. Scan the card again before paying.',
    );
  lines.splice(0, lines.length, ...calculation.lines);
  const earned = toScaled(calculation.earned, 2),
    spend = toScaled(calculation.spent, 2);
  return {
    membershipId: member.id,
    mode,
    earned: fromScaled(earned, 2),
    spent: fromScaled(spend, 2),
    balanceAfter: fromScaled(toScaled(member.balance, 2) + earned - spend, 2),
    qrHash: member.qrToken.token_hash,
  };
}
export async function commitLoyalty(
  c: PoolClient,
  store: string,
  sale: string,
  plan: Awaited<ReturnType<typeof prepareLoyalty>>,
) {
  if (!plan) return;
  for (const [kind, amount] of [
    ['earned', plan.earned],
    ['redeemed', fromScaled(-toScaled(plan.spent, 2), 2)],
  ])
    if (toScaled(amount, 2) !== 0n)
      await c.query(
        'INSERT INTO loyalty_entries(store_id,membership_id,kind,amount,sale_id) VALUES($1,$2,$3,$4,$5)',
        [store, plan.membershipId, kind, amount, sale],
      );
  const used = await c.query(
    'UPDATE loyalty_qr_tokens SET sale_id=$2 WHERE token_hash=$1 AND sale_id IS NULL',
    [plan.qrHash, sale],
  );
  if (used.rowCount !== 1) throw new ConflictException(expiredLoyaltyQr);
}
export async function refundLoyalty(
  c: PoolClient,
  store: string,
  sale: string,
  refund: string,
  original: Receipt,
  changes: { earned: bigint; spent: bigint },
) {
  if (!original.loyalty) return;
  const member = (
    await c.query('SELECT id FROM loyalty_memberships WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      original.loyalty.membershipId,
      store,
    ])
  ).rows[0];
  if (!member) throw new ConflictException('Original loyalty membership is unavailable.');
  for (const [kind, amount] of [
    ['refund_earned', -changes.earned],
    ['refund_redeemed', changes.spent],
  ] as const)
    if (amount !== 0n)
      await c.query(
        'INSERT INTO loyalty_entries(store_id,membership_id,kind,amount,sale_id,refund_id) VALUES($1,$2,$3,$4,$5,$6)',
        [store, member.id, kind, fromScaled(amount, 2), sale, refund],
      );
}
@Module({
  imports: [AuthModule, RegisterModule],
  providers: [CustomerServiceGuard, Operations],
  controllers: [
    LoyaltyManagementController,
    CustomerIntegrationController,
    PosLoyaltyController,
    ShopNewsController,
  ],
})
export class LoyaltyModule {}
