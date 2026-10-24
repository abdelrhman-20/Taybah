import { describe, expect, it } from 'vitest';
import { createZip, crc32, readZip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('zip (store-only backup container)', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('round-trips text, unicode names and binary data byte-for-byte', () => {
    const bin = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    const zip = createZip([
      { name: 'README.txt', data: enc.encode('مرحبا — hello') },
      { name: 'images/صورة-1.png', data: bin },
      { name: 'empty.bin', data: new Uint8Array(0) },
    ]);
    const out = readZip(zip);
    expect(out.map((e) => e.name)).toEqual(['README.txt', 'images/صورة-1.png', 'empty.bin']);
    expect(dec.decode(out[0].data)).toBe('مرحبا — hello');
    expect(out[1].data).toEqual(bin);
    expect(out[2].data.length).toBe(0);
  });

  it('detects a corrupted entry via its checksum', () => {
    const zip = createZip([{ name: 'a.txt', data: enc.encode('important catalog data') }]);
    const bad = zip.slice();
    bad[bad.indexOf(0x69)] ^= 0xff; // flip a byte inside the stored data
    expect(() => readZip(bad)).toThrow(/checksum/);
  });

  it('rejects data that is not a zip', () => {
    expect(() => readZip(enc.encode('this is not a zip file at all, just text'))).toThrow(/not a zip/);
  });

  it('rejects a truncated archive', () => {
    const zip = createZip([{ name: 'a.txt', data: enc.encode('x'.repeat(200)) }]);
    expect(() => readZip(zip.slice(0, zip.length - 30))).toThrow();
  });
});
