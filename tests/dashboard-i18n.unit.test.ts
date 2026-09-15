import { afterEach, expect, it } from 'vitest';
import { setLanguage } from '../apps/web/src/i18n';
import { dashboardText, dashboardSummary } from '../apps/web/src/i18n/dashboard';
import { ownerSummary } from '../packages/contracts/src/analytics';
afterEach(() => setLanguage('en'));
it('translates dynamic alerts without altering business names', () => {
  setLanguage('ru');
  expect(dashboardText('12 products are out of stock')).toBe('Нет в наличии: 12 товаров');
  expect(dashboardText('Unusual refund activity on Register Alpha')).toBe(
    'Необычная активность возвратов: Register Alpha',
  );
  expect(dashboardText('Fruit revenue')).toBe('Выручка: Fruit');
  expect(dashboardText('2.5 days left')).toBe('Осталось дней: 2.5');
  expect(dashboardText('Retail prices have already been reviewed.')).toBe(
    'Розничные цены уже пересмотрены.',
  );
});
it('translates week/month summaries and all measured drivers', () => {
  setLanguage('ru');
  for (const period of ['week', 'month'] as const) {
    const summary = ownerSummary({
      period,
      revenueChange: 10,
      grossProfitChange: -5,
      marginPointChange: -2,
      drivers: ['supplier cost increases', 'higher discounting', 'more waste'],
      wasteChange: 8,
    });
    expect(dashboardSummary(summary)).not.toMatch(/[A-Za-z]/);
    expect(
      dashboardSummary(
        ownerSummary({
          period,
          revenueChange: null,
          grossProfitChange: null,
          marginPointChange: null,
          drivers: [],
          wasteChange: null,
        }),
      ),
    ).not.toMatch(/[A-Za-z]/);
  }
});
it('keeps English server text unchanged', () => {
  setLanguage('en');
  expect(dashboardText('12 products are out of stock')).toBe('12 products are out of stock');
});
