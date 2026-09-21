import { applyAdjustments, type Adjustments } from '../color/adjust';
import {
  computeLightLevels,
  hasTransparency,
  linearToPq16,
  type LightLevels,
} from '../color/convert';
import { srgbPeakNits, toneMapToSrgb8 } from '../color/tonemap';
import { SDR_WHITE_NITS } from '../color/transfer';
import { iccpChunk, type IccProfile } from '../png/color-chunks';
import {
  encodeHdrPng,
  hdrColorChunks,
  PngEncoder,
  type CompressionLevel,
  type PngLayout,
} from '../png/encode';
import type { ImageF32 } from '../types';

export type ExportFormat = 'hdr' | 'sdr';

export interface HdrPngExport {
  bytes: Uint8Array<ArrayBuffer>;
  lightLevels: LightLevels;
}

export interface ExportRequest {
  source: ImageF32;
  /** Left out for generated patterns, which are exported exactly as they are. */
  adjustments?: Adjustments;
  format: ExportFormat;
  /** rec2100-pq.icc for `hdr`, sRGB-v4.icc for `sdr`. */
  profile: IccProfile;
  compressionLevel?: CompressionLevel;
  /**
   * Called after every band of rows with overall progress in [0..1]. May return a promise, which is
   * awaited: that is where a worker yields to its event loop, and throwing from here cancels the export.
   */
  onProgress?: (fraction: number) => void | Promise<void>;
}

export interface ExportResult extends HdrPngExport {
  clippedPixels: number;
}

// pixels per band: bounds the transient memory of an export to a few tens of megabytes, whatever the image size
const BAND_PIXELS = 1 << 20;
// share of the progress bar given to the measuring pass, which is much cheaper than encoding
const MEASURE_SHARE = 0.1;

/** Encoder settings for previews: the file never leaves the page, so its size does not matter and speed does. */
export const PREVIEW_ENCODING: Pick<PngLayout, 'compressionLevel' | 'filter'> = {
  compressionLevel: 0,
  filter: 'none',
};

/** Working image → 16-bit Rec.2100 PQ PNG in one go; meant for previews and small images. */
export function exportHdrPng(
  image: ImageF32,
  profile: IccProfile,
  encoding: Pick<PngLayout, 'compressionLevel' | 'filter'> = {},
): HdrPngExport {
  const channels = hasTransparency(image.data) ? 4 : 3;
  const lightLevels = computeLightLevels(image.data);
  const bytes = encodeHdrPng(
    {
      width: image.width,
      height: image.height,
      channels,
      data: linearToPq16(image.data, channels),
    },
    { profile, lightLevels, ...encoding },
  );
  return { bytes, lightLevels };
}

export interface SdrPngExport {
  bytes: Uint8Array<ArrayBuffer>;
  /** The tone mapped 8-bit sRGB samples that were encoded. */
  pixels: Uint8Array;
  channels: 3 | 4;
}

/** Working image → tone mapped 8-bit sRGB PNG in one go; the SDR counterpart of `exportHdrPng`. */
export function exportSdrPng(
  image: ImageF32,
  profile: IccProfile,
  whiteNits: number,
  encoding: Pick<PngLayout, 'compressionLevel' | 'filter'> = {},
): SdrPngExport {
  const channels = hasTransparency(image.data) ? 4 : 3;
  const pixels = toneMapToSrgb8(image.data, channels, {
    whiteNits,
    sourcePeakNits: srgbPeakNits(image.data),
  });
  const encoder = new PngEncoder({
    width: image.width,
    height: image.height,
    channels,
    depth: 8,
    ...encoding,
  });
  encoder.writeRows(pixels);
  return { bytes: encoder.finish([iccpChunk(profile)]), pixels, channels };
}

/**
 * Full resolution export. The image is adjusted and encoded band by band, so besides the source
 * only one band is alive at any time. A first pass measures the light levels, which the
 * HDR metadata (and the SDR tone curve) need before the first pixel is written.
 */
export async function exportImage(request: ExportRequest): Promise<ExportResult> {
  const { source, adjustments, format, profile, compressionLevel, onProgress } = request;
  const { width, height } = source;
  const bandRows = Math.max(1, Math.floor(BAND_PIXELS / width));
  const channels = hasTransparency(source.data) ? 4 : 3;

  function* bands() {
    for (let y = 0; y < height; y += bandRows) {
      const rows = Math.min(bandRows, height - y);
      const band: ImageF32 = {
        width,
        height: rows,
        data: source.data.subarray(y * width * 4, (y + rows) * width * 4),
      };
      const adjusted = adjustments
        ? applyAdjustments(band, adjustments)
        : { image: band, clippedPixels: 0 };
      yield { ...adjusted, rowsDone: y + rows };
    }
  }

  let maxCll = 0;
  let srgbPeak = 0;
  let lightSum = 0;
  let clippedPixels = 0;
  for (const band of bands()) {
    const levels = computeLightLevels(band.image.data);
    maxCll = Math.max(maxCll, levels.maxCll);
    lightSum += levels.maxFall * band.image.width * band.image.height;
    clippedPixels += band.clippedPixels;
    if (format === 'sdr') srgbPeak = Math.max(srgbPeak, srgbPeakNits(band.image.data));
    await onProgress?.((band.rowsDone / height) * MEASURE_SHARE);
  }
  const lightLevels = { maxCll, maxFall: lightSum / (width * height) };

  const encoder = new PngEncoder({
    width,
    height,
    channels,
    depth: format === 'hdr' ? 16 : 8,
    compressionLevel,
  });
  const whiteNits = adjustments?.whiteNits ?? SDR_WHITE_NITS;
  for (const band of bands()) {
    encoder.writeRows(
      format === 'hdr'
        ? linearToPq16(band.image.data, channels)
        : toneMapToSrgb8(band.image.data, channels, { whiteNits, sourcePeakNits: srgbPeak }),
    );
    await onProgress?.(MEASURE_SHARE + (band.rowsDone / height) * (1 - MEASURE_SHARE));
  }
  const bytes = encoder.finish(
    format === 'hdr' ? hdrColorChunks({ profile, lightLevels }) : [iccpChunk(profile)],
  );
  return { bytes, lightLevels, clippedPixels };
}
