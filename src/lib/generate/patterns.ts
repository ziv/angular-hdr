import { DISPLAY_P3_TO_BT2020, SRGB_TO_BT2020, transform, type Vec3 } from '../color/matrices';
import { pqDecode, pqEncode, SDR_WHITE_NITS, srgbToLinear } from '../color/transfer';
import type { ImageF32 } from '../types';
import { createImage, drawNumber, fillRect, GLYPH_HEIGHT, numberWidth } from './draw';

export type PatternSpec =
  /** Left half at SDR reference white, right half at `peakNits`. */
  | { kind: 'comparison'; peakNits: number }
  /** Grey patches at fixed luminance steps, labelled in nits. */
  | { kind: 'patches' }
  /** Perceptually uniform (PQ) grey ramp from 0 to `peakNits`: smooth on top, 16 steps below. */
  | { kind: 'ramp'; peakNits: number }
  /** A single sRGB color, scaled so that sRGB white would be `whiteNits`. */
  | { kind: 'solid'; color: Vec3; whiteNits: number }
  /** Rows of red, green and blue; columns use the sRGB, Display P3 and BT.2020 primaries. */
  | { kind: 'gamut'; whiteNits: number };

export type PatternKind = PatternSpec['kind'];

export const PATCH_NITS = [100, 203, 400, 1000, 4000, 10000];

const RAMP_STEPS = 16;
const RAMP_TICKS = [1, 10, 100, 203, 1000, 4000];

const grey = (nits: number): Vec3 => [nits, nits, nits];

/** Largest whole pixel scale at which `text` fits the given box. */
function labelScale(text: string, maxWidth: number, maxHeight: number): number {
  return Math.max(
    1,
    Math.floor(Math.min(maxWidth / numberWidth(text, 1), maxHeight / GLYPH_HEIGHT)),
  );
}

function comparison(image: ImageF32, peakNits: number) {
  const half = image.width / 2;
  const sides = [
    { x: 0, nits: SDR_WHITE_NITS },
    { x: half, nits: peakNits },
  ];
  for (const { x, nits } of sides) {
    fillRect(image, x, 0, half, image.height, grey(nits));
    const text = String(Math.round(nits));
    const scale = labelScale(text, half * 0.5, image.height * 0.125);
    drawNumber(
      image,
      text,
      x + half / 2,
      (image.height - GLYPH_HEIGHT * scale) / 2,
      scale,
      grey(0),
    );
  }
}

function patches(image: ImageF32) {
  const count = PATCH_NITS.length;
  const gap = image.width * 0.03;
  const patchWidth = (image.width - gap * (count + 1)) / count;
  const patchHeight = image.height * 0.6;
  const top = image.height * 0.12;
  // one scale for all labels, sized for the longest one
  const scale = labelScale(String(Math.max(...PATCH_NITS)), patchWidth * 0.8, image.height * 0.1);
  PATCH_NITS.forEach((nits, i) => {
    const x = gap + i * (patchWidth + gap);
    fillRect(image, x, top, patchWidth, patchHeight, grey(nits));
    drawNumber(
      image,
      String(nits),
      x + patchWidth / 2,
      top + patchHeight + image.height * 0.06,
      scale,
      grey(SDR_WHITE_NITS),
    );
  });
}

function ramp(image: ImageF32, peakNits: number) {
  const { width, height } = image;
  const peakSignal = pqEncode(peakNits);
  const smoothEnd = Math.round(height * 0.6);
  const steppedEnd = Math.round(height * 0.8);
  for (let x = 0; x < width; x++) {
    const t = width > 1 ? x / (width - 1) : 1;
    const stepped = Math.min(Math.floor(t * RAMP_STEPS), RAMP_STEPS - 1) / (RAMP_STEPS - 1);
    fillRect(image, x, 0, 1, smoothEnd, grey(pqDecode(t * peakSignal)));
    fillRect(image, x, smoothEnd, 1, steppedEnd - smoothEnd, grey(pqDecode(stepped * peakSignal)));
  }
  // tick marks with the luminance in nits under the ramp
  const tickHeight = Math.max(1, Math.round(height * 0.03));
  const scale = labelScale(String(Math.max(...RAMP_TICKS)), width * 0.05, height * 0.08);
  for (const nits of RAMP_TICKS.filter((tick) => tick < peakNits)) {
    const x = (pqEncode(nits) / peakSignal) * (width - 1);
    fillRect(image, x - scale / 2, steppedEnd, scale, tickHeight, grey(SDR_WHITE_NITS));
    drawNumber(image, String(nits), x, steppedEnd + tickHeight * 2, scale, grey(SDR_WHITE_NITS));
  }
}

function solid(image: ImageF32, color: Vec3, whiteNits: number) {
  const [r, g, b] = color;
  const linear: Vec3 = [
    srgbToLinear(r) * whiteNits,
    srgbToLinear(g) * whiteNits,
    srgbToLinear(b) * whiteNits,
  ];
  fillRect(image, 0, 0, image.width, image.height, transform(SRGB_TO_BT2020, linear));
}

function gamut(image: ImageF32, whiteNits: number) {
  const toBt2020 = [SRGB_TO_BT2020, DISPLAY_P3_TO_BT2020, undefined];
  const cellWidth = image.width / 3;
  const cellHeight = image.height / 3;
  for (let row = 0; row < 3; row++) {
    const primary: Vec3 = [
      row === 0 ? whiteNits : 0,
      row === 1 ? whiteNits : 0,
      row === 2 ? whiteNits : 0,
    ];
    toBt2020.forEach((matrix, col) => {
      const color = matrix ? transform(matrix, primary) : primary;
      fillRect(image, col * cellWidth, row * cellHeight, cellWidth, cellHeight, color);
    });
  }
}

export function generatePattern(spec: PatternSpec, width: number, height: number): ImageF32 {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Pattern size must be a positive whole number of pixels');
  }
  const image = createImage(width, height);
  switch (spec.kind) {
    case 'comparison':
      comparison(image, spec.peakNits);
      break;
    case 'patches':
      patches(image);
      break;
    case 'ramp':
      ramp(image, spec.peakNits);
      break;
    case 'solid':
      solid(image, spec.color, spec.whiteNits);
      break;
    case 'gamut':
      gamut(image, spec.whiteNits);
      break;
  }
  return image;
}
