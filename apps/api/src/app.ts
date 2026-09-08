import 'reflect-metadata';
import {
  Catch,
  Controller,
  ExceptionFilter,
  ArgumentsHost,
  Get,
  HttpException,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Database, DatabaseModule } from './database.js';
import { AuthModule } from './auth.js';
import { CatalogModule } from './catalog.js';
import { InventoryModule } from './inventory.js';
import { ManagementModule } from './management.js';
import { TeamModule } from './team.js';
import { RegisterModule } from './register.js';
import { RefundModule } from './refunds.js';
import { SalesSummaryModule } from './sales-summary.js';
import { PurchasingModule } from './purchasing.js';
import { CheckoutModule } from './checkout.js';
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      res.status(error.getStatus()).json({ message: error.message });
      return;
    }
    const err = error as { code?: string; cause?: { code?: string }; stack?: string };
    const code = err.code ?? err.cause?.code;
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
    await this.database.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    ManagementModule,
    TeamModule,
    RegisterModule,
    CheckoutModule,
    PurchasingModule,
    SalesSummaryModule,
    RefundModule,
  ],
  controllers: [HealthController],
})
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
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
