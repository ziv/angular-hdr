import { encode } from 'fast-png';
import { pqEncode } from '../color/transfer';
import { generatePattern } from '../generate/patterns';
import { identifyColorSpace } from '../icc/identify';
import { replaceColorChunks } from '../png/chunks';
import { CICP_REC2100_PQ, cicpChunk, iccpChunk } from '../png/color-chunks';
import { exportHdrPng } from './export';
import { extractJpegIcc, sniffFormat } from './format';
import { loadImage } from './load';
import { testProfiles } from '../testing/profiles';

const rec2100Pq = testProfiles.hdr.profile;
const srgb = testProfiles.sdr.profile;

/** sRGB-v4.icc with its colorant tags overwritten, which is all that separates it from a Display P3 profile. */
function withColorants(xyz: number[]): Uint8Array {
  const profile = srgb.slice();
  const view = new DataView(profile.buffer);
  const tagCount = view.getUint32(128);
  for (let i = 0; i < tagCount; i++) {
    const entry = 132 + i * 12;
    const index = ['rXYZ', 'gXYZ', 'bXYZ'].indexOf(
      String.fromCharCode(...profile.subarray(entry, entry + 4)),
    );
    if (index < 0) continue;
    const offset = view.getUint32(entry + 4) + 8;
    for (let c = 0; c < 3; c++)
      view.setInt32(offset + c * 4, Math.round(xyz[index * 3 + c] * 65536));
  }
  return profile;
}

const displayP3 = withColorants([
  0.5151, 0.2412, -0.0011, 0.292, 0.6922, 0.0419, 0.1571, 0.0666, 0.7841,
]);

function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const iccSegment = (sequence: number, count: number, data: number[]) =>
  jpegSegment(0xe2, [
    ...Array.from('ICC_PROFILE\0', (ch) => ch.charCodeAt(0)),
    sequence,
    count,
    ...data,
  ]);

describe('format', () => {
  it('sniffs by magic bytes', () => {
    expect(sniffFormat(encode({ width: 1, height: 1, data: new Uint8Array(3), channels: 3 }))).toBe(
      'png',
    );
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeUndefined();
    expect(sniffFormat(new Uint8Array())).toBeUndefined();
  });

  it('reassembles a multi segment JPEG ICC profile in sequence order', () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      ...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
      ...iccSegment(2, 2, [4, 5]),
      ...jpegSegment(0xe2, [1, 2, 3]),
      ...iccSegment(1, 2, [1, 2, 3]),
      ...jpegSegment(0xda, [0]),
      // entropy coded data that must not be parsed as segments
      0xff,
      0xe2,
      0x00,
      0x02,
    ]);
    expect(extractJpegIcc(jpeg)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('returns nothing for missing or incomplete profiles', () => {
    expect(
      extractJpegIcc(
        new Uint8Array([0xff, 0xd8, ...jpegSegment(0xe0, [1]), ...jpegSegment(0xda, [0])]),
      ),
    ).toBeUndefined();
    expect(
      extractJpegIcc(
        new Uint8Array([0xff, 0xd8, ...iccSegment(2, 2, [4, 5]), ...jpegSegment(0xda, [0])]),
      ),
    ).toBeUndefined();
    expect(extractJpegIcc(new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0xff]))).toBeUndefined();
  });
});

describe('identifyColorSpace', () => {
  it('assumes sRGB for untagged images', () => {
    expect(identifyColorSpace({})).toEqual({ colorSpace: 'srgb', label: 'Untagged, assumed sRGB' });
  });

  it('recognizes the bundled profiles', () => {
    expect(identifyColorSpace({ icc: rec2100Pq })).toEqual({
      colorSpace: 'rec2100-pq',
      label: 'Rec2020 Gamut with PQ Transfer',
    });
    expect(identifyColorSpace({ icc: srgb })).toEqual({ colorSpace: 'srgb', label: 'sRGB' });
  });

  it('recognizes Display P3 by its colorants and rejects unknown ones', () => {
    expect(identifyColorSpace({ icc: displayP3 }).colorSpace).toBe('display-p3');
    // Adobe RGB colorants
    expect(
      identifyColorSpace({
        icc: withColorants([
          0.6097, 0.3111, 0.0195, 0.2053, 0.6257, 0.0609, 0.1492, 0.0632, 0.7446,
        ]),
      }).colorSpace,
    ).toBe('unknown');
  });

  it('rejects known colorants with a different transfer curve', () => {
    const gamma22 = srgb.slice();
    const view = new DataView(gamma22.buffer);
    // all three TRC tags share one `para` element; its gamma is the first parameter
    for (let i = 0; i < view.getUint32(128); i++) {
      const entry = 132 + i * 12;
      if (String.fromCharCode(...gamma22.subarray(entry, entry + 4)) === 'rTRC')
        view.setInt32(view.getUint32(entry + 4) + 12, 2.2 * 65536);
    }
    expect(identifyColorSpace({ icc: gamma22 }).colorSpace).toBe('unknown');
  });

  it('prefers cICP over the ICC profile', () => {
    expect(identifyColorSpace({ cicp: CICP_REC2100_PQ, icc: srgb })).toEqual({
      colorSpace: 'rec2100-pq',
      label: 'cICP 9/16/0/1',
    });
    expect(
      identifyColorSpace({ cicp: { primaries: 1, transfer: 13, matrix: 0, fullRange: true } })
        .colorSpace,
    ).toBe('srgb');
    expect(
      identifyColorSpace({ cicp: { primaries: 12, transfer: 13, matrix: 0, fullRange: true } })
        .colorSpace,
    ).toBe('display-p3');
    expect(
      identifyColorSpace({ cicp: { primaries: 9, transfer: 18, matrix: 0, fullRange: true } })
        .colorSpace,
    ).toBe('unknown');
    expect(identifyColorSpace({ cicp: { ...CICP_REC2100_PQ, fullRange: false } }).colorSpace).toBe(
      'unknown',
    );
  });

  it('survives garbage', () => {
    expect(identifyColorSpace({ icc: new Uint8Array(200) })).toEqual({
      colorSpace: 'unknown',
      label: 'Invalid ICC profile',
    });
  });
});

