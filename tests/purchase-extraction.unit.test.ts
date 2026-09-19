import { describe, expect, it } from 'vitest';
import {
  cleanNumber,
  cleanText,
  countUnmatched,
  documentImageSchema,
  matchLines,
  mergeDuplicates,
  type ExtractedLine,
  type ReadLine,
} from '../packages/contracts/src/index';

const read = (over: Partial<ReadLine> = {}): ReadLine => ({
  description: 'Nutella 400g',
  supplierSku: '',
  barcode: '',
  quantity: '2',
  unitCost: '2.50',
  ...over,
});

const line = (over: Partial<ExtractedLine> = {}): ExtractedLine => ({
  ...read(),
  productId: null,
  matchedBy: null,
  ambiguous: false,
  ...over,
});

describe('cleanNumber', () => {
  it('accepts figures the purchase schemas can represent', () => {
    expect(cleanNumber('2.50', 2)).toBe('2.50');
    expect(cleanNumber(12, 3)).toBe('12');
    expect(cleanNumber('1,75', 2)).toBe('1.75');
  });
  it('refuses a figure it would have to round, so a person is asked instead', () => {
    expect(cleanNumber('2.555', 2)).toBe('');
    expect(cleanNumber('1.2345', 3)).toBe('');
  });
  it('treats unreadable or non-positive values as missing', () => {
    expect(cleanNumber('approx 3', 2)).toBe('');
    expect(cleanNumber('0', 2)).toBe('');
    expect(cleanNumber('-4', 3)).toBe('');
    expect(cleanNumber(undefined, 2)).toBe('');
    expect(cleanNumber(Number.NaN, 2)).toBe('');
  });
});

describe('cleanText', () => {
  it('strips control characters and trims to the limit', () => {
    expect(cleanText('  Nutella\u0000 400g  ')).toBe('Nutella  400g');
    expect(cleanText('x'.repeat(300), 10)).toHaveLength(10);
    expect(cleanText(42)).toBe('');
  });
});

describe('documentImageSchema', () => {
  it('accepts the image types a browser can produce', () => {
    expect(documentImageSchema.safeParse('data:image/jpeg;base64,' + 'A'.repeat(40)).success).toBe(
      true,
    );
  });
  it('rejects anything that is not an inline image', () => {
    expect(documentImageSchema.safeParse('https://example.com/invoice.jpg').success).toBe(false);
    expect(documentImageSchema.safeParse('data:text/html;base64,' + 'A'.repeat(40)).success).toBe(
      false,
    );
  });
});

describe('matchLines', () => {
  it("prefers the supplier's own code over our SKU", () => {
    const [result] = matchLines(
      [read({ supplierSku: 'ABC-1' })],
      new Map([
        ['supplier-sku:abc-1', ['p1']],
        ['sku:abc-1', ['p2']],
      ]),
    );
    expect(result.productId).toBe('p1');
    expect(result.matchedBy).toBe('supplier-sku');
  });
  it('matches on barcode when there is no supplier code', () => {
    const [result] = matchLines(
      [read({ barcode: '5000159484695' })],
      new Map([['barcode:5000159484695', ['p9']]]),
    );
    expect(result.productId).toBe('p9');
    expect(result.matchedBy).toBe('barcode');
  });
  it('falls back to our own SKU last', () => {
    const [result] = matchLines([read({ supplierSku: 'INT-7' })], new Map([['sku:int-7', ['p3']]]));
    expect(result.matchedBy).toBe('sku');
  });
  it('refuses to choose when one code maps to several products', () => {
    const [result] = matchLines(
      [read({ supplierSku: 'DUP' })],
      new Map([['supplier-sku:dup', ['p1', 'p2']]]),
    );
    expect(result.productId).toBeNull();
    expect(result.ambiguous).toBe(true);
  });
  it('leaves an unknown item unmatched rather than guessing', () => {
    const [result] = matchLines([read({ supplierSku: 'ZZZ' })], new Map());
    expect(result.productId).toBeNull();
    expect(result.ambiguous).toBe(false);
  });
  it('ignores empty keys so blank codes never collide', () => {
    const [result] = matchLines([read()], new Map([['supplier-sku:', ['p1']]]));
    expect(result.productId).toBeNull();
  });
});

describe('mergeDuplicates', () => {
  it('adds quantities so the draft schema does not reject the document', () => {
    const { lines, mergedCount } = mergeDuplicates([
      line({ productId: 'p1', quantity: '2' }),
      line({ productId: 'p1', quantity: '3' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe('5');
    expect(mergedCount).toBe(1);
  });
  it('preserves both rows when unit costs differ', () => {
    const { lines } = mergeDuplicates([
      line({ productId: 'p1', quantity: '1', unitCost: '2.50' }),
      line({ productId: 'p1', quantity: '1', unitCost: '9.99' }),
    ]);
    expect(lines.map((l) => l.unitCost)).toEqual(['2.50', '9.99']);
    expect(lines).toHaveLength(2);
  });
  it('keeps unmatched lines separate, since they are not known to be the same item', () => {
    const { lines, mergedCount } = mergeDuplicates([line(), line()]);
    expect(lines).toHaveLength(2);
    expect(mergedCount).toBe(0);
  });
  it('does not merge when a quantity is missing, so nothing is invented', () => {
    const { lines, mergedCount } = mergeDuplicates([
      line({ productId: 'p1', quantity: '' }),
      line({ productId: 'p1', quantity: '3' }),
    ]);
    expect(lines).toHaveLength(2);
    expect(mergedCount).toBe(0);
  });
});

describe('countUnmatched', () => {
  it('counts the lines a person still has to resolve', () => {
    expect(countUnmatched([line({ productId: 'p1' }), line(), line()])).toBe(2);
  });
});

it('adds fractional quantities exactly without mutating source rows', () => {
  const rows = [
    line({ productId: 'p1', quantity: '0.1' }),
    line({ productId: 'p1', quantity: '0.2' }),
  ];
  expect(mergeDuplicates(rows).lines[0].quantity).toBe('0.3');
  expect(rows[0].quantity).toBe('0.1');
});
it('keeps overflowing quantities separate', () => {
  expect(
    mergeDuplicates([
      line({ productId: 'p1', quantity: '999999999' }),
      line({ productId: 'p1', quantity: '1' }),
    ]).lines,
  ).toHaveLength(2);
});
it('requires review when supplier code and barcode disagree', () => {
  const result = matchLines(
    [read({ supplierSku: 'A', barcode: '123' })],
    new Map([
      ['supplier-sku:a', ['p1']],
      ['barcode:123', ['p2']],
    ]),
  )[0];
  expect(result.productId).toBeNull();
  expect(result.ambiguous).toBe(true);
});
