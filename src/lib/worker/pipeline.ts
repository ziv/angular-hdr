import { applyAdjustments } from '../color/adjust';
import { luminanceHistogram } from '../color/analyze';
import { computeLightLevels } from '../color/convert';
import { downscaleToFit } from '../color/resize';
import { SDR_WHITE_NITS } from '../color/transfer';
import { exportHdrPng, exportImage, PREVIEW_ENCODING, type ExportFormat } from '../io/export';
import { loadImage } from '../io/load';
import type { ProfileLoader } from '../io/profiles';
import type { ImageF32 } from '../types';
import type { ExportedFile, InspectResult, LoadResult, RenderResult, Source } from './protocol';

// downscaling is by whole factors, so previews end up between half of this and this
export const PREVIEW_MAX_SIDE = 2048;

interface StoredFile {
  full: ImageF32;
  /** Downscaled copy that keeps the adjustment sliders responsive; exports use the full image. */
  preview: ImageF32;
}

/** The images of the latest render, kept for the pixel inspector. */
interface LastRender {
  original: ImageF32;
  hdr: ImageF32;
}

/** The image pipeline behind the UI. It owns the pixels of every loaded file and normally lives in a worker. */
export class Pipeline {
  private readonly files = new Map<number, StoredFile>();
  private readonly loadProfile: ProfileLoader;
  private lastRender: LastRender | undefined;

  constructor(loadProfile: ProfileLoader) {
    this.loadProfile = loadProfile;
  }

  async load(id: number, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<LoadResult> {
    const { image, ...meta } = await loadImage(bytes, name);
    const preview = downscaleToFit(image, PREVIEW_MAX_SIDE);
    this.files.set(id, { full: image, preview });
    return { meta, sourceLevels: computeLightLevels(preview.data) };
  }

  remove(id: number) {
    this.files.delete(id);
  }

  private file(id: number): StoredFile {
    const file = this.files.get(id);
    if (!file) throw new Error('This file is no longer loaded');
    return file;
  }

  async render(source: Source): Promise<RenderResult> {
    const profile = await this.loadProfile('hdr');
    const started = performance.now();
    const { full, preview } = this.file(source.id);
    const { image, clippedPixels } = applyAdjustments(preview, source.adjustments);

    const hdr = exportHdrPng(image, profile, PREVIEW_ENCODING);
    this.lastRender = { original: preview, hdr: image };
    return {
      hdrPng: hdr.bytes,
      width: image.width,
      height: image.height,
      fullWidth: full.width,
      fullHeight: full.height,
      lightLevels: hdr.lightLevels,
      clippedFraction: clippedPixels / (image.width * image.height),
      histogram: luminanceHistogram(image.data),
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  /** Reads one pixel of the last render from both images the UI shows. */
  inspect(x: number, y: number): InspectResult | undefined {
    const last = this.lastRender;
    if (!last || x < 0 || y < 0 || x >= last.hdr.width || y >= last.hdr.height) return undefined;
    const pixel = y * last.hdr.width + x;
    const rgb = (data: Float32Array): [number, number, number] => [
      data[pixel * 4],
      data[pixel * 4 + 1],
      data[pixel * 4 + 2],
    ];
    return {
      original: rgb(last.original.data),
      hdr: rgb(last.hdr.data),
    };
  }

  async export(
    source: Source,
    format: ExportFormat,
    onProgress?: (fraction: number) => void | Promise<void>,
  ): Promise<ExportedFile> {
    const profile = await this.loadProfile(format);
    const { bytes, lightLevels } = await exportImage({
      source: this.file(source.id).full,
      adjustments: source.adjustments,
      format,
      profile,
      onProgress,
    });
    return { bytes, lightLevels };
  }
}