describe('loadImage', () => {
  const profile = { name: 'Rec2100 PQ', profile: rec2100Pq };

  it('rejects other formats and damaged files', async () => {
    await expect(loadImage(new Uint8Array([1, 2, 3, 4]), 'a.gif')).rejects.toThrow(
      'Only PNG and JPEG',
    );
    const png = encode({ width: 1, height: 1, data: new Uint16Array(3), depth: 16, channels: 3 });
    await expect(loadImage(png.slice(0, png.length - 6), 'cut.png')).rejects.toThrow('Truncated');
  });

  it('decodes untagged 16-bit PNGs at full precision with white at 203 nits', async () => {
    const data = new Uint16Array([65535, 65535, 65535, 0, 0, 0, 32768, 32768, 32768, 1, 1, 1]);
    const loaded = await loadImage(
      encode({ width: 2, height: 2, data, depth: 16, channels: 3 }) as Uint8Array<ArrayBuffer>,
      'x.png',
    );
    expect(loaded).toMatchObject({
      format: 'png',
      width: 2,
      height: 2,
      bitDepth: 16,
      colorSpace: 'srgb',
      warnings: [],
    });
    expect(loaded.image.data[0]).toBeCloseTo(203, 3);
    expect(loaded.image.data[3]).toBe(1);
    expect(loaded.image.data[4]).toBe(0);
    // code 1 of 65535 must survive, an 8-bit decode would have flattened it to black
    expect(loaded.image.data[12]).toBeGreaterThan(0);
  });

  it('expands 16-bit grey + alpha and honors a Display P3 profile', async () => {
    const grey = encode({
      width: 1,
      height: 1,
      data: new Uint16Array([65535, 32768]),
      depth: 16,
      channels: 2,
    });
    const loaded = await loadImage(
      replaceColorChunks(grey, [iccpChunk({ name: 'P3', profile: displayP3 })]),
      'grey.png',
    );
    expect(loaded.colorSpace).toBe('display-p3');
    const [r, g, b, a] = loaded.image.data;
    expect([r, g, b].map((v) => Math.round(v))).toEqual([203, 203, 203]);
    expect(a).toBeCloseTo(32768 / 65535, 6);
  });

  it('round trips our own HDR export', async () => {
    const pattern = generatePattern({ kind: 'comparison', peakNits: 1000 }, 32, 16);
    const loaded = await loadImage(exportHdrPng(pattern, profile).bytes, 'card-hdr.png');
    expect(loaded).toMatchObject({
      width: 32,
      height: 16,
      bitDepth: 16,
      colorSpace: 'rec2100-pq',
      colorSpaceLabel: 'cICP 9/16/0/1',
    });
    expect(loaded.image.data[0]).toBeCloseTo(203, 1);
    expect(loaded.image.data[loaded.image.data.length - 4]).toBeCloseTo(1000, 0);
  });

  it('reads 8-bit PQ PNGs that are tagged through the ICC profile only', async () => {
    const code = Math.round(pqEncode(203) * 255);
    const png = encode({
      width: 1,
      height: 1,
      data: new Uint8Array([code, code, code]),
      channels: 3,
    });
    const loaded = await loadImage(replaceColorChunks(png, [iccpChunk(profile)]), 'pq8.png');
    expect(loaded).toMatchObject({
      bitDepth: 8,
      colorSpace: 'rec2100-pq',
      colorSpaceLabel: 'Rec2020 Gamut with PQ Transfer',
    });
    expect(loaded.image.data[0]).toBeGreaterThan(190);
    expect(loaded.image.data[0]).toBeLessThan(215);
  });

  it('refuses palette based PQ PNGs', async () => {
    const png = encode({
      width: 1,
      height: 1,
      data: new Uint8Array([0]),
      depth: 8,
      channels: 1,
      palette: [[1, 2, 3]],
    });
    await expect(
      loadImage(replaceColorChunks(png, [cicpChunk(CICP_REC2100_PQ)]), 'indexed.png'),
    ).rejects.toThrow('not supported');
  });
});
