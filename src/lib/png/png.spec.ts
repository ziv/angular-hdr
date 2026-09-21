import { encode } from 'fast-png';
import { unzlibSync } from 'fflate';
import { BT2020_PRIMARIES } from '../color/matrices';
import { parseChunks, PNG_SIGNATURE, replaceColorChunks, serializeChunks } from './chunks';
import {
  CICP_REC2100_PQ,
  cicpChunk,
  clliChunk,
  iccpChunk,
  mdcvChunk,
  readCicp,
  readClli,
  readIccp,
} from './color-chunks';
import { crc32 } from './crc32';
import { decodePng } from './decode';
import { encodeHdrPng } from './encode';
import { testProfiles } from '../testing/profiles';

const profile = testProfiles.hdr;
const rec2100Pq = profile.profile;

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

describe('crc32', () => {
  it('matches known vectors', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
  });

  it('is continuous across parts', () => {
    expect(crc32(ascii('1234'), ascii('56789'))).toBe(0xcbf43926);
  });
});

describe('chunks', () => {
  const png = encode({
    width: 2,
    height: 1,
    data: new Uint8Array([1, 2, 3, 4, 5, 6]),
    channels: 3,
  });

  it('parses and re-serializes byte for byte', () => {
    const chunks = parseChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(serializeChunks(chunks)).toEqual(png);
  });

  it('rejects bad input', () => {
    expect(() => parseChunks(new Uint8Array(20))).toThrow('Not a PNG');
    expect(() => parseChunks(png.subarray(0, png.length - 5))).toThrow('Truncated');
    const corrupt = png.slice();
    corrupt[PNG_SIGNATURE.length + 8] ^= 0xff;
    expect(() => parseChunks(corrupt)).toThrow('CRC mismatch in IHDR');
    expect(() => serializeChunks([{ type: 'bad!', data: new Uint8Array() }])).toThrow(
      'Invalid PNG chunk type',
    );
  });

  it('replaces existing color chunks right after IHDR', () => {
    const [ihdr, ...rest] = parseChunks(png);
    const tagged = serializeChunks([
      ihdr,
      { type: 'gAMA', data: new Uint8Array(4) },
      { type: 'sRGB', data: new Uint8Array(1) },
      { type: 'tEXt', data: ascii('k\0v') },
      ...rest,
    ]);
    const result = parseChunks(replaceColorChunks(tagged, [cicpChunk(CICP_REC2100_PQ)]));
    expect(result.map((chunk) => chunk.type)).toEqual(['IHDR', 'cICP', 'tEXt', 'IDAT', 'IEND']);
    expect(() => replaceColorChunks(png, [{ type: 'tEXt', data: new Uint8Array() }])).toThrow(
      'not a color space chunk',
    );
  });
});

describe('color chunks', () => {
  it('writes cICP as 9/16/0/1, matching the cicp tag inside the ICC profile', () => {
    const chunk = cicpChunk(CICP_REC2100_PQ);
    expect(Array.from(chunk.data)).toEqual([9, 16, 0, 1]);
    expect(readCicp([chunk])).toEqual(CICP_REC2100_PQ);

    const view = new DataView(rec2100Pq.buffer, rec2100Pq.byteOffset);
    const tagCount = view.getUint32(128);
    let iccCicp: number[] | undefined;
    for (let i = 0; i < tagCount; i++) {
      const entry = 132 + i * 12;
      if (view.getUint32(entry) === 0x63696370) {
        const offset = view.getUint32(entry + 4);
        iccCicp = Array.from(rec2100Pq.subarray(offset + 8, offset + 12));
      }
    }
    expect(iccCicp).toEqual(Array.from(chunk.data));
  });

  it('round trips the ICC profile through iCCP', () => {
    const chunk = iccpChunk(profile);
    expect(chunk.data.length).toBeLessThan(rec2100Pq.length);
    expect(readIccp([chunk])).toEqual(profile);
  });

  it('validates the iCCP profile name', () => {
    for (const name of ['', ' padded', 'double  space', 'x'.repeat(80), 'tab\there']) {
      expect(() => iccpChunk({ name, profile: rec2100Pq })).toThrow('Invalid iCCP profile name');
    }
  });

  it('stores light levels in 0.0001 nit units', () => {
    const chunk = clliChunk({ maxCll: 1000, maxFall: 203.5 });
    const view = new DataView(chunk.data.buffer);
    expect([view.getUint32(0), view.getUint32(4)]).toEqual([10_000_000, 2_035_000]);
    expect(readClli([chunk])).toEqual({ maxCll: 1000, maxFall: 203.5 });
  });

  it('stores the mastering display volume', () => {
    const { data } = mdcvChunk({ primaries: BT2020_PRIMARIES, maxNits: 1000, minNits: 0.005 });
    const view = new DataView(data.buffer);
    expect(data.length).toBe(24);
    expect([view.getUint16(0), view.getUint16(2)]).toEqual([35400, 14600]);
    expect([view.getUint16(12), view.getUint16(14)]).toEqual([15635, 16450]);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([10_000_000, 50]);
  });
});

describe('HDR PNG', () => {
  const data = new Uint16Array([0, 1, 65535, 38055, 49268, 12345, 256, 255, 32768, 1, 2, 3]);

  it.each([3, 4] as const)(
    'round trips 16-bit pixels and color tags with %i channels',
    (channels) => {
      const lightLevels = { maxCll: 1000, maxFall: 120 };
      const png = encodeHdrPng(
        { width: 12 / channels, height: 1, channels, data },
        { profile, lightLevels },
      );
      expect(parseChunks(png).map((chunk) => chunk.type)).toEqual([
        'IHDR',
        'cICP',
        'cLLi',
        'iCCP',
        'IDAT',
        'IEND',
      ]);

      const decoded = decodePng(png);
      expect(decoded).toMatchObject({
        width: 12 / channels,
        height: 1,
        depth: 16,
        channels,
        cicp: CICP_REC2100_PQ,
        lightLevels,
      });
      expect(decoded.data).toEqual(data);
      expect(decoded.icc).toEqual(profile);
    },
  );

  it('filters rows adaptively and still decodes with an independent decoder', () => {
    const width = 64;
    const height = 60;
    const channels = 3;
    const image = new Uint16Array(width * height * channels);
    let seed = 1;
    const random = () => (seed = (seed * 48271) % 0x7fffffff) & 0xffff;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let ch = 0; ch < channels; ch++) {
          const band = Math.floor(y / 15);
          const value =
            band === 0
              ? random()
              : band === 1
                ? x * 1000 + ch * 77
                : band === 2
                  ? y * 900 + (random() % 3)
                  : (x * x * 13 + y * y * 7 + x * y * 5) % 65536;
          image[(y * width + x) * channels + ch] = value;
        }
      }
    }
    const png = encodeHdrPng({ width, height, channels, data: image }, { profile });
    expect(decodePng(png).data).toEqual(image);

    const idat = parseChunks(png).find((chunk) => chunk.type === 'IDAT')!;
    const scanlines = unzlibSync(idat.data);
    const rowBytes = width * channels * 2 + 1;
    expect(scanlines.length).toBe(rowBytes * height);
    const filters = new Set(Array.from({ length: height }, (_, y) => scanlines[y * rowBytes]));
    expect(filters.size).toBeGreaterThanOrEqual(3);
  });

  it('rejects mismatched dimensions', () => {
    expect(() => encodeHdrPng({ width: 3, height: 2, channels: 3, data }, { profile })).toThrow(
      'does not match',
    );
  });
});
