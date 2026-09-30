import { Controller, Get, Module, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { FinancialMetricsModule, FinancialMetricsService } from './financial-metrics.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';

const range = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    productId: z.union([z.uuid(), z.literal('')]).default(''),
    shiftId: z.union([z.uuid(), z.literal('')]).default(''),
  })
  .refine((v) => v.from <= v.to, 'Start date must not follow end date')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 3660 * 86400000,
    'Choose ten years or less',
  );

@Controller('reports')
@UseGuards(AccessGuard)
export class GrossProfitController {
  constructor(private readonly metrics: FinancialMetricsService) {}

  @Get('gross-profit') @Require('costs.read') async report(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    if (!req.context.user.permissions.includes('sales.read'))
      throw new ForbiddenException('Sales reporting permission is required.');
    const b = parse(range, input);
    const summary = await this.metrics.getFinancialSummary(
      req.context.store.id,
      { from: b.from, to: b.to, timezone: req.context.store.timezone },
      { productId: b.productId, shiftId: b.shiftId },
    );
    return {
      from: b.from,
      to: b.to,
      currency: req.context.store.currency,
      timezone: req.context.store.timezone,
      completedSales: summary.breakdown.completedSales,
      completedRefunds: summary.adjustments.completedRefunds,
      netRevenue: summary.revenue,
      soldCost: summary.dataQuality.costComplete ? summary.breakdown.soldCost : null,
      restoredCost: summary.dataQuality.costComplete ? summary.breakdown.returnedCost : null,
      costOfGoodsSold: summary.cogs,
      grossProfit: summary.grossProfit,
      marginPercent: summary.grossMarginPercent,
      missingCostRecords: String(
        summary.dataQuality.missingCostSaleItems + summary.dataQuality.missingCostRefundLines,
      ),
    };
  }
}

@Module({ imports: [AuthModule, FinancialMetricsModule], controllers: [GrossProfitController] })
export class GrossProfitModule {}
