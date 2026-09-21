import type { Adjustments } from '../color/adjust';
import type { LightLevels } from '../color/convert';
import type { ExportFormat } from '../io/export';
import type { LoadedImage } from '../io/load';

/** What the UI knows about a loaded file; the pixels stay inside the worker. */
export type FileMeta = Omit<LoadedImage, 'image'>;

/** What to render or export: a loaded file, by the id it was loaded under, and the adjustments to apply to it. */
export interface Source {
  id: number;
  adjustments: Adjustments;
}

export type PipelineRequest =
  /** Must be the first message: the document's base URI, which the worker needs to find the color profiles. */
  | { type: 'init'; baseUrl: string }
  | { type: 'load'; id: number; name: string; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'remove'; id: number }
  | { type: 'render'; source: Source }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'export'; source: Source; format: ExportFormat }
  | { type: 'cancel'; target: number };

export interface LoadResult {
  meta: FileMeta;
  /** Light levels of the unadjusted source. */
  sourceLevels: LightLevels;
}

export interface RenderResult {
  /** The preview as a 16-bit Rec.2100 PQ PNG with rec2100-pq.icc, ready for an `<img>`. */
  hdrPng: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  lightLevels: LightLevels;
  /** Share of the pixels that hit the peak clamp, in [0..1]. */
  clippedFraction: number;
  histogram: Uint32Array;
  elapsedMs: number;
}

/** One pixel of the last render, as it is in both images on screen. */
export interface InspectResult {
  /** The unadjusted source in linear BT.2020 nits. */
  original: [number, number, number];
  /** The HDR output in linear BT.2020 nits. */
  hdr: [number, number, number];
}

export interface ExportedFile {
  bytes: Uint8Array<ArrayBuffer>;
  lightLevels: LightLevels;
}

export interface RequestEnvelope {
  requestId: number;
  request: PipelineRequest;
}

export type ResponseEnvelope =
  | { requestId: number; kind: 'result'; result: unknown }
  | { requestId: number; kind: 'progress'; fraction: number }
  | { requestId: number; kind: 'error'; message: string; cancelled: boolean };
