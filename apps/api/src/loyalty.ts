import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
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
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  applyLoyaltyDiscount,
  loyaltyProgramSchema,
  loyaltyCampaignSchema,
  loyaltySaleSchema,
  toScaled,
  fromScaled,
  type Receipt,
  type LoyaltyMember,
} from '@eliza/contracts';
import { Database } from './database.js';
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
): Promise<LoyaltyMember & { redemptionHash?: string }> {
  const input = parse(loyaltySaleSchema, { code }).code;
  const redeem = input.startsWith('ELIZA-REDEEM:');
  const row = (
    await c.query(
      `SELECT m.id,p.name AS "programName",p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent",s.currency
 FROM loyalty_memberships m JOIN loyalty_programs p ON p.store_id=m.store_id JOIN stores s ON s.id=m.store_id
 WHERE m.store_id=$1 AND p.enabled AND ${redeem ? 'm.id=(SELECT membership_id FROM loyalty_redemptions WHERE token_hash=$2 AND store_id=$1)' : 'm.card_token=$2'} ${lock ? 'FOR UPDATE OF m' : ''}`,
      [store, redeem ? hash(input.slice(13)) : input.slice(14)],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('This loyalty card is not valid for this shop.');
  let authorization;
  if (redeem) {
    authorization = (
      await c.query(
        `SELECT max_points::text,expires_at,sale_id FROM loyalty_redemptions WHERE token_hash=$1 AND store_id=$2 ${lock ? 'FOR UPDATE' : ''}`,
        [hash(input.slice(13)), store],
      )
    ).rows[0];
    if (!authorization || authorization.sale_id || new Date(authorization.expires_at) <= new Date())
      throw new ConflictException('This bonus authorization has expired or was already used.');
  }
  const balance = (
    await c.query(
      'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS value FROM loyalty_entries WHERE membership_id=$1 AND store_id=$2',
      [row.id, store],
    )
  ).rows[0].value;
  return {
    ...row,
    code,
    balance,
    ...(authorization
      ? { maxPoints: authorization.max_points, redemptionHash: hash(input.slice(13)) }
      : {}),
  };
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
      redeemPercent: '20.00',
      version: 0,
    };
    const campaigns = (
      await this.database.pool.query(
        'SELECT id,title,description,published,starts_at AS "startsAt",ends_at AS "endsAt",version FROM loyalty_campaigns WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100',
        [req.context.store.id],
      )
    ).rows;
    const members = (
      await this.database.pool.query(
        'SELECT count(*)::int AS total FROM loyalty_memberships WHERE store_id=$1',
        [req.context.store.id],
      )
    ).rows[0].total;
    return { program, campaigns, members };
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
        b.redeemPercent,
      ];
      const result =
        b.version === 0
          ? await c.query(
              'INSERT INTO loyalty_programs(store_id,enabled,name,description,earn_percent,redeem_percent) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id) DO NOTHING RETURNING version',
              params,
            )
          : await c.query(
              'UPDATE loyalty_programs SET enabled=$2,name=$3,description=$4,earn_percent=$5,redeem_percent=$6,version=version+1,updated_at=now() WHERE store_id=$1 AND version=$7 RETURNING version',
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
  @Post('campaigns') @Require('loyalty.manage') create(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.saveCampaign(input, req);
  }
  @Put('campaigns/:id') @Require('loyalty.manage') update(
    @Body() input: unknown,
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.saveCampaign(input, req, id);
  }
  private async saveCampaign(input: unknown, req: AuthRequest, id?: string) {
    const b = parse(loyaltyCampaignSchema, input);
    return this.operations.transaction(async (c) => {
      const params = [
        req.context.store.id,
        b.title,
        b.description,
        b.published,
        b.startsAt,
        b.endsAt,
      ];
      const result = id
        ? await c.query(
            'UPDATE loyalty_campaigns SET title=$2,description=$3,published=$4,starts_at=$5,ends_at=$6,version=version+1 WHERE store_id=$1 AND id=$7 AND version=$8 RETURNING id',
            [...params, id, b.version],
          )
        : await c.query(
            'INSERT INTO loyalty_campaigns(store_id,title,description,published,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
            params,
          );
      if (!result.rowCount)
        throw new ConflictException(
          'The campaign changed or is unavailable. Reload and try again.',
        );
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Loyalty campaign saved',
        result.rows[0].id,
        { published: b.published, title: b.title },
      );
      return result.rows[0];
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
  @Get('stores') async stores() {
    return (
      await this.database.pool.query(
        `SELECT s.id,s.name,s.currency,p.name AS "programName",p.description,p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent" FROM stores s JOIN loyalty_programs p ON p.store_id=s.id WHERE p.enabled ORDER BY s.name,s.id`,
      )
    ).rows;
  }
  @Get('customers/:customer/memberships') async list(
    @Param('customer', ParseUUIDPipe) customer: string,
  ) {
    return (
      await this.database.pool.query(
        `SELECT m.id,m.store_id AS "storeId",s.name AS "storeName",s.currency,p.name AS "programName",p.enabled,p.description,p.earn_percent::text AS "earnPercent",p.redeem_percent::text AS "redeemPercent",COALESCE((SELECT sum(e.amount) FROM loyalty_entries e WHERE e.membership_id=m.id),0)::numeric(14,2)::text AS balance,'ELIZA-LOYALTY:'||m.card_token AS "qrCode" FROM loyalty_memberships m JOIN stores s ON s.id=m.store_id JOIN loyalty_programs p ON p.store_id=m.store_id WHERE m.customer_subject=$1 ORDER BY m.created_at`,
        [customer],
      )
    ).rows;
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
  ) {
    return (
      await this.database.pool.query(
        `SELECT e.id,e.kind,e.amount::text,e.created_at AS "createdAt",e.store_id AS "storeId",s.name AS "storeName",s.currency FROM loyalty_entries e JOIN loyalty_memberships m ON m.id=e.membership_id JOIN stores s ON s.id=e.store_id WHERE m.customer_subject=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
        [customer],
      )
    ).rows;
  }
  @Get('customers/:customer/campaigns') async campaigns(
    @Param('customer', ParseUUIDPipe) customer: string,
  ) {
    return (
      await this.database.pool.query(
        `SELECT c.id,c.title,c.description,c.starts_at AS "startsAt",c.ends_at AS "endsAt",s.name AS "storeName",s.id AS "storeId" FROM loyalty_campaigns c JOIN stores s ON s.id=c.store_id JOIN loyalty_programs p ON p.store_id=c.store_id JOIN loyalty_memberships m ON m.store_id=c.store_id WHERE m.customer_subject=$1 AND p.enabled AND c.published AND c.starts_at<=now() AND c.ends_at>now() ORDER BY c.created_at DESC LIMIT 100`,
        [customer],
      )
    ).rows;
  }
  @Post('customers/:customer/memberships/:id/redemptions') redeem(
    @Param('customer', ParseUUIDPipe) customer: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    const b = parse(
      z.object({
        points: z
          .string()
          .regex(/^\d{1,7}(\.\d{1,2})?$/)
          .refine((v) => toScaled(v, 2) > 0n),
      }),
      input,
    );
    return this.operations.transaction(async (c) => {
      const member = (
        await c.query(
          'SELECT m.* FROM loyalty_memberships m JOIN loyalty_programs p ON p.store_id=m.store_id WHERE m.id=$1 AND m.customer_subject=$2 AND p.enabled FOR UPDATE OF m',
          [id, customer],
        )
      ).rows[0];
      if (!member) throw new NotFoundException('Membership not found.');
      const balance = (
        await c.query(
          'SELECT COALESCE(sum(amount),0)::text AS value FROM loyalty_entries WHERE membership_id=$1',
          [id],
        )
      ).rows[0].value;
      if (toScaled(b.points, 2) > toScaled(balance, 2))
        throw new BadRequestException('Not enough available bonuses.');
      const secret = token(),
        expiresAt = new Date(Date.now() + 5 * 60_000);
      await c.query(
        'INSERT INTO loyalty_redemptions(token_hash,store_id,membership_id,max_points,expires_at) VALUES($1,$2,$3,$4,$5)',
        [hash(secret), member.store_id, id, b.points, expiresAt],
      );
      return {
        qrCode: 'ELIZA-REDEEM:' + secret,
        points: b.points,
        expiresAt: expiresAt.toISOString(),
      };
    });
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
      const { redemptionHash, ...member } = await membership(c, a.storeId, b.code);
      return member;
    });
  }
}

export async function prepareLoyalty(
  c: PoolClient,
  store: string,
  code: string | undefined,
  lines: Receipt['lines'],
) {
  if (!code) return;
  const member = await membership(c, store, code, true);
  const calculation = applyLoyaltyDiscount(lines, member);
  lines.splice(0, lines.length, ...calculation.lines);
  const earned = toScaled(calculation.earned, 2),
    spend = toScaled(calculation.spent, 2);
  return {
    membershipId: member.id,
    earned: fromScaled(earned, 2),
    spent: fromScaled(spend, 2),
    balanceAfter: fromScaled(toScaled(member.balance, 2) + earned - spend, 2),
    redemptionHash: member.redemptionHash,
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
  if (plan.redemptionHash)
    await c.query(
      'UPDATE loyalty_redemptions SET sale_id=$2 WHERE token_hash=$1 AND sale_id IS NULL',
      [plan.redemptionHash, sale],
    );
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
  controllers: [LoyaltyManagementController, CustomerIntegrationController, PosLoyaltyController],
})
export class LoyaltyModule {}
