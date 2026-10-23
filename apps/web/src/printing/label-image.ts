import JsBarcode from 'jsbarcode';
import { t } from '../i18n';
import { encodeLabel } from './p1';
export type LabelContent = {
  name: string;
  price: string;
  barcode?: string;
  store?: string;
  details?: string[];
};
export function renderLabel(label: LabelContent): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Label preview is unavailable.'));
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 480);
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  const line = (text: string, y: number, size: number, bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
    ctx.fillText(text, 200, y, 360);
  };
  if (label.store) line(label.store, 30, 18);
  ctx.font = 'bold 25px Arial, sans-serif';
  // Character wrapping also handles long names without spaces; never overwrite barcode area.
  const rows: string[] = [];
  let row = '';
  for (const char of label.name) {
    if (ctx.measureText(row + char).width > 350 && row) {
      rows.push(row.trim());
      row = '';
    }
    row += char;
  }
  if (row) rows.push(row.trim());
  rows
    .slice(0, 3)
    .forEach((text, i) =>
      line(text + (i === 2 && rows.length > 3 ? '…' : ''), 66 + i * 30, 25, true),
    );
  line(label.price, 195, 45, true);
  (label.details ?? []).slice(0, 4).forEach((text, i) => line(text, 230 + i * 23, 18));
  if (label.barcode) {
    const barcode = document.createElement('canvas');
    const digits = [...label.barcode].map(Number);
    const ean =
      /^\d{13}$/.test(label.barcode) &&
      digits.reduce((sum, digit, i) => sum + digit * (i % 2 ? 3 : 1), 0) % 10 === 0;
    try {
      JsBarcode(barcode, label.barcode, {
        format: ean ? 'EAN13' : 'CODE128',
        width: 2,
        height: 72,
        margin: 12,
        fontSize: 18,
        displayValue: true,
      });
    } catch {
      throw new Error(t('Barcode image unavailable for this code.'));
    }
    // Never squeeze barcode bars to fractional pixels or drop required quiet zones.
    if (barcode.width > 368) throw new Error(t('This barcode is too wide for a 50 mm label.'));
    ctx.drawImage(barcode, Math.floor((400 - barcode.width) / 2), 345);
  }
  return canvas;
}
export function labelBytes(canvas: HTMLCanvasElement, gap: number, compact = true) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, 400, 480);
  return encodeLabel(pixels.data, 400, 480, gap, compact);
}
