import { hasPngSignature } from '../png/chunks';

export type ImageFormat = 'png' | 'jpeg';

const ICC_MARKER = 'ICC_PROFILE\0';

/** Detects the file format from its magic bytes; the extension and MIME type are not trusted. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (hasPngSignature(bytes)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  return undefined;
}

/** Reassembles the ICC profile stored across the APP2 segments of a JPEG, if there is one. */
export function extractJpegIcc(jpeg: Uint8Array): Uint8Array | undefined {
  const parts: Uint8Array[] = [];
  let expected = 0;
  let offset = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1];
    // start of scan or end of image: no more metadata segments
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    if (length < 2 || offset + 2 + length > jpeg.length) break;
    const segment = jpeg.subarray(offset + 4, offset + 2 + length);
    if (
      marker === 0xe2 &&
      segment.length > 14 &&
      String.fromCharCode(...segment.subarray(0, 12)) === ICC_MARKER
    ) {
      const sequence = segment[12];
      expected = segment[13];
      parts[sequence - 1] = segment.subarray(14);
    }
    offset += 2 + length;
  }
  if (!expected || parts.length !== expected) return undefined;
  for (let i = 0; i < expected; i++) if (!parts[i]) return undefined;
  const profile = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    profile.set(part, position);
    position += part.length;
  }
  return profile;
}
