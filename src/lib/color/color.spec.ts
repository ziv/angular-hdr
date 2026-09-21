import {
  computeLightLevels,
  hasTransparency,
  linearToPq16,
  nitsToPqCode,
  pq16ToLinear,
  sdrToLinear,
} from './convert';
import {
  BT2020_PRIMARIES,
  BT2020_TO_SRGB,
  DISPLAY_P3_TO_BT2020,
  multiply,
  rgbToXyzMatrix,
  SRGB_PRIMARIES,
  SRGB_TO_BT2020,
  transform,
  type Mat3,
} from './matrices';
import { linearToSrgb, pqDecode, pqEncode, srgbToLinear } from './transfer';

function expectMatrix(actual: Mat3, expected: number[], digits: number) {
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits));
}

describe('sRGB transfer', () => {
  it('maps the end points', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
  });

  it('matches known values', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 5);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.46136, 5);
  });

  it('round trips every 8-bit code', () => {
    for (let code = 0; code <= 255; code++) {
      expect(Math.round(linearToSrgb(srgbToLinear(code / 255)) * 255)).toBe(code);
    }
  });
});

describe('PQ transfer', () => {
  it('matches ST 2084 reference points', () => {
    // ST 2084 gives c1^m2 ≈ 7e-7 for black, which still quantizes to code 0
    expect(pqEncode(0)).toBeCloseTo(0, 5);
    expect(Math.round(pqEncode(0) * 65535)).toBe(0);
    expect(pqEncode(100)).toBeCloseTo(0.5081, 4);
    expect(pqEncode(203)).toBeCloseTo(0.5807, 4);
    expect(pqEncode(1000)).toBeCloseTo(0.7518, 4);
    expect(pqEncode(10000)).toBeCloseTo(1, 12);
  });

  it('clamps out of range input', () => {
    expect(pqEncode(-5)).toBe(pqEncode(0));
    expect(pqEncode(20000)).toBe(pqEncode(10000));
  });

  it('round trips across the luminance range', () => {
    for (const nits of [0.01, 1, 48, 100, 203, 1000, 4000, 10000]) {
      expect(pqDecode(pqEncode(nits)) / nits).toBeCloseTo(1, 9);
    }
  });

  it('round trips every 16-bit code', () => {
    for (let code = 0; code <= 65535; code += 5) {
      expect(Math.round(pqEncode(pqDecode(code / 65535)) * 65535)).toBe(code);
    }
  });
});

describe('primaries matrices', () => {
  it('derives the standard sRGB to XYZ matrix', () => {
    expectMatrix(
      rgbToXyzMatrix(SRGB_PRIMARIES),
      [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505],
      4,
    );
  });

  it('derives the BT.2020 luminance coefficients', () => {
    const m = rgbToXyzMatrix(BT2020_PRIMARIES);
    expect(m[3]).toBeCloseTo(0.2627, 4);
    expect(m[4]).toBeCloseTo(0.678, 4);
    expect(m[5]).toBeCloseTo(0.0593, 4);
  });

  it('matches the BT.2087 sRGB to BT.2020 matrix', () => {
    expectMatrix(
      SRGB_TO_BT2020,
      [0.6274, 0.3293, 0.0433, 0.0691, 0.9195, 0.0114, 0.0164, 0.088, 0.8956],
      4,
    );
  });

  it('matches the Display P3 to BT.2020 matrix', () => {
    expectMatrix(
      DISPLAY_P3_TO_BT2020,
      [0.7538, 0.1986, 0.0476, 0.0457, 0.9418, 0.0125, -0.0012, 0.0176, 0.9836],
      4,
    );
  });

  it('keeps white neutral', () => {
    for (const m of [SRGB_TO_BT2020, DISPLAY_P3_TO_BT2020, BT2020_TO_SRGB]) {
      transform(m, [1, 1, 1]).forEach((channel) => expect(channel).toBeCloseTo(1, 12));
    }
  });

  it('inverts', () => {
    expectMatrix(multiply(SRGB_TO_BT2020, BT2020_TO_SRGB), [1, 0, 0, 0, 1, 0, 0, 0, 1], 12);
  });
});

describe('buffer conversions', () => {
  it('places SDR white at the requested luminance', () => {
    const linear = sdrToLinear(new Uint8Array([255, 255, 255, 0, 0, 0]), 3);
    expect(Array.from(linear.subarray(0, 4), (v) => Math.round(v * 1000) / 1000)).toEqual([
      203, 203, 203, 1,
    ]);
    expect(Array.from(linear.subarray(4))).toEqual([0, 0, 0, 1]);
    expect(sdrToLinear(new Uint8Array([255, 255, 255]), 3, { whiteNits: 100 })[1]).toBeCloseTo(
      100,
      3,
    );
  });

  it('converts primaries and keeps alpha', () => {
    const linear = sdrToLinear(new Uint8ClampedArray([255, 0, 0, 128]), 4, { whiteNits: 100 });
    expect(linear[0]).toBeCloseTo(62.74, 2);
    expect(linear[1]).toBeCloseTo(6.91, 2);
    expect(linear[2]).toBeCloseTo(1.64, 2);
    expect(linear[3]).toBeCloseTo(128 / 255, 6);
  });

  it('accepts 16-bit SDR input', () => {
    const linear = sdrToLinear(new Uint16Array([65535, 65535, 65535, 65535]), 4, {
      source: 'display-p3',
    });
    expect(linear[0]).toBeCloseTo(203, 3);
    expect(linear[3]).toBe(1);
  });

  it('encodes SDR white to the expected PQ code', () => {
    const pq = linearToPq16(sdrToLinear(new Uint8Array([255, 255, 255]), 3), 3);
    expect(Array.from(pq)).toEqual(new Array(3).fill(Math.round(pqEncode(203) * 65535)));
  });

  it('interpolated PQ encoding stays within 0.01 codes of the exact curve', () => {
    let worst = 0;
    for (let exponent = -8; exponent <= 4; exponent += 0.0007) {
      const nits = Math.pow(10, exponent);
      worst = Math.max(worst, Math.abs(nitsToPqCode(nits) - pqEncode(nits) * 65535));
    }
    expect(worst).toBeLessThan(0.01);
    expect([
      nitsToPqCode(0),
      nitsToPqCode(-1),
      nitsToPqCode(NaN),
      nitsToPqCode(10000),
      nitsToPqCode(1e9),
    ]).toEqual([0, 0, 0, 65535, 65535]);
  });

  it('round trips every 16-bit PQ code exactly', () => {
    const pixels = Uint16Array.from({ length: 65536 }, (_, code) => code);
    expect(linearToPq16(pq16ToLinear(pixels.subarray(0, 65535), 3), 3)).toEqual(
      pixels.subarray(0, 65535),
    );
    expect(linearToPq16(pq16ToLinear(pixels, 4), 4)).toEqual(pixels);
  });

  it('adds and drops the alpha channel', () => {
    const linear = pq16ToLinear(new Uint16Array([100, 200, 300]), 3);
    expect(linear[3]).toBe(1);
    expect(hasTransparency(linear)).toBe(false);
    expect(linearToPq16(linear, 3)).toEqual(new Uint16Array([100, 200, 300]));
    expect(hasTransparency(new Float32Array([0, 0, 0, 0.5]))).toBe(true);
  });

  it('computes MaxCLL and MaxFALL', () => {
    const linear = new Float32Array([1000, 10, 10, 1, 0, 200, 0, 1]);
    expect(computeLightLevels(linear)).toEqual({ maxCll: 1000, maxFall: 600 });
  });
});
