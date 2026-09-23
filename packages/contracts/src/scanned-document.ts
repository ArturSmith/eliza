import { z } from 'zod';

const text = z.string().max(5000);
export const documentProductSchema = z.object({
  name: z.string().max(200).default(''),
  sku: z.string().max(200).default(''),
  barcode: z.string().max(100).default(''),
  plu: z.string().max(20).default(''),
  image: z.string().max(60000).refine((value) => value === '' || /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value), 'Choose a valid product photo').default(''),
  description: z.string().max(2000).default(''),
  category: z.string().max(200).default(''),
  unit: z.string().max(30).default(''),
  price: z.string().max(50).default(''),
  cost: z.string().max(50).default(''),
  taxRate: z.string().max(50).default(''),
  minStock: z.string().max(50).default(''),
}).strict();
export type DocumentProduct = z.infer<typeof documentProductSchema>;
export const documentDataSchema = z
  .object({
    documentType: z.string().max(80),
    language: z.string().max(80),
    title: z.string().max(300),
    number: z.string().max(120),
    date: z.string().max(120),
    currency: z.string().max(20),
    summary: text,
    pages: z.number().int().min(1).max(100),
    parties: z
      .array(z.object({ role: z.string().max(80), name: z.string().max(300), details: text }))
      .max(40),
    fields: z
      .array(
        z.object({
          label: z.string().max(150),
          value: text,
          kind: z.enum(['text', 'date', 'number', 'money']),
          uncertain: z.boolean(),
        }),
      )
      .max(150),
    sections: z.array(z.object({ title: z.string().max(200), text })).max(100),
    tables: z
      .array(
        z.object({
          expectedRowCount: z.number().int().min(0).max(500).nullable().optional(),
          firstRowNumber: z.number().int().min(0).max(9999).nullable().optional(),
          lastRowNumber: z.number().int().min(0).max(9999).nullable().optional(),
          id: z.string().max(80),
          title: z.string().max(200),
          columns: z
            .array(
              z.object({
                key: z.string().max(80),
                label: z.string().max(150),
                kind: z.enum(['text', 'number', 'quantity', 'price', 'amount']),
              }),
            )
            .min(1)
            .max(30),
          rows: z
            .array(z.object({ rowNumber: z.string().max(30), cells: z.array(text.nullable()).max(30), product: documentProductSchema.optional(), uncertainCells: z.array(z.number().int().min(0).max(29)).max(30).optional() }))
            .max(500),
          footerRows: z
            .array(z.object({ label: z.string().max(150), value: z.string().max(120) }))
            .max(30),
        }),
      )
      .max(30),
    additionalText: z.array(text).max(100),
    annotations: z.array(text).max(100),
    printedTotal: z.string().max(120),
    extractionWarnings: z.array(z.string().max(500)).max(100),
  })
  .strict();
export type DocumentData = z.infer<typeof documentDataSchema>;
export type DocumentValidation = {
  rowSum: string | null;
  printedTotal: string | null;
  difference: string | null;
  warnings: string[];
  incomplete: boolean;
  expectedRows: number | null;
  extractedRows: number;
  missingRowNumbers: number[];
  duplicateRowNumbers: number[];
  arithmeticStatus: 'confirmed' | 'incomplete' | 'unavailable';
};

