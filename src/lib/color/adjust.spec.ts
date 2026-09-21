import type { ImageF32 } from '../types';
import { applyAdjustments, boostGain, DEFAULT_ADJUSTMENTS, type Adjustments } from './adjust';
import { sdrToLinear } from './convert';
import { downscaleToFit } from './resize';

function image(pixels: number[][]): ImageF32 {
  return { width: pixels.length, height: 1, data: new Float32Array(pixels.flat()) };
}

function adjust(pixels: number[][], adjustments: Partial<Adjustments>) {
  const result = applyAdjustments(image(pixels), { ...DEFAULT_ADJUSTMENTS, ...adjustments });
  return {
    ...result,
    pixels: Array.from({ length: pixels.length }, (_, i) =>
      Array.from(result.image.data.subarray(i * 4, i * 4 + 4)),
    ),
  };
}

describe('applyAdjustments', () => {
  it('is the identity with default settings and does not touch the source', () => {
    const source = image([
      [203, 100, 0, 0.5],
      [0, 0, 0, 1],
    ]);
    const result = applyAdjustments(source, DEFAULT_ADJUSTMENTS);
    expect(result.image.data).toEqual(source.data);
    expect(result.image.data).not.toBe(source.data);
    expect(result.clippedPixels).toBe(0);
  });

  it('moves reference white and applies exposure in linear light', () => {
    expect(adjust([[203, 101.5, 0, 1]], { whiteNits: 406 }).pixels[0]).toEqual([406, 203, 0, 1]);
    expect(adjust([[203, 101.5, 0, 1]], { exposureStops: -1 }).pixels[0]).toEqual([
      101.5, 50.75, 0, 1,
    ]);
    expect(adjust([[-5, 10, 10, 1]], {}).pixels[0]).toEqual([0, 10, 10, 1]);
  });

  it('clamps to the peak while keeping the hue, and counts clipped pixels', () => {
    const result = adjust(
      [
        [203, 101.5, 0, 1],
        [10, 10, 10, 1],
      ],
      { exposureStops: 3, peakNits: 400 },
    );
    expect(result.pixels[0]).toEqual([400, 200, 0, 1]);
    expect(result.pixels[1]).toEqual([80, 80, 80, 1]);
    expect(result.clippedPixels).toBe(1);
  });

  describe('highlight boost', () => {
    const boost = { boost: true, boostKnee: 0.5, peakNits: 1015 };

    it('leaves everything up to the knee alone and sends white to the peak', () => {
      const { pixels, clippedPixels } = adjust(
        [
          [50, 50, 50, 1],
          [101.5, 101.5, 101.5, 1],
          [203, 203, 203, 1],
        ],
        boost,
      );
      expect(pixels[0]).toEqual([50, 50, 50, 1]);
      expect(pixels[1]).toEqual([101.5, 101.5, 101.5, 1]);
      expect(pixels[2][0]).toBeCloseTo(1015, 2);
      expect(clippedPixels).toBe(0);
    });

    it('is continuous and monotonic', () => {
      let previous = 0;
      for (let step = 1; step <= 100; step++) {
        const t = step / 100;
        const boosted = t * boostGain(t, 0.5, 5);
        expect(boosted).toBeGreaterThan(previous);
        // the steepest slope, at white, is 1 + 2 * (peak - 1) / (1 - knee) = 17
        expect(boosted - previous).toBeLessThan(0.17);
        previous = boosted;
      }
      expect(previous).toBeCloseTo(5, 6);
      expect(boostGain(0.8, 0.5, 1)).toBe(1);
    });

    it('scales by the brightest channel so saturated highlights keep their hue', () => {
      const [r, g, b] = adjust([[203, 101.5, 20.3, 1]], boost).pixels[0];
      expect(r).toBeCloseTo(1015, 2);
      expect(g / r).toBeCloseTo(0.5, 5);
      expect(b / r).toBeCloseTo(0.1, 5);
    });

    it('follows the white level', () => {
      const { pixels } = adjust(
        [
          [203, 203, 203, 1],
          [101.5, 101.5, 101.5, 1],
        ],
        { ...boost, whiteNits: 406, peakNits: 2000 },
      );
      expect(pixels[0][0]).toBeCloseTo(2000, 1);
      expect(pixels[1][0]).toBeCloseTo(203, 3);
    });
  });

  describe('color expansion', () => {
    it('keeps neutrals and luminance, and pushes sRGB primaries toward BT.2020', () => {
      const red = Array.from(sdrToLinear(new Uint8Array([255, 0, 0]), 3));
      const { pixels } = adjust([[120, 120, 120, 1], red], { gamutExpansion: 1 });
      pixels[0].slice(0, 3).forEach((channel) => expect(channel).toBeCloseTo(120, 3));

      const [r, g, b] = pixels[1];
      expect(g).toBeCloseTo(0, 3);
      expect(b).toBeCloseTo(0, 3);
      // same luminance as the source red, now carried by the BT.2020 red primary alone
      expect(0.2627 * r).toBeCloseTo(0.2627 * red[0] + 0.678 * red[1] + 0.0593 * red[2], 1);
    });

    it('interpolates', () => {
      const red = Array.from(sdrToLinear(new Uint8Array([255, 0, 0]), 3));
      const half = adjust([red], { gamutExpansion: 0.5 }).pixels[0];
      expect(half[1]).toBeGreaterThan(0);
      expect(half[1]).toBeLessThan(red[1]);
    });
  });
});

describe('downscaleToFit', () => {
  it('returns the source when it already fits', () => {
    const source = image([
      [1, 2, 3, 1],
      [4, 5, 6, 1],
    ]);
    expect(downscaleToFit(source, 2)).toBe(source);
  });

  it('averages blocks, including partial ones at the edges', () => {
    const source: ImageF32 = { width: 3, height: 2, data: new Float32Array(3 * 2 * 4) };
    const values = [10, 20, 60, 30, 40, 80];
    values.forEach((value, i) => source.data.set([value, value * 2, 0, i === 0 ? 0 : 1], i * 4));
    const result = downscaleToFit(source, 2);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(Array.from(result.data)).toEqual([25, 50, 0, 0.75, 70, 140, 0, 1]);
  });

  it('reaches the requested size for large ratios', () => {
    const source: ImageF32 = {
      width: 1000,
      height: 10,
      data: new Float32Array(1000 * 10 * 4).fill(7),
    };
    const result = downscaleToFit(source, 100);
    expect([result.width, result.height]).toEqual([100, 1]);
    expect(result.data.every((value) => value === 7)).toBe(true);
  });
});
