import { z } from 'zod';

/**
 * Reading a purchase document is a suggestion, never a decision.
 *
 * Everything here describes what a model *claims* to have seen on a supplier
 * document. Nothing in this module writes to the catalogue or to a purchase.
 * The API returns these shapes, a person reviews them on screen next to the
 * original image, and the existing `POST /purchases` endpoint performs the
 * write under the usual permission checks.
 */

/** Largest data URL we accept, measured before base64 decoding. */
export const maxDocumentCharacters = 6_000_000;
/** Matches the `lines` cap in `purchaseDraftSchema`. */
export const maxExtractedLines = 100;

export const documentImageSchema = z
  .string()
  .min(32)
  .max(maxDocumentCharacters)
  .regex(
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    'Upload a JPEG, PNG, or WebP photo of the document.',
  );

export const extractionRequestSchema = z.object({
  supplierId: z.uuid().optional(),
  image: documentImageSchema,
});
export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;

/** How a line was tied to a catalogue product, or `null` when it was not. */
export const matchKinds = ['supplier-sku', 'barcode', 'sku', 'name'] as const;
export type MatchKind = (typeof matchKinds)[number];

/** A line as read from the document, before any matching has been attempted. */
export type ReadLine = {
  /** Verbatim text from the document, shown to the reviewer for comparison. */
  description: string;
  supplierSku: string;
  barcode: string;
  /** Empty string when the model could not read a usable figure. */
  quantity: string;
  unitCost: string;
};

export type ExtractedLine = ReadLine & {
  /** `null` means unmatched. The reviewer picks the product by hand. */
  productId: string | null;
  matchedBy: MatchKind | null;
  /** True when the text matched more than one product, so we refused to guess. */
  ambiguous: boolean;
};

export type Extraction = {
  supplierName: string;
  supplierCode: string;
  supplierCompanyNumber: string;
  supplierPhone: string;
  contactName: string;
  contactPhone: string;
  supplierReference: string;
  documentDate: string;
  lines: ExtractedLine[];
  /** Lines a person must still resolve before the draft can be saved. */
  unmatched: number;
  /** Duplicate products folded together, surfaced so the merge is not a surprise. */
  mergedCount: number;
};

/**
 * Trim a model-supplied string to something safe to store and display.
 * Control characters are dropped rather than escaped: they only ever arrive
 * from a misread, and they break table layout.
 */
export function normalizeMatchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchingTextScore(left: string, right: string) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return 0.86;
  const aa = new Set(a.split(' '));
  const bb = new Set(b.split(' '));
  const common = [...aa].filter((token) => bb.has(token)).length;
  return common / new Set([...aa, ...bb]).size;
}

/** Returns only a strong, uniquely best text match. */
export function confidentTextMatch<T>(text: string, rows: T[], name: (row: T) => string) {
  const ranked = rows
    .map((row) => ({ row, score: matchingTextScore(text, name(row)) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.78 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.1
    ? ranked[0].row
    : undefined;
}

export function cleanText(value: unknown, limit = 120) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Accept a number only if it survives a round trip to the format the purchase
 * schemas already demand. A figure we cannot represent exactly comes back as an
 * empty string so the reviewer is prompted, rather than being silently rounded
 * into a quantity or a price that nobody chose.
 */
export function cleanNumber(value: unknown, decimals: 2 | 3) {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim().replace(',', '.')
        : '';
  if (!text || !/^\d{1,9}(?:\.\d+)?$/.test(text)) return '';
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) return '';
  const cleaned = fraction ? `${whole}.${fraction}` : whole;
  return Number(cleaned) > 0 ? cleaned : '';
}

/**
 * Resolve document text to catalogue products.
 *
 * `index` maps `kind:key` (lowercased) to the products carrying that key. A key
 * held by more than one product is treated as no match at all: a wrong product
 * silently corrupts stock levels and cost history, which is materially worse
 * for the shop than asking a person to choose.
 *
 * Precedence runs from most to least specific evidence: the supplier's own item
 * code, then a barcode, then our SKU.
 */
export function matchLines(lines: ReadLine[], index: Map<string, string[]>): ExtractedLine[] {
  return lines.map((line) => {
    const supplier = line.supplierSku
      ? (index.get('supplier-sku:' + line.supplierSku.toLowerCase()) ?? [])
      : [];
    const barcode = line.barcode ? (index.get('barcode:' + line.barcode.toLowerCase()) ?? []) : [];
    // An internal SKU is only fallback evidence: supplier codes have their own namespace.
    const sku =
      supplier.length || !line.supplierSku
        ? []
        : (index.get('sku:' + line.supplierSku.toLowerCase()) ?? []);
    const candidates = [...new Set([...supplier, ...barcode, ...sku])];
    const productId = candidates.length === 1 ? candidates[0] : null;
    const matchedBy: MatchKind | null = !productId
      ? null
      : supplier.length
        ? 'supplier-sku'
        : barcode.length
          ? 'barcode'
          : 'sku';
    return { ...line, productId, matchedBy, ambiguous: candidates.length > 1 };
  });
}

/** Combine only identical-cost matches, using exact thousandths for quantity.
 * Different costs and incomplete rows stay visible for explicit review. */
export function mergeDuplicates(lines: ExtractedLine[]) {
  const merged: ExtractedLine[] = [];
  let mergedCount = 0;
  const scaled = (value: string, digits: number) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'));
  };
  for (const source of lines) {
    const line = { ...source };
    const quantity = cleanNumber(line.quantity, 3);
    const cost = cleanNumber(line.unitCost, 2);
    const previous =
      line.productId && quantity && cost
        ? merged.find(
            (p) =>
              p.productId === line.productId &&
              cleanNumber(p.quantity, 3) &&
              cleanNumber(p.unitCost, 2) &&
              scaled(p.unitCost, 2) === scaled(cost, 2),
          )
        : undefined;
    if (previous) {
      const sum = scaled(previous.quantity, 3) + scaled(quantity, 3);
      // Keep oversized sums separate so the reviewer sees every source line.
      if (sum <= 999999999999n) {
        previous.quantity =
          (sum / 1000n).toString() +
          (sum % 1000n ? '.' + (sum % 1000n).toString().padStart(3, '0').replace(/0+$/, '') : '');
        mergedCount++;
        continue;
      }
    }
    merged.push(line);
  }
  return { lines: merged, mergedCount };
}

/** Lines a person must still resolve before the draft can be saved. */
export function countUnmatched(lines: ExtractedLine[]) {
  return lines.filter((line) => !line.productId).length;
}

/** Safe diagnostic fields, never provider prose, keys or document content. */
export type DocumentErrorDetails = {
  providerStatus?: number;
  providerCode?: string;
  requestId?: string;
};
