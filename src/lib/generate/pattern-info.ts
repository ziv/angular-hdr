import type { PatternKind } from './patterns';

export interface PatternInfo {
  label: string;
  description: string;
  /** Label and default of the luminance setting, when the pattern has one. */
  nits?: { label: string; value: number };
  usesColor?: boolean;
}

/** What a UI needs to know to offer each test pattern. */
export const PATTERNS: Record<PatternKind, PatternInfo> = {
  comparison: {
    label: 'SDR vs HDR card',
    description:
      'Left half is SDR white (203 nits), right half is the HDR peak. On an HDR display the right half is clearly brighter; if both look the same, the display or browser is not in HDR mode.',
    nits: { label: 'HDR peak (nits)', value: 1000 },
  },
  patches: {
    label: 'Luminance patches',
    description:
      'Grey patches at 100, 203, 400, 1000, 4000 and 10 000 nits. Patches above the display peak look identical.',
  },
  ramp: {
    label: 'Luminance ramp',
    description:
      'Perceptually uniform grey ramp from black to the peak: smooth on top, 16 steps below, ticks labelled in nits.',
    nits: { label: 'Peak (nits)', value: 1000 },
  },
  solid: {
    label: 'Solid color',
    description: 'One sRGB color, scaled so that sRGB white would land on the chosen luminance.',
    nits: { label: 'White level (nits)', value: 1000 },
    usesColor: true,
  },
  gamut: {
    label: 'Gamut primaries',
    description:
      'Rows: red, green, blue. Columns: sRGB, Display P3 and BT.2020 primaries, left to right.',
    nits: { label: 'White level (nits)', value: 203 },
  },
};

export const PATTERN_MIN_SIDE = 16;
export const PATTERN_MAX_SIDE = 8192;
export const PATTERN_MAX_PIXELS = 32_000_000;
export const PATTERN_MAX_NITS = 10000;
