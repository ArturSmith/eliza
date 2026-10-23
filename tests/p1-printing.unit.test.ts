import { describe, expect, it, vi } from 'vitest';
import { encodeLabel, sendLabel, type PrinterCharacteristic } from '../apps/web/src/printing/p1';

describe('P1 TSPL labels', () => {
  it('packs 50 × 60 mm raster MSB first, white padding and binary bytes without text encoding', () => {
    const rgba = new Uint8ClampedArray(400 * 480 * 4).fill(255);
    rgba.set([0, 0, 0, 255], 0);
    rgba.set([0, 0, 0, 255], 7 * 4);
    rgba.set([0, 0, 0, 255], 8 * 4);
    // Fully transparent black must not be printed.
    rgba.set([0, 0, 0, 0], 9 * 4);
    const job = encodeLabel(rgba, 400, 480, 2, false);
    const header =
      'SIZE 50 mm,60 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,50,480,0,';
    expect(new TextDecoder().decode(job.slice(0, header.length))).toBe(header);
    expect([...job.slice(header.length, header.length + 3)]).toEqual([126, 127, 255]);
    expect(job.length).toBe(header.length + 24000 + '\r\nPRINT 1,1\r\n'.length);
    expect(new TextDecoder().decode(job.slice(-13))).toBe('\r\nPRINT 1,1\r\n');
  });
  it('reconstructs every dot at its original position from compact bitmap bands', () => {
    const rgba = new Uint8ClampedArray(400 * 480 * 4).fill(255);
    const reference = new Uint8Array(24000).fill(255);
    for (let y = 0; y < 480; y++)
      for (let x = 0; x < 400; x++) {
        // Multiple separated text/barcode-like bands, including both paper edges.
        if (
          (y < 4 || (y >= 150 && y < 180) || y >= 460) &&
          (x < 10 || (x > 81 && x < 300 && x % 3) || x > 397)
        ) {
          rgba.set([0, 0, 0, 255], (y * 400 + x) * 4);
          reference[(y * 400 + x) >> 3] &= ~(128 >> (x % 8));
        }
      }
    const job = encodeLabel(rgba, 400, 480, 2);
    const decoded = new Uint8Array(24000).fill(255);
    const text = new TextDecoder();
    let pos = text.decode(job).indexOf('BITMAP');
    let bands = 0;
    while (text.decode(job.slice(pos, pos + 7)) === 'BITMAP ') {
      const match = /^BITMAP (\d+),(\d+),(\d+),(\d+),0,/.exec(
        text.decode(job.slice(pos, pos + 70)),
      )!;
      expect(match).not.toBeNull();
      const [x, y, width, height] = match.slice(1).map(Number);
      pos += match[0].length;
      for (let row = 0; row < height; row++)
        decoded.set(
          job.subarray(pos + row * width, pos + (row + 1) * width),
          (y + row) * 50 + x / 8,
        );
      pos += width * height + 2;
      bands++;
    }
    expect(decoded).toEqual(reference);
    expect(bands).toBe(3);
    expect(text.decode(job.slice(pos))).toBe('PRINT 1,1\r\n');
    expect(job.length).toBeLessThan(4000);
  });
  it('keeps the original conservative transport in Compatibility mode', async () => {
    const write = vi.fn().mockResolvedValue(undefined),
      wait = vi.fn().mockResolvedValue(undefined);
    await sendLabel(
      {
        properties: { write: false, writeWithoutResponse: true },
        writeValueWithoutResponse: write,
        writeValueWithResponse: vi.fn(),
      },
      new Uint8Array(41),
      wait,
      'compatible',
    );
    expect(write.mock.calls.map((call) => call[0].length)).toEqual([20, 20, 1]);
    expect(wait.mock.calls.map((call) => call[0])).toEqual([30, 30, 30]);
  });
  it('rejects invalid dimensions and gap before sending', () => {
    const rgba = new Uint8ClampedArray(400 * 480 * 4);
    for (const gap of [NaN, Infinity, -1, 0, 7])
      expect(() => encodeLabel(rgba, 400, 480, gap)).toThrow();
    expect(() => encodeLabel(rgba, 384, 480, 2)).toThrow();
  });
  it('transmits serial 20-byte chunks without retry or additional print commands', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const response = vi.fn();
    const channel: PrinterCharacteristic = {
      properties: { write: true, writeWithoutResponse: true },
      writeValueWithoutResponse: write,
      writeValueWithResponse: response,
    };
    const bytes = Uint8Array.from({ length: 43 }, (_, i) => i);
    const wait = vi.fn().mockResolvedValue(undefined);
    await sendLabel(channel, bytes, wait);
    expect(write.mock.calls.map((call) => [...call[0]])).toEqual([
      [...bytes.slice(0, 20)],
      [...bytes.slice(20, 40)],
      [...bytes.slice(40)],
    ]);
    expect(response).not.toHaveBeenCalled();
    expect(wait.mock.calls.map((call) => call[0])).toEqual([4, 4, 4]);
    write
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disconnected'));
    await expect(sendLabel(channel, bytes, wait)).rejects.toThrow('disconnected');
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('supports writes with response when required by the BLE characteristic', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    await sendLabel(
      {
        properties: { write: true, writeWithoutResponse: false },
        writeValueWithResponse: write,
        writeValueWithoutResponse: vi.fn(),
      },
      new Uint8Array([1, 2]),
      async () => {},
    );
    expect(write).toHaveBeenCalledOnce();
  });
});
