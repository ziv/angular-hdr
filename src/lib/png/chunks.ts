import { crc32 } from './crc32';

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngChunk {
  /** Four character chunk type, e.g. `IHDR`. */
  type: string;
  data: Uint8Array;
}

/** Chunks that describe the color space; all of them are replaced when we tag a file. */
const COLOR_CHUNK_TYPES = new Set(['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'mDCv', 'cLLi']);

function typeBytes(type: string): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`Invalid PNG chunk type "${type}"`);
  return Uint8Array.from(type, (ch) => ch.charCodeAt(0));
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Splits a PNG file into its chunks, verifying every CRC. The returned data views share the input buffer. */
export function parseChunks(png: Uint8Array): PngChunk[] {
  if (!hasPngSignature(png)) throw new Error('Not a PNG file');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk header');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error('Truncated PNG chunk data');
    const typeAndData = png.subarray(offset + 4, offset + 8 + length);
    const type = String.fromCharCode(...typeAndData.subarray(0, 4));
    if (crc32(typeAndData) !== view.getUint32(end - 4))
      throw new Error(`CRC mismatch in ${type} chunk`);
    chunks.push({ type, data: typeAndData.subarray(4) });
    offset = end;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR') throw new Error('PNG does not start with IHDR');
  if (chunks[chunks.length - 1].type !== 'IEND') throw new Error('PNG does not end with IEND');
  return chunks;
}

export function serializeChunks(chunks: PngChunk[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((sum, chunk) => sum + 12 + chunk.data.length, PNG_SIGNATURE.length);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    const type = typeBytes(chunk.type);
    view.setUint32(offset, chunk.data.length);
    out.set(type, offset + 4);
    out.set(chunk.data, offset + 8);
    view.setUint32(offset + 8 + chunk.data.length, crc32(type, chunk.data));
    offset += 12 + chunk.data.length;
  }
  return out;
}

/**
 * Replaces all color space chunks of a PNG with the given ones. They are placed
 * directly after IHDR, which satisfies the "before PLTE and IDAT" ordering rule.
 */
export function replaceColorChunks(
  png: Uint8Array,
  colorChunks: PngChunk[],
): Uint8Array<ArrayBuffer> {
  for (const chunk of colorChunks) {
    if (!COLOR_CHUNK_TYPES.has(chunk.type))
      throw new Error(`${chunk.type} is not a color space chunk`);
  }
  const [ihdr, ...rest] = parseChunks(png);
  return serializeChunks([
    ihdr,
    ...colorChunks,
    ...rest.filter((chunk) => !COLOR_CHUNK_TYPES.has(chunk.type)),
  ]);
}
