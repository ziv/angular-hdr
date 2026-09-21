import { histogramPosition, HISTOGRAM_BINS, luminance, luminanceHistogram } from './analyze';
import { sdrToLinear } from './convert';
import { bt2390ToneMap, srgbPeakNits, toneMapToSrgb8 } from './tonemap';

describe('bt2390ToneMap', () => {
  const options = { whiteNits: 203, sourcePeakNits: 1000 };

  it('leaves shadows and mid-tones alone and maps the source peak to white', () => {
    expect(bt2390ToneMap(0, options)).toBe(0);
    expect(bt2390ToneMap(20, options)).toBe(20);
    expect(bt2390ToneMap(1000, options)).toBeCloseTo(203, 3);
    expect(bt2390ToneMap(5000, options)).toBeCloseTo(203, 3);
  });

  it('is monotonic and continuous, and only ever compresses', () => {
    let previous = 0;
    for (let nits = 1; nits <= 1000; nits += 1) {
      const mapped = bt2390ToneMap(nits, options);
      expect(mapped).toBeGreaterThan(previous);
      expect(mapped - previous).toBeLessThan(1.01);
      expect(mapped).toBeLessThanOrEqual(nits);
      previous = mapped;
    }
  });

  it('is the identity (with a clip at white) when the source already fits', () => {
    expect(bt2390ToneMap(150, { whiteNits: 203, sourcePeakNits: 203 })).toBe(150);
    expect(bt2390ToneMap(300, { whiteNits: 203, sourcePeakNits: 100 })).toBe(203);
  });
});

describe('toneMapToSrgb8', () => {
  it('returns SDR content to the exact 8-bit values it was made from', () => {
    const codes = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) codes.set([i, 255 - i, (i * 7) % 256, 255], i * 4);
    const linear = sdrToLinear(codes, 4);
    expect(toneMapToSrgb8(linear, 4, { whiteNits: 203, sourcePeakNits: 203 })).toEqual(codes);
  });

  it('rolls HDR highlights off into white instead of clipping them', () => {
    const linear = new Float32Array([
      1000, 1000, 1000, 1, 600, 600, 600, 1, 300, 300, 300, 1, 40, 40, 40, 1,
    ]);
    const [peak, , , high, , , mid, , , low] = toneMapToSrgb8(linear, 3, {
      whiteNits: 203,
      sourcePeakNits: 1000,
    });
    expect(peak).toBe(255);
    expect(high).toBeLessThan(255);
    expect(mid).toBeLessThan(high);
    // below the knee nothing changes: 40 nits is sRGB 0.197 linear → code 123
    expect(low).toBe(123);
  });

  it('keeps the hue of bright saturated colors', () => {
    // an sRGB red, four times brighter than SDR white allows
    const red = new Float32Array(
      Array.from(sdrToLinear(new Uint8Array([255, 64, 64]), 3), (v, i) => (i < 3 ? v * 4 : v)),
    );
    // its brightest BT.2020 channel is far below its brightest sRGB channel, which is what has to fit
    expect(Math.max(...red.subarray(0, 3))).toBeLessThan(600);
    expect(srgbPeakNits(red)).toBeCloseTo(812, 1);
    expect(
      Array.from(toneMapToSrgb8(red, 3, { whiteNits: 203, sourcePeakNits: srgbPeakNits(red) })),
    ).toEqual([255, 64, 64]);
  });

  it('desaturates colors outside sRGB until they fit, without going dark', () => {
    // pure BT.2020 green at SDR white
    const [r, g, b, a] = toneMapToSrgb8(new Float32Array([0, 203, 0, 0.5]), 4, {
      whiteNits: 203,
      sourcePeakNits: 203,
    });
    // luminance is kept, so the green ends up a little below full scale and the other channels are lifted off zero
    expect(g).toBeGreaterThan(235);
    expect(Math.min(r, b)).toBe(0);
    expect(Math.max(r, b)).toBeLessThan(g);
    expect(a).toBe(128);
  });
});

describe('analyze', () => {
  it('bins luminance on a log axis', () => {
    expect(luminance(100, 100, 100)).toBeCloseTo(100, 6);
    expect(histogramPosition(0.1)).toBe(0);
    expect(histogramPosition(10000)).toBe(1);
    expect(histogramPosition(31.6228)).toBeCloseTo(0.5, 4);

    const bins = luminanceHistogram(
      new Float32Array([0, 0, 0, 1, 31.6228, 31.6228, 31.6228, 1, 20000, 20000, 20000, 1]),
    );
    expect(bins.length).toBe(HISTOGRAM_BINS);
    expect(bins[0]).toBe(1);
    expect(bins[HISTOGRAM_BINS / 2]).toBe(1);
    expect(bins[HISTOGRAM_BINS - 1]).toBe(1);
    expect(bins.reduce((sum, count) => sum + count, 0)).toBe(3);
  });
});
