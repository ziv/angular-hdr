/** 3×3 matrix, row-major. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type Vec3 = readonly [number, number, number];

/** CIE xy chromaticities of the red, green and blue primaries and the white point. */
export interface Primaries {
  r: readonly [number, number];
  g: readonly [number, number];
  b: readonly [number, number];
  white: readonly [number, number];
}

const D65 = [0.3127, 0.329] as const;

export const SRGB_PRIMARIES: Primaries = {
  r: [0.64, 0.33],
  g: [0.3, 0.6],
  b: [0.15, 0.06],
  white: D65,
};

export const DISPLAY_P3_PRIMARIES: Primaries = {
  r: [0.68, 0.32],
  g: [0.265, 0.69],
  b: [0.15, 0.06],
  white: D65,
};

export const BT2020_PRIMARIES: Primaries = {
  r: [0.708, 0.292],
  g: [0.17, 0.797],
  b: [0.131, 0.046],
  white: D65,
};

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out as unknown as Mat3;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (det === 0) throw new Error('Matrix is not invertible');
  const s = 1 / det;
  return [
    (e * i - f * h) * s,
    (c * h - b * i) * s,
    (b * f - c * e) * s,
    (f * g - d * i) * s,
    (a * i - c * g) * s,
    (c * d - a * f) * s,
    (d * h - e * g) * s,
    (b * g - a * h) * s,
    (a * e - b * d) * s,
  ];
}

export function transform(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function xyToXyz([x, y]: readonly [number, number]): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/** Linear RGB → CIE XYZ (white Y = 1) for a set of primaries. */
export function rgbToXyzMatrix(p: Primaries): Mat3 {
  const r = xyToXyz(p.r);
  const g = xyToXyz(p.g);
  const b = xyToXyz(p.b);
  const unscaled: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  // scale each primary so that RGB (1,1,1) lands on the white point
  const [sr, sg, sb] = transform(invert(unscaled), xyToXyz(p.white));
  return [
    r[0] * sr,
    g[0] * sg,
    b[0] * sb,
    r[1] * sr,
    g[1] * sg,
    b[1] * sb,
    r[2] * sr,
    g[2] * sg,
    b[2] * sb,
  ];
}

/** Linear RGB → linear RGB between two sets of primaries sharing a white point. */
export function primariesConversionMatrix(from: Primaries, to: Primaries): Mat3 {
  return multiply(invert(rgbToXyzMatrix(to)), rgbToXyzMatrix(from));
}

export const SRGB_TO_BT2020 = primariesConversionMatrix(SRGB_PRIMARIES, BT2020_PRIMARIES);
export const BT2020_TO_SRGB = invert(SRGB_TO_BT2020);
export const DISPLAY_P3_TO_BT2020 = primariesConversionMatrix(
  DISPLAY_P3_PRIMARIES,
  BT2020_PRIMARIES,
);
export const BT2020_TO_DISPLAY_P3 = invert(DISPLAY_P3_TO_BT2020);
