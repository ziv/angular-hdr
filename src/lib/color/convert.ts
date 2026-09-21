import type { SdrColorSpace } from '../types';
import { DISPLAY_P3_TO_BT2020, SRGB_TO_BT2020, type Mat3 } from './matrices';
import { PQ_MAX_NITS, pqDecode, pqEncode, SDR_WHITE_NITS, srgbToLinear } from './transfer';

export type SdrPixels = Uint8Array | Uint8ClampedArray | Uint16Array;

export interface SdrToLinearOptions {
  source?: SdrColorSpace;
  /** Luminance that SDR white (1,1,1) is mapped to. */
  whiteNits?: number;
}

const TO_BT2020: Record<SdrColorSpace, Mat3> = {
  srgb: SRGB_TO_BT2020,
  'display-p3': DISPLAY_P3_TO_BT2020,
};

function buildLut(size: number, fn: (v: number) => number): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = fn(i / (size - 1));
  return lut;
}

let pqDecodeLut: Float32Array | undefined;

// PQ encoding through Math.pow costs ~1 s per 2 megapixels. Indexed by (nits / 10000)^(1/8), which only
// takes three square roots, the curve is smooth enough that linear interpolation stays within 0.01 codes.
const PQ_ENCODE_LUT_SIZE = 4096;
let pqEncodeLut: Float64Array | undefined;

function buildPqEncodeLut(): Float64Array {
  const lut = new Float64Array(PQ_ENCODE_LUT_SIZE + 2);
  for (let i = 0; i < lut.length; i++)
    lut[i] = pqEncode(Math.pow(i / PQ_ENCODE_LUT_SIZE, 8) * PQ_MAX_NITS) * 65535;
  return lut;
}

/** Luminance in nits → PQ signal as an unrounded 16-bit code value. */
export function nitsToPqCode(nits: number): number {
  const lut = (pqEncodeLut ??= buildPqEncodeLut());
  const y = nits / PQ_MAX_NITS;
  if (!(y > 0)) return 0;
  if (y >= 1) return 65535;
  const position = Math.sqrt(Math.sqrt(Math.sqrt(y))) * PQ_ENCODE_LUT_SIZE;
  const index = Math.floor(position);
  return lut[index] + (lut[index + 1] - lut[index]) * (position - index);
}

/** Encoded SDR pixels (RGB or RGBA, 8 or 16 bit) → RGBA linear BT.2020 in nits. */
export function sdrToLinear(
  pixels: SdrPixels,
  channels: 3 | 4,
  { source = 'srgb', whiteNits = SDR_WHITE_NITS }: SdrToLinearOptions = {},
): Float32Array {
  const maxValue = pixels instanceof Uint16Array ? 65535 : 255;
  const lut = buildLut(maxValue + 1, (v) => srgbToLinear(v) * whiteNits);
  const m = TO_BT2020[source];
  const pixelCount = pixels.length / channels;
  const out = new Float32Array(pixelCount * 4);
  for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += channels, d += 4) {
    const r = lut[pixels[s]];
    const g = lut[pixels[s + 1]];
    const b = lut[pixels[s + 2]];
    out[d] = m[0] * r + m[1] * g + m[2] * b;
    out[d + 1] = m[3] * r + m[4] * g + m[5] * b;
    out[d + 2] = m[6] * r + m[7] * g + m[8] * b;
    out[d + 3] = channels === 4 ? pixels[s + 3] / maxValue : 1;
  }
  return out;
}

/** 16-bit PQ encoded BT.2020 pixels (RGB or RGBA) → RGBA linear BT.2020 in nits. */
export function pq16ToLinear(pixels: Uint16Array, channels: 3 | 4): Float32Array {
  const lut = (pqDecodeLut ??= buildLut(65536, pqDecode));
  const pixelCount = pixels.length / channels;
  const out = new Float32Array(pixelCount * 4);
  for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += channels, d += 4) {
    out[d] = lut[pixels[s]];
    out[d + 1] = lut[pixels[s + 1]];
    out[d + 2] = lut[pixels[s + 2]];
    out[d + 3] = channels === 4 ? pixels[s + 3] / 65535 : 1;
  }
  return out;
}

/** RGBA linear BT.2020 in nits → 16-bit PQ encoded pixels with the requested channel count. */
export function linearToPq16(linear: Float32Array, channels: 3 | 4): Uint16Array {
  const pixelCount = linear.length / 4;
  const out = new Uint16Array(pixelCount * channels);
  for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += 4, d += channels) {
    out[d] = Math.round(nitsToPqCode(linear[s]));
    out[d + 1] = Math.round(nitsToPqCode(linear[s + 1]));
    out[d + 2] = Math.round(nitsToPqCode(linear[s + 2]));
    if (channels === 4) out[d + 3] = Math.round(Math.min(Math.max(linear[s + 3], 0), 1) * 65535);
  }
  return out;
}

export function hasTransparency(linear: Float32Array): boolean {
  for (let i = 3; i < linear.length; i += 4) if (linear[i] < 1) return true;
  return false;
}

export interface LightLevels {
  /** Maximum content light level: brightest single channel of any pixel, in nits. */
  maxCll: number;
  /** Maximum frame-average light level: mean of each pixel's brightest channel, in nits. */
  maxFall: number;
}

/** MaxCLL / MaxFALL (CTA-861.3) of an RGBA linear image in nits. */
export function computeLightLevels(linear: Float32Array): LightLevels {
  const pixelCount = linear.length / 4;
  let maxCll = 0;
  let sum = 0;
  for (let i = 0; i < linear.length; i += 4) {
    const peak = Math.max(linear[i], linear[i + 1], linear[i + 2], 0);
    if (peak > maxCll) maxCll = peak;
    sum += peak;
  }
  return { maxCll, maxFall: pixelCount ? sum / pixelCount : 0 };
}
