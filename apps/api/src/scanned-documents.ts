import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { documentDataSchema, validateDocument } from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
import { extractScannedDocument } from './scanned-document-vision.js';

const mimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const scanSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(40).max(11_000_000),
});
const saveSchema = z.object({ data: documentDataSchema, version: z.number().int().positive() });

function fileFromDataUrl(dataUrl: string) {
  const match =
    /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match) throw new BadRequestException('Upload a JPEG, PNG, WebP, or PDF file.');
  const mime = match[1] as (typeof mimeTypes)[number];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 8_000_000)
    throw new BadRequestException('Use a file smaller than 8 MB.');
  const valid =
    mime === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
            bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid)
    throw new BadRequestException(
      'The file contents do not match its type. Choose a valid document.',
    );
  return { mime, bytes };
}
@Controller('documents')
@UseGuards(AccessGuard)
export class ScannedDocumentsController {
  constructor(private database: Database) {}
  @Get() @Require('purchases.read') async list(@Req() req: AuthRequest, @Query('search') search?: string) {
    const query = parse(z.string().trim().max(100), search ?? '');
    return (
      await this.database.pool.query(
        `SELECT id,filename,document_type AS "documentType",status,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM scanned_documents WHERE store_id=$1 AND ($2='' OR filename ILIKE $3 OR edited->>'number' ILIKE $3 OR edited->>'title' ILIKE $3) ORDER BY created_at DESC LIMIT 100`,
        [req.context.store.id, query, '%' + query.replace(/[\\%_]/g, '\\$&') + '%'],
      )
    ).rows;
  }
  @Get(':id') @Require('purchases.read') async one(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const row = (
      await this.database.pool.query(
        `SELECT id,filename,mime_type AS "mimeType",document_type AS "documentType",extracted,edited,validation,status,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM scanned_documents WHERE id=$1 AND store_id=$2`,
        [id, req.context.store.id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Document not found.');
    return row;
  }
  @Get(':id/file') @Require('purchases.read') async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const row = (
      await this.database.pool.query(
        'SELECT mime_type,original_file FROM scanned_documents WHERE id=$1 AND store_id=$2',
        [id, req.context.store.id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Document not found.');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.original_file);
  }
  @Post('scan') @Require('purchases.write') async scan(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(scanSchema, input);
    const { mime, bytes } = fileFromDataUrl(body.dataUrl);
    const budget = await this.database.pool.query(
      `INSERT INTO auth_attempts(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.count+1 END,expires_at=CASE WHEN auth_attempts.expires_at<now() THEN now()+interval '1 minute' ELSE auth_attempts.expires_at END RETURNING count`,
      ['ai-universal-scan:' + req.context.store.id],
    );
    if (budget.rows[0].count > 5)
      throw new HttpException('Too many scans. Try again in a minute.', 429);
    const extracted = await extractScannedDocument(body.dataUrl, body.filename, mime, bytes);
    const validation = validateDocument(extracted);
    const row = (
      await this.database.pool.query(
        `INSERT INTO scanned_documents(store_id,created_by,device_id,filename,mime_type,original_file,extracted,edited,validation,document_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          req.context.store.id,
          req.context.user.id,
          req.context.device.id,
          body.filename,
          mime,
          bytes,
          JSON.stringify(extracted),
          JSON.stringify(extracted),
          JSON.stringify(validation),
          extracted.documentType,
        ],
      )
    ).rows[0];
    return this.one(row.id, req);
  }
  @Post(':id/save') @Require('purchases.write') async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(saveSchema, input);
    for (const table of body.data.tables) {
      if (table.rows.some((row) => row.cells.length !== table.columns.length))
        throw new BadRequestException('Each table row must match its columns.');
    }
    const validation = validateDocument(body.data);
    const updated = await this.database.pool.query(
      `UPDATE scanned_documents SET edited=$3,validation=$4,document_type=$5,status='saved',version=version+1,updated_at=now() WHERE id=$1 AND store_id=$2 AND version=$6 RETURNING id`,
      [
        id,
        req.context.store.id,
        JSON.stringify(body.data),
        JSON.stringify(validation),
        body.data.documentType,
        body.version,
      ],
    );
    if (!updated.rowCount) {
      const exists = await this.database.pool.query(
        'SELECT 1 FROM scanned_documents WHERE id=$1 AND store_id=$2',
        [id, req.context.store.id],
      );
      if (!exists.rowCount) throw new NotFoundException('Document not found.');
      throw new ConflictException(
        'This document changed since you opened it. Reopen it before saving.',
      );
    }
    return this.one(id, req);
  }
}
@Module({ imports: [AuthModule], controllers: [ScannedDocumentsController] })
export class ScannedDocumentsModule {}
