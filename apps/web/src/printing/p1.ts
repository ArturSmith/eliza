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
    acceptAllDevices: true;
    optionalServices: string[];
  }): Promise<PrinterDevice>;
};
export function printerBluetooth(): PrinterBluetooth | undefined {
  return (navigator as Navigator & { bluetooth?: PrinterBluetooth }).bluetooth;
}
export type PrintSpeed = 'fast' | 'compatible';
export function encodeLabel(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gap: number,
  compact = true,
) {
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
  const parts: Uint8Array[] = [
    encoder.encode(
      `SIZE 50 mm,60 mm\r\nGAP ${gap} mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\n`,
    ),
  ];
  if (!compact) {
    // Known slow profile remains byte-for-byte compatible with the first hardware test.
    parts.push(encoder.encode('BITMAP 0,0,50,480,0,'), bitmap);
  } else {
    const stride = width / 8;
    const occupied = Array.from({ length: height }, (_, y) => {
      let left = stride,
        right = -1;
      for (let x = 0; x < stride; x++)
        if (bitmap[y * stride + x] !== 255) {
          left = Math.min(left, x);
          right = x;
        }
      return { left, right };
    });
    for (let y = 0; y < height;) {
      if (occupied[y].right < 0) {
        y++;
        continue;
      }
      const top = y;
      let bottom = y,
        left = stride,
        right = -1;
      // Skip blank vertical gaps; preserve coordinates and integer barcode dot widths.
      for (; y < height && y - bottom < 8; y++)
        if (occupied[y].right >= 0) {
          bottom = y;
          left = Math.min(left, occupied[y].left);
          right = Math.max(right, occupied[y].right);
        }
      const rowBytes = right - left + 1,
        rows = bottom - top + 1;
      const cropped = new Uint8Array(rowBytes * rows);
      for (let row = 0; row < rows; row++)
        cropped.set(
          bitmap.subarray((top + row) * stride + left, (top + row) * stride + right + 1),
          row * rowBytes,
        );
      if (parts.length > 1) parts.push(encoder.encode('\r\n'));
      parts.push(encoder.encode(`BITMAP ${left * 8},${top},${rowBytes},${rows},0,`), cropped);
    }
  }
  parts.push(encoder.encode('\r\nPRINT 1,1\r\n'));
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function sendLabel(
  characteristic: PrinterCharacteristic,
  data: Uint8Array,
  wait = pause,
  speed: PrintSpeed = 'fast',
) {
  // Conservative BLE payload; do not retry a partially transmitted job automatically.
  for (let offset = 0; offset < data.length; offset += 20) {
    const chunk = new Uint8Array(data.slice(offset, offset + 20));
    if (characteristic.properties.writeWithoutResponse)
      await characteristic.writeValueWithoutResponse(chunk);
    else if (characteristic.properties.write) await characteristic.writeValueWithResponse(chunk);
    else throw new Error('Printer does not expose a writable channel.');
    // Await every write. Keep 20-byte packets rather than guessing the negotiated MTU.
    if (speed === 'compatible' || characteristic.properties.writeWithoutResponse)
      await wait(speed === 'compatible' ? 30 : 4);
  }
}
