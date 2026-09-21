import { BT2020_PRIMARIES, rgbToXyzMatrix } from './matrices';

const [, , , LUMA_R, LUMA_G, LUMA_B] = rgbToXyzMatrix(BT2020_PRIMARIES);

export const HISTOGRAM_BINS = 160;
export const HISTOGRAM_MIN_NITS = 0.1;
export const HISTOGRAM_MAX_NITS = 10000;

/** Luminance (CIE Y) in nits of a linear BT.2020 color. */
export function luminance(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** Position of a luminance on the histogram's logarithmic axis, in [0..1]. */
export function histogramPosition(nits: number): number {
  const position =
    Math.log10(nits / HISTOGRAM_MIN_NITS) / Math.log10(HISTOGRAM_MAX_NITS / HISTOGRAM_MIN_NITS);
  return Math.min(Math.max(position, 0), 1);
}

/** Pixel counts per luminance bin on a log scale; anything darker than the axis lands in the first bin. */
export function luminanceHistogram(linear: Float32Array): Uint32Array {
  const bins = new Uint32Array(HISTOGRAM_BINS);
  const scale = HISTOGRAM_BINS / Math.log(HISTOGRAM_MAX_NITS / HISTOGRAM_MIN_NITS);
  for (let i = 0; i < linear.length; i += 4) {
    const y = luminance(linear[i], linear[i + 1], linear[i + 2]);
    const bin =
      y > HISTOGRAM_MIN_NITS
        ? Math.min(Math.floor(Math.log(y / HISTOGRAM_MIN_NITS) * scale), HISTOGRAM_BINS - 1)
        : 0;
    bins[bin]++;
  }
  return bins;
}
