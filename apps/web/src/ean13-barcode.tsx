import { t, useLanguage } from './i18n';

// EAN-13 number sets A, B and C, with the leading digit's left-side parity.
const setA = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const setB = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const setC = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const parity = [
  'AAAAAA',
  'AABABB',
  'AABBAB',
  'AABBBA',
  'ABAABB',
  'ABBAAB',
  'ABBBAA',
  'ABABAB',
  'ABABBA',
  'ABBABA',
];

export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 requires 13 digits.');
  const left = [...code.slice(1, 7)]
    .map((digit, index) => (parity[Number(code[0])][index] === 'A' ? setA : setB)[Number(digit)])
    .join('');
  const right = [...code.slice(7)].map((digit) => setC[Number(digit)]).join('');
  return '101' + left + '01010' + right + '101';
}

export function Ean13Barcode({ code }: { code: string }) {
  useLanguage();
  const modules = ean13Modules(code);
  return (
    <svg
      className="weight-barcode-image"
      viewBox="0 0 117 72"
      role="img"
      aria-label={t('Barcode {value0}', { value0: code })}
      shapeRendering="crispEdges"
    >
      <rect width="117" height="72" fill="white" />
      {[...modules].map((bit, index) =>
        bit === '1' ? (
          <rect
            key={index}
            x={11 + index}
            y="0"
            width="1"
            height={index < 3 || (index >= 45 && index < 50) || index >= 92 ? 60 : 54}
            fill="black"
          />
        ) : null,
      )}
      <text x="58.5" y="69" textAnchor="middle" fontSize="8" fontFamily="monospace">
        {code}
      </text>
    </svg>
  );
}
