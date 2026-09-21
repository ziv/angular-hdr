import { Zlib } from 'fflate';
import type { LightLevels } from '../color/convert';
import { serializeChunks, type PngChunk } from './chunks';
import {
  CICP_REC2100_PQ,
  cicpChunk,
  clliChunk,
  iccpChunk,
  mdcvChunk,
  type IccProfile,
  type MasteringDisplay,
} from './color-chunks';

export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface PngLayout {
  width: number;
  height: number;
  channels: 3 | 4;
  depth: 8 | 16;
  /** zlib level for the pixel data. */
  compressionLevel?: CompressionLevel;
  /** `none` skips the per-row filter search; together with level 0 that makes encoding little more than a copy. */
  filter?: 'adaptive' | 'none';
}

export interface Pq16Image {
  width: number;
  height: number;
  channels: 3 | 4;
  /** PQ encoded BT.2020 samples, `width * height * channels` long. */
  data: Uint16Array;
}

export interface HdrColorOptions {
  /** The rec2100-pq ICC profile to embed. */
  profile: IccProfile;
  lightLevels?: LightLevels;
  masteringDisplay?: MasteringDisplay;
}

export interface HdrPngOptions
  extends HdrColorOptions, Pick<PngLayout, 'compressionLevel' | 'filter'> {}

const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const FILTER_COUNT = 5;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Streaming truecolor PNG encoder: rows are pushed in bands, so a large image never has to exist
 * as one filtered buffer. Each row uses whichever of the five filters gives the smallest sum of
 * absolute residuals, the heuristic recommended by the PNG spec. (fast-png writes unfiltered rows,
 * which compress far worse for photographic 16-bit data, and cannot write `iCCP`.)
 */
export class PngEncoder {
  private readonly layout: PngLayout;
  private readonly bytesPerPixel: number;
  private readonly rowBytes: number;
  private readonly zlib: Zlib;
  private readonly idat: PngChunk[] = [];
  // one candidate row per filter type, indexed by the PNG filter type byte
  private readonly candidates: Uint8Array[];
  private readonly sums = new Float64Array(FILTER_COUNT);
  private previous: Uint8Array;
  private current: Uint8Array;
  private rowsWritten = 0;

  constructor(layout: PngLayout) {
    this.layout = layout;
    this.bytesPerPixel = (layout.channels * layout.depth) / 8;
    this.rowBytes = layout.width * this.bytesPerPixel;
    this.candidates = Array.from({ length: FILTER_COUNT }, () => new Uint8Array(this.rowBytes));
    this.previous = new Uint8Array(this.rowBytes);
    this.current = new Uint8Array(this.rowBytes);
    this.zlib = new Zlib({ level: layout.compressionLevel ?? 6 });
    // every piece of compressed output becomes its own IDAT chunk, so it is never concatenated twice
    this.zlib.ondata = (chunk) => {
      if (chunk.length) this.idat.push({ type: 'IDAT', data: chunk });
    };
  }

  /** Appends whole rows; `samples` holds `rows * width * channels` values at the encoder's bit depth. */
  writeRows(samples: Uint8Array | Uint8ClampedArray | Uint16Array) {
    const { width, height, channels, depth, filter } = this.layout;
    const samplesPerRow = width * channels;
    const rows = samples.length / samplesPerRow;
    if (
      !Number.isInteger(rows) ||
      this.rowsWritten + rows > height ||
      (depth === 16) !== samples instanceof Uint16Array
    ) {
      throw new Error('Pixel data does not match the image dimensions');
    }
    const { rowBytes, bytesPerPixel, candidates, sums } = this;
    const [none, sub, up, average, paethRow] = candidates;
    const cost = (byte: number) => (byte < 128 ? byte : 256 - byte);
    const filtered = new Uint8Array(rows * (rowBytes + 1));

    for (let y = 0; y < rows; y++) {
      const current = this.current;
      const previous = this.previous;
      const rowStart = y * samplesPerRow;
      if (depth === 16) {
        for (let s = 0, i = 0; s < samplesPerRow; s++) {
          const value = samples[rowStart + s];
          current[i++] = value >> 8;
          current[i++] = value & 0xff;
        }
      } else {
        current.set(samples.subarray(rowStart, rowStart + samplesPerRow));
      }

      if (filter === 'none') {
        // the filter type byte stays 0 and no later row will look at this one
        filtered.set(current, y * (rowBytes + 1) + 1);
        continue;
      }

      sums.fill(0);
      for (let i = 0; i < rowBytes; i++) {
        const x = current[i];
        const a = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
        const b = previous[i];
        const c = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
        sums[0] += cost((none[i] = x));
        sums[1] += cost((sub[i] = (x - a) & 0xff));
        sums[2] += cost((up[i] = (x - b) & 0xff));
        sums[3] += cost((average[i] = (x - ((a + b) >> 1)) & 0xff));
        sums[4] += cost((paethRow[i] = (x - paeth(a, b, c)) & 0xff));
      }

      let best = 0;
      for (let f = 1; f < FILTER_COUNT; f++) if (sums[f] < sums[best]) best = f;
      const offset = y * (rowBytes + 1);
      filtered[offset] = best;
      filtered.set(candidates[best], offset + 1);
      this.previous = current;
      this.current = previous;
    }
    this.rowsWritten += rows;
    this.zlib.push(filtered, this.rowsWritten === height);
  }

  /** Assembles the file. `colorChunks` are placed between IHDR and IDAT, as the PNG spec requires. */
  finish(colorChunks: PngChunk[]): Uint8Array<ArrayBuffer> {
    const { width, height, channels, depth } = this.layout;
    if (this.rowsWritten !== height)
      throw new Error('Pixel data does not match the image dimensions');
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = depth;
    ihdr[9] = channels === 4 ? COLOR_TYPE_RGBA : COLOR_TYPE_RGB;
    // compression method, filter method and interlace method stay 0
    return serializeChunks([
      { type: 'IHDR', data: ihdr },
      ...colorChunks,
      ...this.idat,
      { type: 'IEND', data: new Uint8Array() },
    ]);
  }
}

/** `cICP` + optional HDR metadata + the embedded ICC profile of a Rec.2100 PQ file. */
export function hdrColorChunks({
  profile,
  lightLevels,
  masteringDisplay,
}: HdrColorOptions): PngChunk[] {
  const chunks = [cicpChunk(CICP_REC2100_PQ)];
  if (masteringDisplay) chunks.push(mdcvChunk(masteringDisplay));
  if (lightLevels) chunks.push(clliChunk(lightLevels));
  chunks.push(iccpChunk(profile));
  return chunks;
}

/** Encodes a 16-bit Rec.2100 PQ PNG tagged with both `cICP` and the embedded ICC profile. */
export function encodeHdrPng(image: Pq16Image, options: HdrPngOptions): Uint8Array<ArrayBuffer> {
  const { width, height, channels, data } = image;
  const encoder = new PngEncoder({
    width,
    height,
    channels,
    depth: 16,
    compressionLevel: options.compressionLevel,
    filter: options.filter,
  });
  encoder.writeRows(data);
  return encoder.finish(hdrColorChunks(options));
}
