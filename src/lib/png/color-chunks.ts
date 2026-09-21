import { unzlibSync, zlibSync } from 'fflate';
import type { LightLevels } from '../color/convert';
import type { Primaries } from '../color/matrices';
import type { PngChunk } from './chunks';

/** Coding-independent code points (ITU-T H.273), as stored in the PNG `cICP` chunk. */
export interface Cicp {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

/** BT.2020 primaries, PQ transfer, RGB (identity) matrix, full range — matches the `cicp` tag of rec2100-pq.icc. */
export const CICP_REC2100_PQ: Cicp = { primaries: 9, transfer: 16, matrix: 0, fullRange: true };

export interface IccProfile {
  name: string;
  profile: Uint8Array;
}

export interface MasteringDisplay {
  primaries: Primaries;
  maxNits: number;
  minNits: number;
}

// cLLi and mDCv store luminance in units of 0.0001 cd/m², mDCv stores chromaticity in units of 0.00002
const LUMINANCE_UNIT = 10000;
const CHROMATICITY_UNIT = 50000;

function findChunk(chunks: PngChunk[], type: string): PngChunk | undefined {
  return chunks.find((chunk) => chunk.type === type);
}

export function cicpChunk(cicp: Cicp): PngChunk {
  return {
    type: 'cICP',
    data: new Uint8Array([cicp.primaries, cicp.transfer, cicp.matrix, cicp.fullRange ? 1 : 0]),
  };
}

export function readCicp(chunks: PngChunk[]): Cicp | undefined {
  const data = findChunk(chunks, 'cICP')?.data;
  if (!data || data.length !== 4) return undefined;
  return { primaries: data[0], transfer: data[1], matrix: data[2], fullRange: data[3] === 1 };
}

export function iccpChunk({ name, profile }: IccProfile): PngChunk {
  // 1-79 printable Latin-1 characters, no leading, trailing or consecutive spaces
  if (!/^[\x21-\x7e\xa1-\xff]+( [\x21-\x7e\xa1-\xff]+)*$/.test(name) || name.length > 79) {
    throw new Error(`Invalid iCCP profile name "${name}"`);
  }
  const compressed = zlibSync(profile, { level: 9 });
  const data = new Uint8Array(name.length + 2 + compressed.length);
  for (let i = 0; i < name.length; i++) data[i] = name.charCodeAt(i);
  // data[name.length] is the null separator, data[name.length + 1] is compression method 0 (deflate)
  data.set(compressed, name.length + 2);
  return { type: 'iCCP', data };
}

export function readIccp(chunks: PngChunk[]): IccProfile | undefined {
  const data = findChunk(chunks, 'iCCP')?.data;
  if (!data) return undefined;
  const separator = data.indexOf(0);
  if (separator < 1 || separator > 79 || data[separator + 1] !== 0) return undefined;
  return {
    name: String.fromCharCode(...data.subarray(0, separator)),
    profile: unzlibSync(data.subarray(separator + 2)),
  };
}

export function clliChunk({ maxCll, maxFall }: LightLevels): PngChunk {
  const data = new Uint8Array(8);
  const view = new DataView(data.buffer);
  view.setUint32(0, Math.round(maxCll * LUMINANCE_UNIT));
  view.setUint32(4, Math.round(maxFall * LUMINANCE_UNIT));
  return { type: 'cLLi', data };
}

export function readClli(chunks: PngChunk[]): LightLevels | undefined {
  const data = findChunk(chunks, 'cLLi')?.data;
  if (!data || data.length !== 8) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    maxCll: view.getUint32(0) / LUMINANCE_UNIT,
    maxFall: view.getUint32(4) / LUMINANCE_UNIT,
  };
}

export function mdcvChunk({ primaries, maxNits, minNits }: MasteringDisplay): PngChunk {
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  const xy = [primaries.r, primaries.g, primaries.b, primaries.white].flat();
  xy.forEach((value, i) => view.setUint16(i * 2, Math.round(value * CHROMATICITY_UNIT)));
  view.setUint32(16, Math.round(maxNits * LUMINANCE_UNIT));
  view.setUint32(20, Math.round(minNits * LUMINANCE_UNIT));
  return { type: 'mDCv', data };
}
