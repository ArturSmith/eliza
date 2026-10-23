import JsBarcode from 'jsbarcode';
import { t } from '../i18n';
import { encodeLabel } from './p1';
import { layoutElements, layoutSize, type LabelLayout } from './tag-layout';
export type LabelContent = {
  name: string;
  price: string;
  barcode?: string;
  store?: string;
  details?: string[];
};
function renderDefaultLabel(label: LabelContent): HTMLCanvasElement {
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
// The editor, browser sheet and BLE raster share this renderer.
export function renderLayoutView(label: LabelContent, layout: LabelLayout): HTMLCanvasElement {
  const size = layoutSize(layout.orientation);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Label preview is unavailable.'));
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size.width, size.height);
  for (const id of layoutElements) {
    const box = layout.elements[id];
    if (!box.visible) continue;
    if (id === 'barcode') {
      if (!label.barcode) continue;
      const barcode = document.createElement('canvas');
      const digits = [...label.barcode].map(Number);
      const ean =
        /^\d{13}$/.test(label.barcode) &&
        digits.reduce((sum, digit, i) => sum + digit * (i % 2 ? 3 : 1), 0) % 10 === 0;
      try {
        JsBarcode(barcode, label.barcode, {
          format: ean ? 'EAN13' : 'CODE128',
          width: 2,
          height: Math.max(24, Math.min(72, box.height - 46)),
          margin: 12,
          fontSize: 18,
          displayValue: true,
        });
      } catch {
        throw new Error(t('Barcode image unavailable for this code.'));
      }
      if (barcode.width > box.width || barcode.height > box.height)
        throw new Error(
          t('Increase the barcode area: the barcode must fit without shrinking its bars.'),
        );
      ctx.drawImage(
        barcode,
        box.x + Math.floor((box.width - barcode.width) / 2),
        box.y + Math.floor((box.height - barcode.height) / 2),
      );
      continue;
    }
    const text =
      id === 'name'
        ? label.name
        : id === 'price'
          ? label.price
          : id === 'store'
            ? (label.store ?? '')
            : (label.details ?? []).join('\n');
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.fillStyle = 'black';
    ctx.font = `${id === 'price' || id === 'name' ? 'bold ' : ''}${box.fontSize}px Arial, sans-serif`;
    ctx.textAlign = box.align;
    ctx.textBaseline = 'top';
    const x =
      box.align === 'left'
        ? box.x
        : box.align === 'right'
          ? box.x + box.width
          : box.x + box.width / 2;
    if (id === 'price') {
      // Keep the entire monetary amount on one line; never truncate a price.
      ctx.font = `bold ${Math.min(box.fontSize, Math.floor(box.height / 1.2))}px Arial, sans-serif`;
      ctx.fillText(text, x, box.y, box.width);
      ctx.restore();
      continue;
    }
    const rows: string[] = [];
    for (const paragraph of text.split('\n')) {
      let row = '';
      for (const char of paragraph) {
        if (row && ctx.measureText(row + char).width > box.width) {
          rows.push(row.trim());
          row = '';
        }
        row += char;
      }
      if (row) rows.push(row.trim());
    }
    const lineHeight = Math.ceil(box.fontSize * 1.2),
      count = Math.max(1, Math.floor(box.height / lineHeight));
    rows.slice(0, count).forEach((row, i) => {
      if (i === count - 1 && rows.length > count) {
        while (row.length && ctx.measureText(row + '…').width > box.width) row = row.slice(0, -1);
        row += '…';
      }
      ctx.fillText(row, x, box.y + i * lineHeight, box.width);
    });
    ctx.restore();
  }
  return canvas;
}
export function renderLabel(label: LabelContent, layout?: LabelLayout | null): HTMLCanvasElement {
  if (!layout) return renderDefaultLabel(label);
  const view = renderLayoutView(label, layout);
  if (layout.orientation === 'portrait') return view;
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  // Rotate by exactly 90 degrees, never rescale barcode dots.
  ctx.translate(0, 480);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(view, 0, 0);
  return canvas;
}
export function labelBytes(canvas: HTMLCanvasElement, gap: number, compact = true) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, 400, 480);
  return encodeLabel(pixels.data, 400, 480, gap, compact);
}
