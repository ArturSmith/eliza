import { describe, expect, it } from 'vitest';
import {
  documentDataSchema,
  validateDocument,
  type DocumentData,
} from '../packages/contracts/src/index';
function invoice(): DocumentData {
  return {
    documentType: 'invoice',
    language: 'ru',
    title: 'Реализация товаров № U2-12670',
    number: 'U2-12670',
    date: '8 сентября 2026 г.',
    currency: '₽',
    summary: '',
    pages: 1,
    parties: [
      { role: 'Поставщик', name: 'ИП Магомадов Р.А.', details: '+7 (969) 722-22-22' },
      { role: 'Покупатель', name: 'Чир-корт', details: '' },
    ],
    fields: [],
    sections: [],
    additionalText: [],
    annotations: [],
    printedTotal: '8 638,00',
    extractionWarnings: [],
    tables: [
      {
        id: 'items',
        title: 'Товары',
        columns: [
          { key: 'product', label: 'Товар', kind: 'text' },
          { key: 'quantity', label: 'Кол-во', kind: 'quantity' },
          { key: 'amount', label: 'Сумма', kind: 'amount' },
        ],
        rows: [
          ['Чай Манго', '24', '1 416'],
          ['Чай Малина', '24', '1 416'],
          ['Чай Лимон', '24', '1 416'],
          ['Чай Персик', '24', '1 416'],
          ['Энерджи Белая Вишня', '12', '1 056'],
          ['Энерджи Виноград', '12', '1 056'],
          ['САШ Лимон', '1', '288'],
          ['Конфеты Red 500 г', '1', '564'],
          ['Конфеты Red 800 г', '1', '564'],
        ].map((cells, index) => ({ rowNumber: String(index + 1), cells })),
        footerRows: [],
      },
    ],
  };
}
describe('scanned document reconstruction', () => {
  it('preserves all nine original rows and flags the printed-total difference', () => {
    const source = documentDataSchema.parse(invoice());
    expect(source.tables[0].rows).toHaveLength(9);
    expect(validateDocument(source)).toMatchObject({
      rowSum: '9192.00',
      printedTotal: '8638.00',
      difference: '554.00',
    });
    expect(validateDocument(source).warnings[0]).toContain('554.00');
  });
  it('supports an English receipt and multiple tables without changing row order', () => {
    const receipt = invoice();
    receipt.documentType = 'receipt';
    receipt.language = 'en';
    receipt.title = 'Shop receipt';
    receipt.currency = '$';
    receipt.printedTotal = '10.00';
    receipt.tables = [
      {
        id: 'goods',
        title: 'Goods',
        columns: [
          { key: 'item', label: 'Item', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'amount' },
        ],
        rows: [{ rowNumber: '1', cells: ['Apple', '6.00'] }],
        footerRows: [],
      },
      {
        id: 'fees',
        title: 'Fees',
        columns: [
          { key: 'description', label: 'Description', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'amount' },
        ],
        rows: [{ rowNumber: 'A', cells: ['Bag', '4.00'] }],
        footerRows: [],
      },
    ];
    expect(
      documentDataSchema.parse(receipt).tables.map((table) => table.rows[0].rowNumber),
    ).toEqual(['1', 'A']);
    expect(validateDocument(receipt).difference).toBe('0.00');
  });
  it('does not invent a table or total for a letter', () => {
    const letter = {
      ...invoice(),
      documentType: 'letter',
      tables: [],
      printedTotal: '',
      sections: [{ title: 'Notice', text: 'Delivery delayed.' }],
    };
    expect(validateDocument(letter)).toMatchObject({
      rowSum: null,
      printedTotal: null,
      difference: null,
    });
  });
  it('keeps duplicate rows and unreadable amounts visible', () => {
    const data = invoice();
    data.tables[0].rows.push({ rowNumber: '10', cells: ['Чай Манго', '24', '?'] });
    expect(data.tables[0].rows).toHaveLength(10);
    expect(validateDocument(data).warnings.some((warning) => warning.includes('row 10'))).toBe(
      true,
    );
  });
  it('checks quantity times price only when all relevant columns exist', () => {
    const data = invoice();
    data.tables[0].columns.splice(2, 0, { key: 'price', label: 'Цена', kind: 'price' });
    data.tables[0].rows.forEach((row) =>
      row.cells.splice(2, 0, row.rowNumber === '1' ? '58' : '59'),
    );
    expect(validateDocument(data).warnings.some((warning) => warning.includes('row 1'))).toBe(true);
    expect(validateDocument(data).rowSum).toBe('9192.00');
  });
  it('detects six missing rows from a 31-row numbered invoice without inventing them', () => {
    const data = invoice();
    const table = data.tables[0];
    table.firstRowNumber = 1;
    table.lastRowNumber = 31;
    table.expectedRowCount = 31;
    table.rows = Array.from({ length: 25 }, (_, index) => ({ rowNumber: String(index + 1), cells: [`Товар ${index + 1}`, '1', '100'] }));
    data.printedTotal = '30219.00';
    const result = validateDocument(data);
    expect(result).toMatchObject({ incomplete: true, expectedRows: 31, extractedRows: 25, missingRowNumbers: [26, 27, 28, 29, 30, 31], arithmeticStatus: 'incomplete' });
    expect(result.warnings.join(' ')).toContain('Partial extracted row sum');
    expect(table.rows).toHaveLength(25);
  });
  it('flags duplicate row numbers and nullable unreadable values without default quantities', () => {
    const data = invoice();
    data.tables[0].expectedRowCount = 9;
    data.tables[0].firstRowNumber = 1;
    data.tables[0].lastRowNumber = 9;
    data.tables[0].rows[1].rowNumber = '1';
    data.tables[0].rows[0].cells[1] = null;
    data.tables[0].rows[0].uncertainCells = [1];
    const result = validateDocument(data);
    expect(result.incomplete).toBe(true);
    expect(result.duplicateRowNumbers).toEqual([1]);
    expect(result.missingRowNumbers).toEqual([2]);
    expect(data.tables[0].rows[0].cells[1]).toBe(null);
  });
  it('validates edited values without changing the extraction', () => {
    const source = invoice();
    const edited = structuredClone(source);
    edited.printedTotal = '9 192,00';
    expect(validateDocument(edited).difference).toBe('0.00');
    expect(source.printedTotal).toBe('8 638,00');
  });
});
