import { DISPLAY_P3_TO_BT2020, SRGB_TO_BT2020 } from '../color/matrices';
import { pqEncode } from '../color/transfer';
import { exportHdrPng } from '../io/export';
import { CICP_REC2100_PQ } from '../png/color-chunks';
import { decodePng } from '../png/decode';
import type { ImageF32 } from '../types';
import { createImage, drawNumber, fillRect, numberWidth } from './draw';
import { generatePattern, PATCH_NITS } from './patterns';
import { testProfiles } from '../testing/profiles';

const profile = testProfiles.hdr;

function pixel(image: ImageF32, x: number, y: number): number[] {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return Array.from(image.data.subarray(i, i + 4));
}

function expectPixel(image: ImageF32, x: number, y: number, expected: number[]) {
  pixel(image, x, y).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 3));
}

describe('draw', () => {
  it('creates an opaque black image', () => {
    const image = createImage(3, 2);
    expect(image.data.length).toBe(24);
    expect(pixel(image, 2, 1)).toEqual([0, 0, 0, 1]);
  });

  it('clips rectangles to the image', () => {
    const image = createImage(4, 4);
    fillRect(image, -2, 2, 4, 10, [1, 2, 3]);
    expect(pixel(image, 1, 3)).toEqual([1, 2, 3, 1]);
    expect(pixel(image, 2, 3)).toEqual([0, 0, 0, 1]);
    expect(pixel(image, 1, 1)).toEqual([0, 0, 0, 1]);
  });

  it('draws centered, scaled digits', () => {
    const image = createImage(20, 10);
    expect(numberWidth('17', 2)).toBe(14);
    drawNumber(image, '17', 10, 0, 2, [5, 5, 5]);
    // "1" starts at x=3: its top row is .#. so the middle cell (x 5-6) is lit
    expect(pixel(image, 3, 0)[0]).toBe(0);
    expect(pixel(image, 5, 0)[0]).toBe(5);
    expect(pixel(image, 6, 1)[0]).toBe(5);
    // "7" starts at x=11 with a full top row
    expect(pixel(image, 11, 0)[0]).toBe(5);
    expect(pixel(image, 16, 1)[0]).toBe(5);
    expect(pixel(image, 17, 0)[0]).toBe(0);
    expect(() => drawNumber(image, 'x', 0, 0, 1, [1, 1, 1])).toThrow('only digits');
  });
});