/** Parse printed amounts without converting currency. Decimal separators can be comma or dot. */
export function parsePrintedAmount(raw: string): bigint | null {
  const compact = raw.replace(/[\s\u00a0\u202f₽$€£]/g, '');
  if (!compact || !/^-?[\d.,]+$/.test(compact)) return null;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const decimal = Math.max(lastComma, lastDot);
  const fraction = decimal >= 0 ? compact.slice(decimal + 1) : '';
  if (fraction && (fraction.length > 2 || !/^\d+$/.test(fraction))) return null;
  const integral = (decimal >= 0 ? compact.slice(0, decimal) : compact).replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(integral)) return null;
  const sign = integral.startsWith('-') ? -1n : 1n;
  const whole = BigInt(integral.replace('-', ''));
  return sign * (whole * 100n + BigInt((fraction || '').padEnd(2, '0') || '0'));
}
export function formatCents(amount: bigint): string {
  const sign = amount < 0n ? '-' : '';
  const value = amount < 0n ? -amount : amount;
  return sign + (value / 100n).toString() + '.' + (value % 100n).toString().padStart(2, '0');
}
function parsePrintedQuantity(raw: string): bigint | null {
  const compact = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(compact)) return null;
  const [whole, fraction = ''] = compact.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
}
export function validateDocument(data: DocumentData): DocumentValidation {
  const warnings: string[] = [...data.extractionWarnings];
  let sum = 0n;
  let amountCount = 0;
  let extractedRows = 0;
  let expectedRows = 0;
  let hasExpectedRows = false;
  const missingRowNumbers: number[] = [];
  const duplicateRowNumbers: number[] = [];
  let incomplete = warnings.some((warning) => /conflicting readings|table section could not be read|layout inspection|more than 120 numbered rows/i.test(warning));
  for (const table of data.tables) {
    extractedRows += table.rows.length;
    const expected = table.expectedRowCount ?? null;
    if (expected !== null) {
      expectedRows += expected;
      hasExpectedRows = true;
      if (table.rows.length < expected) {
        incomplete = true;
        warnings.push(`${table.title || 'Table'}: extracted ${table.rows.length} of ${expected} expected rows.`);
      }
    } else if (table.rows.length >= 16) {
      incomplete = true;
      warnings.push(`${table.title || 'Table'}: expected row count could not be verified; review the original.`);
    }
    const numbered = new Map<number, number>();
    for (const row of table.rows) {
      const number = /^\d{1,4}$/.test(row.rowNumber.trim()) ? Number(row.rowNumber.trim()) : null;
      if (number !== null) numbered.set(number, (numbered.get(number) ?? 0) + 1);
      if (row.uncertainCells?.length) warnings.push(`Uncertain cells in ${table.title || 'table'} row ${row.rowNumber || 'unknown'}.`);
    }
    for (const [number, count] of numbered) {
      if (count > 1) {
        duplicateRowNumbers.push(number);
        incomplete = true;
      }
    }
    const first = table.firstRowNumber ?? (numbered.size ? Math.min(...numbered.keys()) : null);
    const last = table.lastRowNumber ?? (expected !== null && first !== null ? first + expected - 1 : numbered.size ? Math.max(...numbered.keys()) : null);
    if (first !== null && last !== null && last >= first && last - first < 501) {
      for (let number = first; number <= last; number++) {
        if (!numbered.has(number)) missingRowNumbers.push(number);
      }
    }
    const amountIndex = table.columns.findIndex((column) => column.kind === 'amount');
    if (amountIndex < 0) continue;
    const quantityIndex = table.columns.findIndex((column) => column.kind === 'quantity');
    const priceIndex = table.columns.findIndex((column) => column.kind === 'price');
    for (const row of table.rows) {
      const value = parsePrintedAmount(row.cells[amountIndex] ?? '');
      if (value === null) {
        warnings.push(`Unreadable amount in ${table.title || 'table'} row ${row.rowNumber || 'unknown'}.`);
        incomplete = true;
      } else {
        sum += value;
        amountCount++;
        if (quantityIndex >= 0 && priceIndex >= 0) {
          const quantity = parsePrintedQuantity(row.cells[quantityIndex] ?? '');
          const price = parsePrintedAmount(row.cells[priceIndex] ?? '');
          if (quantity !== null && price !== null && (quantity * price + 500n) / 1000n !== value)
            warnings.push(`Quantity × price differs from printed amount in ${table.title || 'table'} row ${row.rowNumber || 'unknown'}.`);
        }
      }
    }
  }
  if (missingRowNumbers.length) {
    incomplete = true;
    warnings.push(`Missing printed row numbers: ${missingRowNumbers.join(', ')}.`);
  }
  if (duplicateRowNumbers.length) warnings.push(`Duplicate printed row numbers: ${duplicateRowNumbers.join(', ')}.`);
  const printed = parsePrintedAmount(data.printedTotal);
  if (data.printedTotal && printed === null) warnings.push('The printed total could not be read as a number.');
  const difference = amountCount && printed !== null ? sum - printed : null;
  const arithmeticStatus = difference === null ? 'unavailable' : incomplete ? 'incomplete' : 'confirmed';
  if (difference !== null && difference !== 0n)
    warnings.push(`${incomplete ? 'Partial extracted row sum differs from printed total' : 'Printed total and table amount sum differ'} by ${formatCents(difference < 0n ? -difference : difference)} ${data.currency}`.trim());
  return {
    rowSum: amountCount ? formatCents(sum) : null,
    printedTotal: printed === null ? null : formatCents(printed),
    difference: difference === null ? null : formatCents(difference),
    warnings,
    incomplete,
    expectedRows: hasExpectedRows ? expectedRows : null,
    extractedRows,
    missingRowNumbers,
    duplicateRowNumbers,
    arithmeticStatus,
  };
}
