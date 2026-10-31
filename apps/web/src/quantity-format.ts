import { getLocale } from './i18n';

/** Display API quantities without fixed-scale zeros; leave the stored decimal untouched. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null || String(value).trim() === '') return '—';
  const raw = String(value).trim().replace(/^−/, '-');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    const number = Number(raw);
    return Number.isFinite(number)
      ? new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 20 }).format(number)
      : '—';
  }
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const whole = BigInt(match[2]);
  const negative = match[1] === '-' && (whole !== 0n || fraction !== '');
  const integer = negative ? (whole === 0n ? -0 : -whole) : whole;
  const formatted = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(
    integer,
  );
  const sign = match[1] === '+' ? '+' : '';
  if (!fraction) return sign + formatted;
  const separator = new Intl.NumberFormat(getLocale())
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')!.value;
  return sign + formatted + separator + fraction;
}

/** Editable fields keep a dot decimal separator and never add grouping characters. */
export function quantityInputValue(value: string): string {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
