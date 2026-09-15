import { getLocale, t } from './index';
const templates = [
  '{n} products are out of stock',
  '{n} of them sold in the last 7 days.',
  '{n} products run out within {d} days',
  '{n} days left',
  '{n} products are below minimum stock',
  'Purchase cost increased on {n} products',
  'Purchase costs increased on {n} products',
  '{n} still have unchanged retail prices.',
  '{n} products sell below cost',
  'Refund rate is {n}% of sales',
  'The usual rate is {n}%.',
  'Unusual refund activity on {name}',
  'Refund rate {n}% against a store average of {b}%. Worth reviewing the transactions.',
  'Discount value is {n}% above normal',
  'Waste is {n}% above normal',
  '{n} shifts closed with a cash difference',
  '{n} shifts have been open over {h} hours',
  '{n}h',
  '{n} products have not sold in {d} days',
  '{n} products are missing a purchase cost',
  '{n} products have no opening stock count',
  '{name} revenue',
];
export function dashboardText(value: string): string {
  if (getLocale() !== 'ru-RU') return value;
  for (const template of templates) {
    const names: string[] = [];
    const pattern = template
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          const name = part.slice(1, -1);
          names.push(name);
          return name === 'name' ? '(.+)' : '([+−-]?\\d+(?:\\.\\d+)?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    const match = new RegExp('^' + pattern + '$').exec(value);
    if (match) return t(template, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return t(value);
}
export function dashboardSummary(value: string): string {
  if (getLocale() !== 'ru-RU') return value;
  return value
    .replace(
      /Not enough comparable history yet to describe how this (week|month) compares\./g,
      (_, p) =>
        p === 'week'
          ? 'Пока недостаточно истории для сравнения этой недели.'
          : 'Пока недостаточно истории для сравнения этого месяца.',
    )
    .replace(
      /Sales (increased|decreased) ([\d.]+)% this (week|month)/g,
      (_, d, n, p) =>
        'Продажи ' +
        (d === 'increased' ? 'выросли' : 'снизились') +
        ' на ' +
        n +
        '% ' +
        (p === 'week' ? 'за эту неделю' : 'за этот месяц'),
    )
    .replace(
      / while gross profit (increased|decreased) ([\d.]+)%/g,
      (_, d, n) =>
        ', а валовая прибыль ' + (d === 'increased' ? 'выросла' : 'снизилась') + ' на ' + n + '%',
    )
    .replace(
      /Gross margin (increased|decreased) ([\d.]+) percentage points/g,
      (_, d, n) =>
        'Валовая маржа ' + (d === 'increased' ? 'выросла' : 'снизилась') + ' на ' + n + ' п. п.',
    )
    .replace(', associated with ', ', что связано с ')
    .replace('supplier cost increases', 'ростом закупочных цен')
    .replace('higher discounting', 'увеличением скидок')
    .replace('more waste', 'ростом списаний')
    .replace(' and ', ' и ')
    .replace('Review the margin drivers below.', 'Посмотрите ниже факторы изменения маржи.')
    .replace(
      /Waste (improved|worsened) by ([\d.]+)%/g,
      (_, d, n) => 'Списания ' + (d === 'improved' ? 'снизились' : 'выросли') + ' на ' + n + '%',
    );
}
