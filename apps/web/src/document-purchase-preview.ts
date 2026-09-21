import { formatCents, parsePrintedAmount, type DocumentData } from '@eliza/contracts';

export type Preview = {
  supplierName: string;
  supplierPhone: string;
  supplierCode: string;
  companyNumber: string;
  contactName: string;
  reference: string;
  date: string;
  rows: { description: string; sku: string; barcode: string; quantity: string; unitCost: string; derivedCost: boolean }[];
  tooManyRows: boolean;
};
function readField(data: DocumentData, pattern: RegExp) {
  return data.fields.find((field) => pattern.test(field.label))?.value.trim() ?? '';
}
function dateForInput(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return iso[0];
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(value);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const months: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12', января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05', июня: '06', июля: '07', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12' };
  const named = /^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/u.exec(value.toLowerCase());
  return named && months[named[2]] ? `${named[3]}-${months[named[2]]}-${named[1].padStart(2, '0')}` : '';
}
function purchaseQuantity(raw: string) {
  const leading = /^\s*([\d\s\u00a0\u202f.,]+)/.exec(raw)?.[1] ?? '';
  const normalized = leading.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return /^\d+(\.\d{1,3})?$/.test(normalized) ? normalized : '';
}
function purchaseCost(raw: string) {
  const cents = parsePrintedAmount(raw);
  return cents === null || cents < 0n ? '' : formatCents(cents);
}
export function documentPurchasePreview(data: DocumentData): Preview {
  const supplier = data.parties.find((party) => /supplier|vendor|seller|поставщик|продавец/i.test(party.role));
  const supplierName = supplier?.name ?? readField(data, /supplier|vendor|seller|поставщик|продавец/i);
  const phone = (supplier?.details ?? '').match(/\+?\d[\d ()-]{8,}\d/)?.[0] ?? '';
  const tables = data.tables.filter((candidate) => candidate.rows.length && candidate.columns.some((column) => column.kind === 'text') && candidate.columns.some((column) => ['quantity', 'price', 'amount'].includes(column.kind)));
  const allRows = tables.flatMap((table) => table.rows.map((row) => ({ table, row })));
  const rows = allRows.slice(0, 100).map(({ table, row }) => {
    const columns = table.columns;
    const at = (kind: string) => { const index = columns.findIndex((column) => column.kind === kind); return index < 0 ? '' : row.cells[index]?.trim() ?? ''; };
    const textColumns = columns.map((column, index) => ({ column, value: row.cells[index]?.trim() ?? '' })).filter(({ column }) => column.kind === 'text');
    const description = textColumns.find(({ column }) => /product|item|name|товар|наименование|описание/i.test(column.label))?.value ?? textColumns.at(-1)?.value ?? '';
    const sku = textColumns.find(({ column }) => /sku|article|артикул|код/i.test(column.label))?.value ?? '';
    const barcode = textColumns.find(({ column }) => /barcode|штрих/i.test(column.label))?.value ?? '';
    let unitCost = purchaseCost(at('price'));
    let derivedCost = false;
    const quantity = purchaseQuantity(at('quantity'));
    if (!unitCost && quantity && at('amount')) {
      const cents = parsePrintedAmount(at('amount'));
      const number = Number(quantity.replace(/\s/g, '').replace(',', '.'));
      if (cents !== null && Number.isFinite(number) && number > 0) { unitCost = (Number(cents) / 100 / number).toFixed(2); derivedCost = true; }
    }
    return { description, sku, barcode, quantity, unitCost, derivedCost };
  }).filter((row) => row.description);
  return {
    supplierName,
    supplierPhone: phone || readField(data, /supplier phone|телефон поставщика/i),
    supplierCode: readField(data, /supplier code|код поставщика/i),
    companyNumber: readField(data, /company number|инн|vat number/i),
    contactName: readField(data, /contact person|representative|торговый представитель|контактное лицо/i),
    reference: data.number || readField(data, /reference|invoice number|номер документа|номер накладной/i),
    date: dateForInput(data.date),
    rows,
    tooManyRows: allRows.length > 100,
  };
}

