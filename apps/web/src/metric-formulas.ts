import { t } from './i18n';

// Shared explanations for Overview and Analytics; these describe the existing calculations.
const formulas: Record<string, () => string> = {
  Revenue: () => t('Revenue = completed sales after discounts − refunds.'),
  'Cost of goods sold': () =>
    t(
      'Cost of goods sold = cost recorded for sold goods − original cost of returned goods. Current product costs are not used.',
    ),
  'Gross profit': () => t('Gross profit = revenue − cost of goods sold.'),
  'Gross margin': () =>
    t('Gross margin = gross profit ÷ revenue × 100%. Calculated only when revenue is positive.'),
  'Inventory losses': () =>
    t(
      'Inventory losses = cost of expired and damaged stock written off + cost of returned goods that cannot be resold.',
    ),
  'Operating expenses': () =>
    t(
      'Operating expenses = one-time expenses dated within the period + the period’s share of expenses distributed over time. Only recorded expenses are included.',
    ),
  'Store operating profit': () =>
    t(
      'Store operating profit = revenue − cost of goods sold − inventory losses − operating expenses.',
    ),
  'Average basket': () =>
    t(
      'Average basket = completed sales after discounts, before refunds ÷ number of completed receipts.',
    ),
  'Average per matching receipt': () =>
    t(
      'Average per matching receipt = sales of the selected product after discounts, before refunds ÷ number of receipts containing that product.',
    ),
  'Sales before refunds': () =>
    t('Sales before refunds = sum of completed sale amounts after discounts, before refunds.'),
  Refunds: () => t('Refunds = sum of completed refunds recorded in the selected period.'),
  'Sales less refunds': () => t('Sales less refunds = completed sales after discounts − refunds.'),
  Discounts: () => t('Discounts = sum of discounts recorded on completed sale lines.'),
};
export function metricFormula(label: string) {
  return Object.hasOwn(formulas, label) ? formulas[label]() : undefined;
}
