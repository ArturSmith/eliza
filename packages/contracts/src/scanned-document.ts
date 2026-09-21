import { z } from 'zod';

const text = z.string().max(5000);
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
            .array(z.object({ rowNumber: z.string().max(30), cells: z.array(text).max(30) }))
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
  let count = 0;
  for (const table of data.tables) {
    const amountIndex = table.columns.findIndex((column) => column.kind === 'amount');
    if (amountIndex < 0) continue;
    const quantityIndex = table.columns.findIndex((column) => column.kind === 'quantity');
    const priceIndex = table.columns.findIndex((column) => column.kind === 'price');
    for (const row of table.rows) {
      const value = parsePrintedAmount(row.cells[amountIndex] ?? '');
      if (value === null)
        warnings.push(
          `Unreadable amount in ${table.title || 'table'} row ${row.rowNumber || count + 1}.`,
        );
      else {
        sum += value;
        count++;
        if (quantityIndex >= 0 && priceIndex >= 0) {
          const quantity = parsePrintedQuantity(row.cells[quantityIndex] ?? '');
          const price = parsePrintedAmount(row.cells[priceIndex] ?? '');
          if (quantity !== null && price !== null && (quantity * price + 500n) / 1000n !== value)
            warnings.push(
              `Quantity × price differs from printed amount in ${table.title || 'table'} row ${row.rowNumber || count}.`,
            );
        }
      }
    }
  }
  const printed = parsePrintedAmount(data.printedTotal);
  if (data.printedTotal && printed === null)
    warnings.push('The printed total could not be read as a number.');
  const difference = count && printed !== null ? sum - printed : null;
  if (difference !== null && difference !== 0n)
    warnings.push(
      `Printed total and table amounts differ by ${formatCents(difference < 0n ? -difference : difference)} ${data.currency}`.trim(),
    );
  return {
    rowSum: count ? formatCents(sum) : null,
    printedTotal: printed === null ? null : formatCents(printed),
    difference: difference === null ? null : formatCents(difference),
    warnings,
  };
}
