/** Package size is separate from the inventory/selling unit. Stored text remains API-compatible. */
export const sizeUnits = ['ml', 'L', 'cl', 'g', 'kg', 'mg', 'oz', 'lb', 'pcs'] as const;
export type SizeUnit = (typeof sizeUnits)[number];
const aliases: Record<string, SizeUnit> = {
  ml: 'ml',
  мл: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  milliliters: 'ml',
  millilitres: 'ml',
  l: 'L',
  л: 'L',
  liter: 'L',
  litre: 'L',
  liters: 'L',
  litres: 'L',
  литр: 'L',
  литра: 'L',
  литров: 'L',
  cl: 'cl',
  сл: 'cl',
  g: 'g',
  г: 'g',
  gr: 'g',
  gram: 'g',
  grams: 'g',
  гр: 'g',
  kg: 'kg',
  кг: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  mg: 'mg',
  мг: 'mg',
  oz: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pcs: 'pcs',
  pc: 'pcs',
  шт: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
};
export function splitProductSize(value: string): {
  amount: string;
  unit: SizeUnit | '';
  legacy: string;
} {
  const match = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*([a-zа-яё.]+)?\s*$/i.exec(value);
  if (!match) return { amount: '', unit: '' as SizeUnit | '', legacy: value.trim() };
  if (!/[1-9]/.test(match[1])) return { amount: '', unit: '', legacy: value.trim() };
  const unit = match[2] ? aliases[match[2].replace(/\.$/, '').toLowerCase()] : '';
  if (unit === undefined) return { amount: '', unit: '' as SizeUnit | '', legacy: value.trim() };
  return { amount: match[1], unit, legacy: match[2] ? '' : value.trim() };
}
export function joinProductSize(amount: string, unit: SizeUnit | '') {
  const decimal = amount.trim().replace(',', '.');
  const number = decimal.startsWith('.') ? '0' + decimal : decimal;
  return number ? number + (unit ? ' ' + unit : '') : '';
}
