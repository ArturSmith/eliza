import {
  Body,
  Controller,
  ForbiddenException,
  GoneException,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import {
  scannerPairSchema,
  scannerSyncSchema,
  scannerClaimSchema,
  scannerScanSchema,
} from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, Require, parse, hash, token, cookie, type AuthRequest } from './security.js';

// Validate the owning login on every phone request, including permission/device revocation.
const ownerJoin = `JOIN sessions os ON os.id=l.owner_session_id
 JOIN employees e ON e.id=l.employee_id AND e.id=os.employee_id AND e.store_id=l.store_id
 JOIN devices d ON d.id=l.device_id AND d.id=os.device_id AND d.store_id=l.store_id
 JOIN roles r ON r.id=e.role_id AND r.store_id=l.store_id JOIN stores st ON st.id=l.store_id`;
const ownerLive = `os.expires_at>now() AND e.active AND d.active AND d.type='management'
 AND (r.permissions ? 'catalog.write' OR EXISTS(SELECT 1 FROM employee_roles er JOIN roles ar ON ar.id=er.role_id AND ar.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=l.store_id AND ar.permissions ? 'catalog.write'))
 AND l.expires_at>now() AND l.revoked_at IS NULL`;
const eventColumns = `id,barcode,target_id AS "targetId",status`;
@Injectable()
export class PhoneScanner {
  constructor(private operations: Operations) {}
  private async link(c: PoolClient, req: Request, id?: string, claim?: string) {
    const mobile = req.headers['x-scanner-token'];
    if (!id && !claim && (typeof mobile !== 'string' || !/^[a-f0-9]{64}$/.test(mobile)))
      throw new GoneException('Scanner connection ended. Connect again from the laptop.');
    const where = id
      ? 'l.id=$1 AND os.token_hash=$2'
      : claim
        ? 'l.pairing_token_hash=$1 AND l.pair_expires_at>now()'
        : 'l.phone_token_hash=$1';
    const row = (
      await c.query(
        `SELECT l.*,st.name AS "shopName" FROM scanner_links l ${ownerJoin} WHERE ${ownerLive} AND ${where} FOR UPDATE OF l FOR SHARE OF os,e,d,r`,
        id ? [id, hash(cookie(req, 'eliza_session'))] : [hash(claim ?? String(mobile))],
      )
    ).rows[0];
    if (!row) throw new GoneException('Scanner connection ended. Connect again from the laptop.');
    return row;
  }
  async pair(req: AuthRequest, input: unknown) {
    const b = parse(scannerPairSchema, input);
    return this.operations.transaction(async (c) => {
      const owner = (
        await c.query(
          `SELECT os.id,os.expires_at FROM sessions os JOIN employees e ON e.id=os.employee_id JOIN devices d ON d.id=os.device_id JOIN roles r ON r.id=e.role_id AND r.store_id=e.store_id
    WHERE os.token_hash=$1 AND os.expires_at>now() AND e.active AND d.active AND d.type='management' AND e.id=$2 AND e.store_id=$3 AND d.store_id=$3
    AND (r.permissions ? 'catalog.write' OR EXISTS(SELECT 1 FROM employee_roles er JOIN roles ar ON ar.id=er.role_id AND ar.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND ar.permissions ? 'catalog.write')) FOR SHARE OF os,e,d,r`,
          [hash(cookie(req, 'eliza_session')), req.context.user.id, req.context.store.id],
        )
      ).rows[0];
      if (!owner) throw new ForbiddenException('Your access changed. Sign in again.');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'scanner:' + owner.id,
      ]);
      await c.query(
        "DELETE FROM scanner_links WHERE id IN(SELECT id FROM scanner_links WHERE expires_at<now()-interval '1 day' LIMIT 100)",
      );
      await c.query(
        'UPDATE scanner_links SET revoked_at=now() WHERE owner_session_id=$1 AND tab_id=$2 AND revoked_at IS NULL AND expires_at<=now()',
        [owner.id, b.tabId],
      );
      let l = (
        await c.query(
          'SELECT id FROM scanner_links WHERE owner_session_id=$1 AND tab_id=$2 AND revoked_at IS NULL FOR UPDATE',
          [owner.id, b.tabId],
        )
      ).rows[0];
      if (!l) {
        const count = (
          await c.query(
            'SELECT count(*)::int AS n FROM scanner_links WHERE owner_session_id=$1 AND revoked_at IS NULL AND expires_at>now()',
            [owner.id],
          )
        ).rows[0].n;
        if (count >= 10)
          throw new ConflictException(
            'Disconnect another phone scanner before creating a new connection.',
          );
        l = (
          await c.query(
            `INSERT INTO scanner_links(store_id,owner_session_id,employee_id,device_id,tab_id,expires_at) VALUES($1,$2,$3,$4,$5,LEAST($6::timestamptz,now()+interval '8 hours')) RETURNING id`,
            [
              req.context.store.id,
              owner.id,
              req.context.user.id,
              req.context.device.id,
              b.tabId,
              owner.expires_at,
            ],
          )
        ).rows[0];
        await audit(
          c,
          {
            storeId: req.context.store.id,
            employeeId: req.context.user.id,
            deviceId: req.context.device.id,
          },
          'Phone scanner connection created',
          l.id,
          {},
        );
      }
      const secret = token();
      const result = (
        await c.query(
          `UPDATE scanner_links SET pairing_token_hash=$2,pair_expires_at=LEAST(expires_at,now()+interval '5 minutes') WHERE id=$1 RETURNING id,pair_expires_at AS "pairExpiresAt",expires_at AS "expiresAt"`,
          [l.id, hash(secret)],
        )
      ).rows[0];
      return { ...result, pairingToken: secret, shopName: req.context.store.name };
    });
  }
  async sync(req: Request, id: string, input: unknown) {
    const b = parse(scannerSyncSchema, input);
    return this.operations.transaction(async (c) => {
      const l = await this.link(c, req, id);
      if (b.ackId)
        await c.query(
          "UPDATE scanner_link_scans SET status='delivered',delivered_at=COALESCE(delivered_at,now()) WHERE link_id=$1 AND id=$2 AND status='pending'",
          [id, b.ackId],
        );
      if (l.target_id !== b.targetId)
        await c.query(
          "UPDATE scanner_link_scans SET status='cancelled' WHERE link_id=$1 AND status='pending'",
          [id],
        );
      await c.query(
        "UPDATE scanner_links SET target_id=$2,target_label=$3,desktop_seen_at=now(),ready_until=CASE WHEN $4::boolean AND $2::uuid IS NOT NULL THEN now()+interval '8 seconds' ELSE NULL END WHERE id=$1",
        [id, b.targetId, b.label, b.ready],
      );
      const event =
        b.ready && b.targetId
          ? ((
              await c.query(
                `SELECT ${eventColumns} FROM scanner_link_scans WHERE link_id=$1 AND target_id=$2 AND status='pending'`,
                [id, b.targetId],
              )
            ).rows[0] ?? null)
          : null;
      return {
        id,
        claimed: !!l.phone_token_hash,
        phoneOnline: !!l.phone_seen_at && Date.now() - new Date(l.phone_seen_at).getTime() < 30000,
        expiresAt: l.expires_at,
        event,
      };
    });
  }
  async disconnect(req: AuthRequest, id: string) {
    return this.operations.transaction(async (c) => {
      await this.link(c, req, id);
      await c.query(
        'UPDATE scanner_links SET revoked_at=now(),phone_token_hash=NULL,pairing_token_hash=NULL,ready_until=NULL WHERE id=$1',
        [id],
      );
      await c.query(
        "UPDATE scanner_link_scans SET status='cancelled' WHERE link_id=$1 AND status='pending'",
        [id],
      );
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Phone scanner disconnected',
        id,
        {},
      );
      return { disconnected: true };
    });
  }
  async claim(req: Request, input: unknown) {
    const b = parse(scannerClaimSchema, input);
    return this.operations.transaction(async (c) => {
      const l = await this.link(c, req, undefined, b.pairingToken),
        secret = token();
      await c.query(
        'UPDATE scanner_links SET phone_token_hash=$2,phone_seen_at=now(),pairing_token_hash=NULL,pair_expires_at=NULL WHERE id=$1',
        [l.id, hash(secret)],
      );
      return { credential: secret, shopName: l.shopName, expiresAt: l.expires_at };
    });
  }
  async phoneStatus(req: Request) {
    return this.operations.transaction(async (c) => {
      const l = await this.link(c, req);
      await c.query('UPDATE scanner_links SET phone_seen_at=now() WHERE id=$1', [l.id]);
      const lastScan =
        (
          await c.query(
            `SELECT ${eventColumns} FROM scanner_link_scans WHERE link_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
            [l.id],
          )
        ).rows[0] ?? null;
      return {
        shopName: l.shopName,
        expiresAt: l.expires_at,
        ready: !!l.target_id && !!l.ready_until && new Date(l.ready_until).getTime() > Date.now(),
        targetId: l.target_id,
        label: l.target_label,
        lastScan,
      };
    });
  }
  async scan(req: Request, input: unknown) {
    const b = parse(scannerScanSchema, input);
    return this.operations.transaction(async (c) => {
      const l = await this.link(c, req);
      const old = (
        await c.query(`SELECT ${eventColumns} FROM scanner_link_scans WHERE link_id=$1 AND id=$2`, [
          l.id,
          b.id,
        ])
      ).rows[0];
      if (old) {
        if (old.barcode !== b.barcode || old.targetId !== b.targetId)
          throw new ConflictException('This scan request was already used.');
        return old;
      }
      if (
        l.target_id !== b.targetId ||
        !l.ready_until ||
        new Date(l.ready_until).getTime() <= Date.now()
      )
        throw new ConflictException('Open the product form on the laptop, then scan again.');
      if (
        (
          await c.query("SELECT 1 FROM scanner_link_scans WHERE link_id=$1 AND status='pending'", [
            l.id,
          ])
        ).rowCount
      )
        throw new ConflictException('Wait for the laptop to receive the previous barcode.');
      if (
        (
          await c.query(
            "SELECT 1 FROM scanner_link_scans WHERE link_id=$1 AND created_at>now()-interval '1 second'",
            [l.id],
          )
        ).rowCount
      )
        throw new HttpException('Move the barcode away before scanning again.', 429);
      await c.query('UPDATE scanner_links SET phone_seen_at=now() WHERE id=$1', [l.id]);
      return (
        await c.query(
          `INSERT INTO scanner_link_scans(link_id,id,target_id,barcode) VALUES($1,$2,$3,$4) RETURNING ${eventColumns}`,
          [l.id, b.id, b.targetId, b.barcode],
        )
      ).rows[0];
    });
  }
}
@Controller('scanner-links')
@UseGuards(AccessGuard)
@Require('catalog.write')
class ScannerDesktopController {
  constructor(private scanner: PhoneScanner) {}
  @Post() pair(@Req() req: AuthRequest, @Body() b: unknown) {
    return this.scanner.pair(req, b);
  }
  @Post(':id/sync') sync(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.scanner.sync(req, id, b);
  }
  @Post(':id/disconnect') disconnect(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scanner.disconnect(req, id);
  }
}
@Controller('scanner-phone')
class ScannerPhoneController {
  constructor(private scanner: PhoneScanner) {}
  @Post('claim') claim(@Req() req: Request, @Body() b: unknown) {
    return this.scanner.claim(req, b);
  }
  @Post('status') status(@Req() req: Request) {
    return this.scanner.phoneStatus(req);
  }
  @Post('scans') scan(@Req() req: Request, @Body() b: unknown) {
    return this.scanner.scan(req, b);
  }
}
@Module({
  imports: [AuthModule],
  controllers: [ScannerDesktopController, ScannerPhoneController],
  providers: [PhoneScanner, Operations],
})
export class PhoneScannerModule {}
