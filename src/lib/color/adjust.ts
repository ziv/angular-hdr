import type { ImageF32 } from '../types';
import { BT2020_PRIMARIES, BT2020_TO_SRGB, rgbToXyzMatrix } from './matrices';
import { SDR_WHITE_NITS, srgbToLinear } from './transfer';

export interface Adjustments {
  /** Luminance that the source's reference white (203 nits) is moved to. */
  whiteNits: number;
  /** Exposure compensation in stops, applied in linear light. */
  exposureStops: number;
  /** Expand highlights above the knee up to `peakNits`, leaving everything below untouched. */
  boost: boolean;
  /** Where the highlight expansion starts, as a linear fraction of white in (0..1). */
  boostKnee: number;
  /** Target of the highlight boost and the limit that every pixel is clamped to. */
  peakNits: number;
  /** 0 keeps the source colors, 1 reinterprets sRGB coordinates as BT.2020 (maximum saturation). */
  gamutExpansion: number;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  whiteNits: SDR_WHITE_NITS,
  exposureStops: 0,
  boost: false,
  // 75% of the encoded sRGB signal
  boostKnee: srgbToLinear(0.75),
  peakNits: 1000,
  gamutExpansion: 0,
};

export interface AdjustResult {
  image: ImageF32;
  /** Pixels that exceeded `peakNits` and were scaled back to it. */
  clippedPixels: number;
}

// how quickly the boost ramps up above the knee; 2 keeps the slope continuous at the knee
const BOOST_POWER = 2;

const [, , , LUMA_R, LUMA_G, LUMA_B] = rgbToXyzMatrix(BT2020_PRIMARIES);

/**
 * Inverse tone mapping gain for a pixel whose brightest channel is `t` (1 = white).
 * Below the knee the gain is 1; above it the signal is expanded so that white lands on `peak` (in units of white).
 */
export function boostGain(t: number, knee: number, peak: number): number {
  if (t <= knee || peak <= 1) return 1;
  const u = (t - knee) / (1 - knee);
  return (t + (peak - 1) * Math.pow(u, BOOST_POWER)) / t;
}

/** Applies the adjustments to an RGBA linear BT.2020 image in nits and returns a new image. */
export function applyAdjustments(source: ImageF32, adjustments: Adjustments): AdjustResult {
  const { whiteNits, exposureStops, boost, boostKnee, peakNits, gamutExpansion } = adjustments;
  const gain = (whiteNits / SDR_WHITE_NITS) * Math.pow(2, exposureStops);
  const peakRatio = peakNits / whiteNits;
  const m = BT2020_TO_SRGB;
  const input = source.data;
  const out = new Float32Array(input.length);
  let clippedPixels = 0;

  for (let i = 0; i < input.length; i += 4) {
    let r = Math.max(input[i], 0) * gain;
    let g = Math.max(input[i + 1], 0) * gain;
    let b = Math.max(input[i + 2], 0) * gain;

    if (boost) {
      const scale = boostGain(Math.max(r, g, b) / whiteNits, boostKnee, peakRatio);
      r *= scale;
      g *= scale;
      b *= scale;
    }

    if (gamutExpansion > 0) {
      const luminance = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      // the pixel's sRGB coordinates, reused as BT.2020 coordinates, are the fully expanded color
      const er = r + gamutExpansion * (Math.max(m[0] * r + m[1] * g + m[2] * b, 0) - r);
      const eg = g + gamutExpansion * (Math.max(m[3] * r + m[4] * g + m[5] * b, 0) - g);
      const eb = b + gamutExpansion * (Math.max(m[6] * r + m[7] * g + m[8] * b, 0) - b);
      const expanded = LUMA_R * er + LUMA_G * eg + LUMA_B * eb;
      const keepLuminance = expanded > 0 ? luminance / expanded : 0;
      r = er * keepLuminance;
      g = eg * keepLuminance;
      b = eb * keepLuminance;
    }

    // clamp to the peak by scaling all channels, which keeps the hue
    const max = Math.max(r, g, b);
    if (max > peakNits) {
      const scale = peakNits / max;
      r *= scale;
      g *= scale;
      b *= scale;
      // float32 rounding can leave values a hair above the peak, that is not a clipped pixel
      if (max > peakNits * 1.0001) clippedPixels++;
    }

    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = input[i + 3];
  }
  return { image: { width: source.width, height: source.height, data: out }, clippedPixels };
}
