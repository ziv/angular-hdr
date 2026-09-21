import { decode, type BitDepth, type PngDataArray } from 'fast-png';
import type { LightLevels } from '../color/convert';
import { parseChunks } from './chunks';
import { readCicp, readClli, readIccp, type Cicp, type IccProfile } from './color-chunks';

export interface DecodedPng {
  width: number;
  height: number;
  depth: BitDepth;
  channels: number;
  /** Palette based image: `data` holds palette indices rather than samples. */
  indexed: boolean;
  /** Samples at the file's native bit depth; 16-bit data is a host-endian Uint16Array. */
  data: PngDataArray;
  cicp?: Cicp;
  icc?: IccProfile;
  lightLevels?: LightLevels;
}

/** Decodes a PNG at full bit depth together with its color space chunks. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const chunks = parseChunks(bytes);
  const { width, height, depth, channels, data, palette } = decode(bytes);
  return {
    width,
    height,
    depth,
    channels,
    indexed: palette !== undefined,
    data,
    cicp: readCicp(chunks),
    icc: readIccp(chunks),
    lightLevels: readClli(chunks),
  };
}