describe('patterns', () => {
  it('validates the size', () => {
    expect(() => generatePattern({ kind: 'patches' }, 0, 10)).toThrow('positive whole number');
    expect(() => generatePattern({ kind: 'patches' }, 10.5, 10)).toThrow('positive whole number');
  });

  it('comparison: SDR white on the left, HDR peak on the right', () => {
    const image = generatePattern({ kind: 'comparison', peakNits: 1600 }, 400, 200);
    expectPixel(image, 5, 5, [203, 203, 203, 1]);
    expectPixel(image, 199, 195, [203, 203, 203, 1]);
    expectPixel(image, 200, 5, [1600, 1600, 1600, 1]);
    // labels are drawn in black
    expect(image.data.filter((_, i) => i % 4 === 0 && image.data[i] === 0).length).toBeGreaterThan(
      100,
    );
  });

  it('patches: every patch has its nominal luminance on a black background', () => {
    const width = 1200;
    const height = 400;
    const image = generatePattern({ kind: 'patches' }, width, height);
    const gap = width * 0.03;
    const patchWidth = (width - gap * (PATCH_NITS.length + 1)) / PATCH_NITS.length;
    PATCH_NITS.forEach((nits, i) => {
      expectPixel(image, gap + i * (patchWidth + gap) + patchWidth / 2, height * 0.4, [
        nits,
        nits,
        nits,
        1,
      ]);
    });
    expectPixel(image, 2, 2, [0, 0, 0, 1]);
    expectPixel(image, gap + patchWidth + gap / 2, height * 0.4, [0, 0, 0, 1]);
  });

  it('ramp: rises monotonically from black to the peak, uniformly in PQ', () => {
    const width = 512;
    const image = generatePattern({ kind: 'ramp', peakNits: 1000 }, width, 100);
    expect(pixel(image, 0, 0)[0]).toBeCloseTo(0, 3);
    expect(pixel(image, width - 1, 0)[0]).toBeCloseTo(1000, 1);
    for (let x = 1; x < width; x++) {
      expect(pixel(image, x, 10)[0]).toBeGreaterThan(pixel(image, x - 1, 10)[0]);
      expect(pixel(image, x, 70)[0]).toBeGreaterThanOrEqual(pixel(image, x - 1, 70)[0]);
    }
    const mid = pqEncode(pixel(image, (width - 1) / 2, 0)[0]) / pqEncode(1000);
    expect(mid).toBeCloseTo(0.5, 2);
    // stepped band: 16 distinct levels, also ending on the peak
    const levels = new Set(Array.from({ length: width }, (_, x) => pixel(image, x, 70)[0]));
    expect(levels.size).toBe(16);
    expect(pixel(image, width - 1, 70)[0]).toBeCloseTo(1000, 1);
  });

  it('solid: converts the sRGB color to BT.2020 at the white level', () => {
    const white = generatePattern({ kind: 'solid', color: [1, 1, 1], whiteNits: 600 }, 8, 8);
    expectPixel(white, 7, 7, [600, 600, 600, 1]);
    const red = generatePattern({ kind: 'solid', color: [1, 0, 0], whiteNits: 100 }, 8, 8);
    expectPixel(red, 0, 0, [
      SRGB_TO_BT2020[0] * 100,
      SRGB_TO_BT2020[3] * 100,
      SRGB_TO_BT2020[6] * 100,
      1,
    ]);
  });

  it('gamut: rows are R, G, B and columns are sRGB, P3, BT.2020', () => {
    const image = generatePattern({ kind: 'gamut', whiteNits: 203 }, 300, 300);
    expectPixel(image, 250, 50, [203, 0, 0, 1]);
    expectPixel(image, 250, 150, [0, 203, 0, 1]);
    expectPixel(image, 250, 250, [0, 0, 203, 1]);
    expectPixel(image, 50, 150, [
      SRGB_TO_BT2020[1] * 203,
      SRGB_TO_BT2020[4] * 203,
      SRGB_TO_BT2020[7] * 203,
      1,
    ]);
    expectPixel(image, 150, 250, [
      DISPLAY_P3_TO_BT2020[2] * 203,
      DISPLAY_P3_TO_BT2020[5] * 203,
      DISPLAY_P3_TO_BT2020[8] * 203,
      1,
    ]);
  });
});

describe('exportHdrPng', () => {
  it('writes a tagged 16-bit RGB PNG with the measured light levels', () => {
    const image = generatePattern({ kind: 'comparison', peakNits: 1000 }, 64, 32);
    const { bytes, lightLevels } = exportHdrPng(image, profile);
    expect(lightLevels.maxCll).toBeCloseTo(1000, 3);
    expect(lightLevels.maxFall).toBeGreaterThan(203);
    expect(lightLevels.maxFall).toBeLessThan(1000);

    const decoded = decodePng(bytes);
    expect(decoded).toMatchObject({
      width: 64,
      height: 32,
      depth: 16,
      channels: 3,
      cicp: CICP_REC2100_PQ,
    });
    expect(decoded.icc?.profile).toEqual(profile.profile);
    expect(decoded.lightLevels?.maxCll).toBeCloseTo(1000, 3);
    expect(decoded.data[0]).toBe(Math.round(pqEncode(203) * 65535));
    expect(decoded.data[decoded.data.length - 1]).toBe(Math.round(pqEncode(1000) * 65535));
  });

  it('keeps the alpha channel only when it is used', () => {
    const image = createImage(2, 2);
    image.data[3] = 0.5;
    expect(decodePng(exportHdrPng(image, profile).bytes).channels).toBe(4);
  });
});
