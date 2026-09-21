import { applyAdjustments } from '../color/adjust';
import { luminanceHistogram } from '../color/analyze';
import { computeLightLevels } from '../color/convert';
import { downscaleToFit } from '../color/resize';
import { SDR_WHITE_NITS } from '../color/transfer';
import { generatePattern } from '../generate/patterns';
import {
  exportHdrPng,
  exportImage,
  exportSdrPng,
  PREVIEW_ENCODING,
  type ExportFormat,
} from '../io/export';
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
  original?: ImageF32;
  hdr: ImageF32;
  sdr: Uint8Array;
  sdrChannels: 3 | 4;
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
    const [hdrProfile, sdrProfile] = await Promise.all([
      this.loadProfile('hdr'),
      this.loadProfile('sdr'),
    ]);
    const started = performance.now();
    let original: ImageF32 | undefined;
    let image: ImageF32;
    let fullWidth: number;
    let fullHeight: number;
    let whiteNits = SDR_WHITE_NITS;
    let clippedPixels = 0;

    if (source.kind === 'pattern') {
      const full = generatePattern(source.spec, source.width, source.height);
      image = downscaleToFit(full, PREVIEW_MAX_SIDE);
      fullWidth = full.width;
      fullHeight = full.height;
    } else {
      const { full, preview } = this.file(source.id);
      const adjusted = applyAdjustments(preview, source.adjustments);
      original = preview;
      image = adjusted.image;
      clippedPixels = adjusted.clippedPixels;
      whiteNits = source.adjustments.whiteNits;
      fullWidth = full.width;
      fullHeight = full.height;
    }

    const hdr = exportHdrPng(image, hdrProfile, PREVIEW_ENCODING);
    const sdr = exportSdrPng(image, sdrProfile, whiteNits, PREVIEW_ENCODING);
    this.lastRender = { original, hdr: image, sdr: sdr.pixels, sdrChannels: sdr.channels };
    return {
      hdrPng: hdr.bytes,
      sdrPng: sdr.bytes,
      width: image.width,
      height: image.height,
      fullWidth,
      fullHeight,
      lightLevels: hdr.lightLevels,
      clippedFraction: clippedPixels / (image.width * image.height),
      histogram: luminanceHistogram(image.data),
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  /** Reads one pixel of the last render from each of the images the UI shows. */
  inspect(x: number, y: number): InspectResult | undefined {
    const last = this.lastRender;
    if (!last || x < 0 || y < 0 || x >= last.hdr.width || y >= last.hdr.height) return undefined;
    const pixel = y * last.hdr.width + x;
    const rgb = (data: ArrayLike<number>, channels: number): [number, number, number] => [
      data[pixel * channels],
      data[pixel * channels + 1],
      data[pixel * channels + 2],
    ];
    return {
      original: last.original && rgb(last.original.data, 4),
      hdr: rgb(last.hdr.data, 4),
      sdr: rgb(last.sdr, last.sdrChannels),
    };
  }

  async export(
    source: Source,
    format: ExportFormat,
    onProgress?: (fraction: number) => void | Promise<void>,
  ): Promise<ExportedFile> {
    const profile = await this.loadProfile(format);
    const request =
      source.kind === 'pattern'
        ? { source: generatePattern(source.spec, source.width, source.height) }
        : { source: this.file(source.id).full, adjustments: source.adjustments };
    const { bytes, lightLevels } = await exportImage({ ...request, format, profile, onProgress });
    return { bytes, lightLevels };
  }
}
