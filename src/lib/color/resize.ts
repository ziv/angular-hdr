import type { ImageF32 } from '../types';

/**
 * Shrinks an image by a whole factor so that its longer side is at most `maxSide`,
 * averaging blocks of pixels in linear light. Returns the source itself when it already fits.
 */
export function downscaleToFit(source: ImageF32, maxSide: number): ImageF32 {
  const factor = Math.ceil(Math.max(source.width, source.height) / maxSide);
  if (factor <= 1) return source;
  const width = Math.ceil(source.width / factor);
  const height = Math.ceil(source.height / factor);
  const data = new Float32Array(width * height * 4);
  const sums = new Float64Array(4);

  for (let y = 0; y < height; y++) {
    const y0 = y * factor;
    const y1 = Math.min(y0 + factor, source.height);
    for (let x = 0; x < width; x++) {
      const x0 = x * factor;
      const x1 = Math.min(x0 + factor, source.width);
      sums.fill(0);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0, i = (sy * source.width + x0) * 4; sx < x1; sx++, i += 4) {
          sums[0] += source.data[i];
          sums[1] += source.data[i + 1];
          sums[2] += source.data[i + 2];
          sums[3] += source.data[i + 3];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      data[o] = sums[0] / count;
      data[o + 1] = sums[1] / count;
      data[o + 2] = sums[2] / count;
      data[o + 3] = sums[3] / count;
    }
  }
  return { width, height, data };
}
