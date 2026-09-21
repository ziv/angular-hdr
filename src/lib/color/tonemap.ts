import { nitsToPqCode } from './convert';
import { BT2020_PRIMARIES, BT2020_TO_SRGB, rgbToXyzMatrix } from './matrices';
import { linearToSrgb, pqDecode, pqEncode } from './transfer';

export interface SdrToneMapOptions {
  /** Luminance that becomes SDR white, i.e. sRGB (255, 255, 255). */
  whiteNits: number;
  /** Brightest sRGB channel in the source (see `srgbPeakNits`); everything between the knee and this is rolled off into SDR. */
  sourcePeakNits: number;
}

const CURVE_LUT_SIZE = 4096;
const SRGB_LUT_SIZE = 4096;

const [, , , LUMA_R, LUMA_G, LUMA_B] = rgbToXyzMatrix(BT2020_PRIMARIES);

/**
 * ITU-R BT.2390 EETF without black lift: a Hermite roll-off in the PQ domain that maps
 * `sourcePeakNits` to `whiteNits` and leaves everything below the knee untouched.
 */
export function bt2390ToneMap(
  nits: number,
  { whiteNits, sourcePeakNits }: SdrToneMapOptions,
): number {
  if (sourcePeakNits <= whiteNits) return Math.min(nits, whiteNits);
  const sourcePeak = pqEncode(sourcePeakNits);
  const maxLum = pqEncode(whiteNits) / sourcePeak;
  const kneeStart = 1.5 * maxLum - 0.5;
  const e = Math.min(pqEncode(nits) / sourcePeak, 1);
  if (e <= kneeStart) return nits;
  const t = (e - kneeStart) / (1 - kneeStart);
  const t2 = t * t;
  const t3 = t2 * t;
  const rolled =
    (2 * t3 - 3 * t2 + 1) * kneeStart +
    (t3 - 2 * t2 + t) * (1 - kneeStart) +
    (-2 * t3 + 3 * t2) * maxLum;
  return pqDecode(rolled * sourcePeak);
}

/**
 * Linear BT.2020 → linear sRGB, both in nits. Colors outside the sRGB gamut come out with negative
 * channels; those are desaturated toward their own luminance until they fit.
 */
function toSrgbNits(r: number, g: number, b: number, out: Float64Array) {
  const m = BT2020_TO_SRGB;
  let sr = m[0] * r + m[1] * g + m[2] * b;
  let sg = m[3] * r + m[4] * g + m[5] * b;
  let sb = m[6] * r + m[7] * g + m[8] * b;
  const min = Math.min(sr, sg, sb);
  if (min < 0) {
    const luminance = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    const keep = luminance > 0 ? luminance / (luminance - min) : 0;
    sr = luminance + (sr - luminance) * keep;
    sg = luminance + (sg - luminance) * keep;
    sb = luminance + (sb - luminance) * keep;
  }
  out[0] = sr;
  out[1] = sg;
  out[2] = sb;
}

/**
 * Brightest sRGB channel of an RGBA linear BT.2020 image, in nits: the `sourcePeakNits` to tone map with.
 * It can exceed MaxCLL, because a saturated sRGB color needs less signal in the wider BT.2020 container.
 */
export function srgbPeakNits(linear: Float32Array): number {
  const srgb = new Float64Array(3);
  let peak = 0;
  for (let i = 0; i < linear.length; i += 4) {
    toSrgbNits(
      Math.max(linear[i], 0),
      Math.max(linear[i + 1], 0),
      Math.max(linear[i + 2], 0),
      srgb,
    );
    peak = Math.max(peak, srgb[0], srgb[1], srgb[2]);
  }
  return peak;
}

/**
 * RGBA linear BT.2020 in nits → 8-bit sRGB with the requested channel count.
 * The tone curve runs on the brightest sRGB channel: that keeps the hue of bright saturated colors
 * and guarantees that nothing is left above white for the 8-bit encoding to clip.
 */
export function toneMapToSrgb8(
  linear: Float32Array,
  channels: 3 | 4,
  options: SdrToneMapOptions,
): Uint8Array {
  const { whiteNits, sourcePeakNits } = options;
  // float32 rounding can put an SDR source a hair above white, which is no reason to bend its highlights
  const needsCurve = sourcePeakNits > whiteNits * 1.001;
  // tone curve sampled uniformly in PQ, which nitsToPqCode reaches without any Math.pow
  const curve = new Float64Array(CURVE_LUT_SIZE + 2);
  if (needsCurve) {
    for (let i = 0; i < curve.length; i++)
      curve[i] = bt2390ToneMap(pqDecode(Math.min(i / CURVE_LUT_SIZE, 1)), options);
  }
  // sRGB encoding sampled uniformly in sqrt(linear), where the curve is close to a straight line
  const encode = new Float64Array(SRGB_LUT_SIZE + 2);
  for (let i = 0; i < encode.length; i++)
    encode[i] = linearToSrgb(Math.pow(Math.min(i / SRGB_LUT_SIZE, 1), 2)) * 255;

  const toSrgb8 = (value: number) => {
    if (!(value > 0)) return 0;
    if (value >= 1) return 255;
    const position = Math.sqrt(value) * SRGB_LUT_SIZE;
    const index = Math.floor(position);
    return Math.round(encode[index] + (encode[index + 1] - encode[index]) * (position - index));
  };

  const srgb = new Float64Array(3);
  const pixelCount = linear.length / 4;
  const out = new Uint8Array(pixelCount * channels);
  for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += 4, d += channels) {
    toSrgbNits(
      Math.max(linear[s], 0),
      Math.max(linear[s + 1], 0),
      Math.max(linear[s + 2], 0),
      srgb,
    );
    let scale = 1 / whiteNits;
    const max = Math.max(srgb[0], srgb[1], srgb[2]);
    if (needsCurve && max > 0) {
      const position = (nitsToPqCode(max) / 65535) * CURVE_LUT_SIZE;
      const index = Math.floor(position);
      scale *= (curve[index] + (curve[index + 1] - curve[index]) * (position - index)) / max;
    }
    out[d] = toSrgb8(srgb[0] * scale);
    out[d + 1] = toSrgb8(srgb[1] * scale);
    out[d + 2] = toSrgb8(srgb[2] * scale);
    if (channels === 4) out[d + 3] = Math.round(Math.min(Math.max(linear[s + 3], 0), 1) * 255);
  }
  return out;
}
