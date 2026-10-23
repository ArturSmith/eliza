// P1 TSPL over BLE. 203 dpi ≈ 8 dots/mm, 50 × 60 mm gap labels.
export const p1Service = '000018f0-0000-1000-8000-00805f9b34fb';
export const p1Characteristic = '00002af1-0000-1000-8000-00805f9b34fb';
export type PrinterCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
};
export type PrinterDevice = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(
        id: string,
      ): Promise<{ getCharacteristic(id: string): Promise<PrinterCharacteristic> }>;
    }>;
    disconnect(): void;
  };
  addEventListener(type: 'gattserverdisconnected', callback: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', callback: () => void): void;
};
export type PrinterBluetooth = {
  requestDevice(options: {
    filters: ({ services: string[] } | { namePrefix: string })[];
    optionalServices: string[];
  }): Promise<PrinterDevice>;
};
export function printerBluetooth(): PrinterBluetooth | undefined {
  return (navigator as Navigator & { bluetooth?: PrinterBluetooth }).bluetooth;
}
export function encodeLabel(rgba: Uint8ClampedArray, width: number, height: number, gap: number) {
  if (
    width !== 400 ||
    height !== 480 ||
    rgba.length !== width * height * 4 ||
    !Number.isFinite(gap) ||
    gap < 0.5 ||
    gap > 6
  )
    throw new Error('Invalid P1 label dimensions or gap.');
  const bitmap = new Uint8Array((width / 8) * height).fill(255);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    // Composite transparent pixels over white. TSPL: 0 = dark, 1 = white.
    const gray =
      ((rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114) *
        rgba[offset + 3]) /
        255 +
      255 -
      rgba[offset + 3];
    if (gray < 160) bitmap[i >> 3] &= ~(128 >> (i % 8));
  }
  const encoder = new TextEncoder();
  const header = encoder.encode(
    `SIZE 50 mm,60 mm\r\nGAP ${gap} mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,50,480,0,`,
  );
  const footer = encoder.encode('\r\nPRINT 1,1\r\n');
  const result = new Uint8Array(header.length + bitmap.length + footer.length);
  result.set(header);
  result.set(bitmap, header.length);
  result.set(footer, header.length + bitmap.length);
  return result;
}
export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function sendLabel(
  characteristic: PrinterCharacteristic,
  data: Uint8Array,
  wait = pause,
) {
  // Conservative BLE payload; do not retry a partially transmitted job automatically.
  for (let offset = 0; offset < data.length; offset += 20) {
    const chunk = new Uint8Array(data.slice(offset, offset + 20));
    if (characteristic.properties.writeWithoutResponse)
      await characteristic.writeValueWithoutResponse(chunk);
    else if (characteristic.properties.write) await characteristic.writeValueWithResponse(chunk);
    else throw new Error('Printer does not expose a writable channel.');
    await wait(30);
  }
}
