import { pq16ToLinear, sdrToLinear } from '../color/convert';
import { identifyColorSpace, type DetectedColorSpace } from '../icc/identify';
import { parseChunks, type PngChunk } from '../png/chunks';
import { readCicp, readIccp } from '../png/color-chunks';
import { decodePng, type DecodedPng } from '../png/decode';
import type { ImageF32, SdrColorSpace } from '../types';
import { extractJpegIcc, sniffFormat, type ImageFormat } from './format';

export interface LoadedImage {
  name: string;
  format: ImageFormat;
  width: number;
  height: number;
  bitDepth: number;
  colorSpace: DetectedColorSpace;
  /** Where the color space came from: ICC description, cICP code points or "untagged". */
  colorSpaceLabel: string;
  /** Linear BT.2020 in nits; SDR sources have their white at 203 nits. */
  image: ImageF32;
  warnings: string[];
}

export const MAX_PIXELS = 50_000_000;

const MIME_TYPES: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

// PNG color types that our own decoder path understands: grey, RGB, grey + alpha, RGBA
const DIRECT_COLOR_TYPES = new Set([0, 2, 4, 6]);
const TRANSFER_PQ = 16;
const TRANSFER_HLG = 18;

function checkSize(width: number, height: number) {
  if (width * height > MAX_PIXELS) {
    throw new Error(
      `Image is ${Math.round((width * height) / 1e6)} megapixels, the limit is ${MAX_PIXELS / 1e6}`,
    );
  }
}

/** Expands 8 or 16 bit grey / RGB samples, with or without alpha, to 16-bit RGB(A). */
export function expandToRgb16({ data, depth, channels, indexed }: DecodedPng): {
  data: Uint16Array;
  channels: 3 | 4;
} {
  if (indexed || (depth !== 8 && depth !== 16))
    throw new Error('Indexed and low bit depth PNGs are not supported here');
  const scale = depth === 8 ? 257 : 1;
  const hasAlpha = channels === 2 || channels === 4;
  const colorChannels = channels - (hasAlpha ? 1 : 0);
  const outChannels = hasAlpha ? 4 : 3;
  if (scale === 1 && colorChannels === 3)
    return { data: data as Uint16Array, channels: outChannels };
  const pixelCount = data.length / channels;
  const out = new Uint16Array(pixelCount * outChannels);
  for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += channels, d += outChannels) {
    out[d] = data[s] * scale;
    out[d + 1] = data[colorChannels === 3 ? s + 1 : s] * scale;
    out[d + 2] = data[colorChannels === 3 ? s + 2 : s] * scale;
    if (hasAlpha) out[d + 3] = data[s + colorChannels] * scale;
  }
  return { data: out, channels: outChannels };
}

async function decodeWithBrowser(
  bytes: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
  colorSpace: SdrColorSpace,
) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: MIME_TYPES[format] }), {
      premultiplyAlpha: 'none',
    });
  } catch {
    throw new Error('The file is damaged or not a valid image');
  }
  try {
    checkSize(bitmap.width, bitmap.height);
    // the browser color-manages the image into the canvas color space, whatever profile it carries
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', {
      colorSpace,
    });
    if (!context) throw new Error('Could not create a canvas to decode the image');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace });
  } finally {
    bitmap.close();
  }
}

function findChunk(chunks: PngChunk[], type: string) {
  return chunks.find((chunk) => chunk.type === type);
}

/** Decodes a PNG or JPEG file into the app's working format. */
export async function loadImage(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<LoadedImage> {
  const format = sniffFormat(bytes);
  if (!format) throw new Error('Only PNG and JPEG files are supported');
  const warnings: string[] = [];
  let bitDepth = 8;
  let cicp;
  let icc;
  let decodeOurselves = false;

  if (format === 'png') {
    const chunks = parseChunks(bytes);
    const ihdr = new DataView(
      chunks[0].data.buffer,
      chunks[0].data.byteOffset,
      chunks[0].data.byteLength,
    );
    checkSize(ihdr.getUint32(0), ihdr.getUint32(4));
    bitDepth = ihdr.getUint8(8);
    cicp = readCicp(chunks);
    icc = readIccp(chunks)?.profile;
    const tagged = cicp || icc || findChunk(chunks, 'sRGB');
    // the browser only hands out 8 bits, so 16-bit files are decoded here when we fully understand them
    decodeOurselves =
      bitDepth === 16 &&
      DIRECT_COLOR_TYPES.has(ihdr.getUint8(9)) &&
      !findChunk(chunks, 'tRNS') &&
      !(findChunk(chunks, 'gAMA') && !tagged);
  } else {
    icc = extractJpegIcc(bytes);
  }

  const { colorSpace, label } = identifyColorSpace({ cicp, icc });
  let image: ImageF32;

  if (colorSpace === 'rec2100-pq') {
    const decoded = decodePng(bytes);
    const { data, channels } = expandToRgb16(decoded);
    image = { width: decoded.width, height: decoded.height, data: pq16ToLinear(data, channels) };
  } else if (decodeOurselves && colorSpace !== 'unknown') {
    const decoded = decodePng(bytes);
    const { data, channels } = expandToRgb16(decoded);
    image = {
      width: decoded.width,
      height: decoded.height,
      data: sdrToLinear(data, channels, { source: colorSpace }),
    };
  } else {
    if (cicp && (cicp.transfer === TRANSFER_PQ || cicp.transfer === TRANSFER_HLG)) {
      warnings.push('This HDR encoding is not supported; the image was imported as SDR.');
    } else if (bitDepth === 16) {
      warnings.push(
        'This 16-bit PNG could not be decoded natively; it was imported through the browser at 8-bit precision.',
      );
    }
    // an sRGB canvas returns sRGB pixels untouched; anything else goes through Display P3 to keep wide gamut colors
    const source: SdrColorSpace = colorSpace === 'srgb' ? 'srgb' : 'display-p3';
    const pixels = await decodeWithBrowser(bytes, format, source);
    image = {
      width: pixels.width,
      height: pixels.height,
      data: sdrToLinear(pixels.data, 4, { source }),
    };
  }

  return {
    name,
    format,
    width: image.width,
    height: image.height,
    bitDepth,
    colorSpace,
    colorSpaceLabel: label,
    image,
    warnings,
  };
}
