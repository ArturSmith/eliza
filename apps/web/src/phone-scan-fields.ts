import { flushSync } from 'react-dom';

export type ScanField = HTMLInputElement | HTMLTextAreaElement;
export type ScanResult = boolean | 'rejected';
export type PhoneScanDetail = {
  code: string;
  handled: boolean;
  result?: ScanResult | Promise<ScanResult>;
};
export const phoneScanEvent = 'eliza:phone-scan';

export function isScanField(value: unknown): value is ScanField {
  return (
    value instanceof HTMLTextAreaElement ||
    (value instanceof HTMLInputElement &&
      ['text', 'search', 'email', 'tel', 'url', 'number'].includes(value.type))
  );
}
export function scanFieldVisible(field: ScanField) {
  return (
    field.isConnected &&
    !field.readOnly &&
    !field.closest('[hidden], [inert]') &&
    !field.closest('details:not([open])') &&
    field.getClientRects().length > 0 &&
    getComputedStyle(field).visibility === 'visible'
  );
}
export function scanFieldReady(field: ScanField) {
  return scanFieldVisible(field) && !field.matches(':disabled');
}
export function scanFieldLabel(field: ScanField) {
  const labelledBy = field
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  const label = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  // Never include a textarea's current contents or neighbouring controls in the phone label.
  label
    ?.querySelectorAll('input, textarea, select, button, small, svg, [role="listbox"]')
    .forEach((node) => node.remove());
  return (
    field.getAttribute('aria-label') ||
    labelledBy ||
    label?.textContent ||
    field.placeholder ||
    field.name ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
export async function fillScanField(field: ScanField, code: string): Promise<ScanResult> {
  if (!scanFieldReady(field)) return false;
  const old = field.value;
  let value = code.replace(/\r\n?/g, '\n');
  if (field instanceof HTMLInputElement && /[\r\n]/.test(value)) return 'rejected';
  if (field.name === 'barcodes') {
    if (value.length > 100 || /[\r\n]/.test(value)) return 'rejected';
    value = [
      ...new Set([
        ...old
          .split(/[\n,]+/)
          .map((v) => v.trim())
          .filter(Boolean),
        value,
      ]),
    ].join('\n');
  }
  if (field.maxLength >= 0 && value.length > field.maxLength) return 'rejected';
  const detail: PhoneScanDetail = { code: value, handled: false };
  field.dispatchEvent(new CustomEvent<PhoneScanDetail>(phoneScanEvent, { detail }));
  if (detail.handled) return (await detail.result) ?? false;
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  const write = (text: string) => {
    setter.call(field, text);
    flushSync(() => field.dispatchEvent(new Event('input', { bubbles: true })));
  };
  write(value);
  // Reject values the browser or a controlled field cannot accept, without losing the old value.
  if (field.value !== value) {
    write(old);
    return 'rejected';
  }
  return true;
}
