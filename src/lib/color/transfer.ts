/** Peak luminance of the PQ signal range, in cd/m² (nits). */
export const PQ_MAX_NITS = 10000;

/** SDR reference white inside an HDR container, ITU-R BT.2408. */
export const SDR_WHITE_NITS = 203;

// SMPTE ST 2084 constants
const M1 = 2610 / 16384;
const M2 = (2523 / 4096) * 128;
const C1 = 3424 / 4096;
const C2 = (2413 / 4096) * 32;
const C3 = (2392 / 4096) * 32;

/** sRGB EOTF: encoded [0..1] → linear [0..1]. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB EOTF: linear [0..1] → encoded [0..1]. */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Inverse PQ EOTF: absolute luminance in nits → PQ signal [0..1]. */
export function pqEncode(nits: number): number {
  const y = Math.min(Math.max(nits / PQ_MAX_NITS, 0), 1);
  const p = Math.pow(y, M1);
  return Math.pow((C1 + C2 * p) / (1 + C3 * p), M2);
}

/** PQ EOTF: PQ signal [0..1] → absolute luminance in nits. */
export function pqDecode(v: number): number {
  const p = Math.pow(Math.min(Math.max(v, 0), 1), 1 / M2);
  return PQ_MAX_NITS * Math.pow(Math.max(p - C1, 0) / (C2 - C3 * p), 1 / M1);
}
