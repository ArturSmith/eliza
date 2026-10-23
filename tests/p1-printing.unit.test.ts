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
    const job = encodeLabel(rgba, 400, 480, 2);
    const header =
      'SIZE 50 mm,60 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,50,480,0,';
    expect(new TextDecoder().decode(job.slice(0, header.length))).toBe(header);
    expect([...job.slice(header.length, header.length + 3)]).toEqual([126, 127, 255]);
    expect(job.length).toBe(header.length + 24000 + '\r\nPRINT 1,1\r\n'.length);
    expect(new TextDecoder().decode(job.slice(-13))).toBe('\r\nPRINT 1,1\r\n');
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
