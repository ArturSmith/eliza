import { PurchaseDocumentError } from './purchase-document-error.js';
import 'reflect-metadata';
import {
  Catch,
  Controller,
  ExceptionFilter,
  ArgumentsHost,
  Get,
  HttpException,
  ServiceUnavailableException,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { validateProduction } from './production.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { expectedMigrations } from './migration-health.js';
import { randomUUID } from 'node:crypto';
import { Database, DatabaseModule } from './database.js';
import { AuthModule } from './auth.js';
import { CatalogModule } from './catalog.js';
import { StockCountsModule } from './stock-counts.js';
import { InventoryModule } from './inventory.js';
import { ManagementModule } from './management.js';
import { TeamModule } from './team.js';
import { RegisterModule } from './register.js';
import { RefundModule } from './refunds.js';
import { StoreSettingsModule } from './store-settings.js';
import { GrossProfitModule } from './gross-profit.js';
import { AnalyticsModule } from './analytics.js';
import { OwnerDashboardModule } from './owner-dashboard.js';
import { SalesSummaryModule } from './sales-summary.js';
import { PurchasingModule } from './purchasing.js';
import { ScannedDocumentsModule } from './scanned-documents.js';
import { AiAgentModule } from './ai-agent.js';
import { CheckoutModule } from './checkout.js';
import { PriceTagsModule } from './price-tags.js';
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      res.status(error.getStatus()).json({
        message: error.message,
        ...(error instanceof PurchaseDocumentError ? { details: error.details } : {}),
      });
      return;
    }
    const err = error as {
      code?: string;
      type?: string;
      cause?: { code?: string };
      stack?: string;
    };
    const code = err.code ?? err.cause?.code;
    // Previously surfaced as an opaque 500, which told the user nothing about
    // what to do next.
    if (err.type === 'entity.too.large') {
      res
        .status(413)
        .json({ message: 'This upload is too large. Use a smaller or lower-resolution file.' });
      return;
    }
    if (code === '23505') {
      res.status(409).json({
        message:
          'This code or record is already registered. Check the employee code, SKU, PLU, email, or barcode.',
      });
      return;
    }
    if (code === '23514' || code === '22003') {
      res.status(400).json({ message: 'This value is outside the allowed range.' });
      return;
    }
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: res.getHeader('X-Request-Id'),
        stack: err.stack,
      }),
    );
    res
      .status(500)
      .json({ message: 'Something went wrong. Your change was not confirmed. Please try again.' });
  }
}
@Controller('health')
class HealthController {
  constructor(private database: Database) {}
  @Get() async health() {
    try {
      const applied = (
        await this.database.pool.query('SELECT name,checksum FROM schema_migrations')
      ).rows;
      if (
        !expectedMigrations.every((m) =>
          applied.some((r) => r.name === m.name && r.checksum === m.checksum),
        )
      )
        throw new Error('Migrations pending');
    } catch {
      throw new ServiceUnavailableException(
        'Database is unavailable or migrations need attention. Run the operational check.',
      );
    }
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    StockCountsModule,
    ManagementModule,
    TeamModule,
    RegisterModule,
    CheckoutModule,
    PriceTagsModule,
    PurchasingModule,
    ScannedDocumentsModule,
    AiAgentModule,
    SalesSummaryModule,
    AnalyticsModule,
    OwnerDashboardModule,
    GrossProfitModule,
    StoreSettingsModule,
    RefundModule,
  ],
  controllers: [HealthController],
})
class AppModule {}
export async function createApp() {
  validateProduction();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    // Configured below instead, so the document upload route can carry a photo
    // without widening the limit for every other endpoint.
    bodyParser: false,
  });
  // Document photos only. Everything else keeps the tight default: `verify`
  // sees the fully buffered body, so the cap is enforced on actual bytes rather
  // than on a Content-Length header the client controls.
  app.useBodyParser('json', {
    limit: '12mb',
    verify: (req: Request, _res: Response, buf: Buffer) => {
      const route = req.method === 'POST' ? req.url?.split('?')[0] : '';
      if (
        (route === '/api/purchases/extract' && buf.length <= 6 * 1024 * 1024) ||
        (route === '/api/documents/scan' && buf.length <= 12 * 1024 * 1024) ||
        (/^\/api\/documents\/[0-9a-f-]{36}\/save$/i.test(route) && buf.length <= 8 * 1024 * 1024) ||
        buf.length <= 100 * 1024
      )
        return;
      throw Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });
    },
  });
  // Only opt in behind a controlled ingress. Never trust arbitrary forwarded headers.
  const proxy = process.env.TRUST_PROXY;
  if (proxy)
    app.set(
      'trust proxy',
      /^\d+$/.test(proxy) ? Number(proxy) : proxy.split(',').map((v) => v.trim()),
    );
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () =>
      console.log(
        JSON.stringify({
          level: 'info',
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      ),
    );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
      if (req.headers.origin !== origin || req.headers['x-eliza-request'] !== '1') {
        res.status(403).json({ message: 'This request must come from the Eliza application.' });
        return;
      }
    }
    next();
  });
  app.useGlobalFilters(new Errors());
  if (process.env.SERVE_WEB === 'true') {
    const root = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    if (!existsSync(root + 'index.html'))
      throw new Error('Build the web application before startup.');
    app.useStaticAssets(root, { index: false, fallthrough: true });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        !['GET', 'HEAD'].includes(req.method) ||
        /^\/api(?:\/|$)/i.test(req.path) ||
        req.path.startsWith('/assets/') ||
        !req.accepts('html')
      )
        return next();
      res.sendFile(root + 'index.html');
    });
  }
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Eliza API')
      .setDescription(
        'Local store management foundation. JSON request schemas live in @eliza/contracts. Mutations require Origin and X-Eliza-Request: 1.',
      )
      .setVersion('0.1.0')
      .addCookieAuth('eliza_session')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  app.enableShutdownHooks();
  return app;
}
