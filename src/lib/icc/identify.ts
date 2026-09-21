import { srgbToLinear } from '../color/transfer';
import type { Cicp } from '../png/color-chunks';
import type { ColorSpace } from '../types';

export type DetectedColorSpace = ColorSpace | 'unknown';

export interface Identification {
  colorSpace: DetectedColorSpace;
  /** Human readable source of the decision, e.g. the ICC profile description. */
  label: string;
}

interface IccTag {
  type: string;
  data: Uint8Array;
}

// H.273 code points
const PRIMARIES_BT709 = 1;
const PRIMARIES_BT2020 = 9;
const PRIMARIES_P3_D65 = 12;
const TRANSFER_SRGB = 13;
const TRANSFER_PQ = 16;

// D50 adapted colorants (rXYZ, gXYZ, bXYZ) as they appear in matrix/TRC profiles
const KNOWN_COLORANTS: { colorSpace: ColorSpace; xyz: number[] }[] = [
  {
    colorSpace: 'srgb',
    xyz: [0.4361, 0.2225, 0.0139, 0.3851, 0.7169, 0.0971, 0.1431, 0.0606, 0.7141],
  },
  {
    colorSpace: 'display-p3',
    xyz: [0.5151, 0.2412, -0.0011, 0.292, 0.6922, 0.0419, 0.1571, 0.0666, 0.7841],
  },
];
const COLORANT_TOLERANCE = 0.003;

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

function readTags(profile: Uint8Array): Map<string, IccTag> | undefined {
  if (profile.length < 132 || ascii(profile.subarray(36, 40)) !== 'acsp') return undefined;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const count = view.getUint32(128);
  const tags = new Map<string, IccTag>();
  for (let i = 0; i < count; i++) {
    const entry = 132 + i * 12;
    if (entry + 12 > profile.length) return undefined;
    const offset = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (size < 8 || offset + size > profile.length) continue;
    const data = profile.subarray(offset, offset + size);
    tags.set(ascii(profile.subarray(entry, entry + 4)), { type: ascii(data.subarray(0, 4)), data });
  }
  return tags;
}

function readDescription(tag: IccTag | undefined): string | undefined {
  if (!tag) return undefined;
  const { type, data } = tag;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === 'mluc' && data.length >= 28 && view.getUint32(8) > 0) {
    const length = view.getUint32(20);
    const offset = view.getUint32(24);
    if (offset + length > data.length) return undefined;
    let text = '';
    for (let i = offset; i + 1 < offset + length; i += 2)
      text += String.fromCharCode(view.getUint16(i));
    return text;
  }
  if (type === 'desc' && data.length >= 12) {
    const length = Math.min(view.getUint32(8), data.length - 12);
    return ascii(data.subarray(12, 12 + length)).replace(/\0+$/, '');
  }
  return undefined;
}

function readXyz(tag: IccTag | undefined): number[] | undefined {
  if (!tag || tag.type !== 'XYZ ' || tag.data.length < 20) return undefined;
  const view = new DataView(tag.data.buffer, tag.data.byteOffset, tag.data.byteLength);
  return [8, 12, 16].map((offset) => view.getInt32(offset) / 65536);
}

/** True when a TRC tag encodes the sRGB transfer function (also used by Display P3). */
function isSrgbCurve(tag: IccTag | undefined): boolean {
  if (!tag) return false;
  const view = new DataView(tag.data.buffer, tag.data.byteOffset, tag.data.byteLength);
  if (tag.type === 'para' && tag.data.length >= 16) {
    const functionType = view.getUint16(8);
    const gamma = view.getInt32(12) / 65536;
    return functionType >= 3 && Math.abs(gamma - 2.4) < 0.01;
  }
  if (tag.type === 'curv' && tag.data.length >= 12) {
    const count = view.getUint32(8);
    if (count < 256 || 12 + count * 2 > tag.data.length) return false;
    const index = count >> 1;
    const sample = view.getUint16(12 + index * 2) / 65535;
    return Math.abs(sample - srgbToLinear(index / (count - 1))) < 0.005;
  }
  return false;
}

function fromCicp(cicp: Cicp): DetectedColorSpace {
  if (!cicp.fullRange || cicp.matrix !== 0) return 'unknown';
  if (cicp.primaries === PRIMARIES_BT2020 && cicp.transfer === TRANSFER_PQ) return 'rec2100-pq';
  if (cicp.primaries === PRIMARIES_BT709 && cicp.transfer === TRANSFER_SRGB) return 'srgb';
  if (cicp.primaries === PRIMARIES_P3_D65 && cicp.transfer === TRANSFER_SRGB) return 'display-p3';
  return 'unknown';
}

function describeCicp(cicp: Cicp): string {
  return `cICP ${cicp.primaries}/${cicp.transfer}/${cicp.matrix}/${cicp.fullRange ? 1 : 0}`;
}

function identifyIcc(profile: Uint8Array): Identification {
  const tags = readTags(profile);
  if (!tags) return { colorSpace: 'unknown', label: 'Invalid ICC profile' };
  const label = readDescription(tags.get('desc')) || 'Unnamed ICC profile';

  const cicpTag = tags.get('cicp');
  if (cicpTag && cicpTag.data.length >= 12) {
    const [primaries, transfer, matrix, range] = cicpTag.data.subarray(8, 12);
    return { colorSpace: fromCicp({ primaries, transfer, matrix, fullRange: range === 1 }), label };
  }

  const colorants = ['rXYZ', 'gXYZ', 'bXYZ'].flatMap((name) => readXyz(tags.get(name)) ?? []);
  const curves = ['rTRC', 'gTRC', 'bTRC'].map((name) => tags.get(name));
  if (colorants.length === 9 && curves.every(isSrgbCurve)) {
    const match = KNOWN_COLORANTS.find(({ xyz }) =>
      xyz.every((value, i) => Math.abs(value - colorants[i]) < COLORANT_TOLERANCE),
    );
    if (match) return { colorSpace: match.colorSpace, label };
  }
  return { colorSpace: 'unknown', label };
}

/**
 * Classifies an image's color space. `cICP` wins over an ICC profile, as the PNG spec requires;
 * images without either are sRGB by convention.
 */
export function identifyColorSpace({
  cicp,
  icc,
}: {
  cicp?: Cicp;
  icc?: Uint8Array;
}): Identification {
  if (cicp) return { colorSpace: fromCicp(cicp), label: describeCicp(cicp) };
  if (icc) return identifyIcc(icc);
  return { colorSpace: 'srgb', label: 'Untagged, assumed sRGB' };
}
