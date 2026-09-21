/**
 * The app's single working image format: RGBA float, where RGB is linear light
 * with BT.2020 primaries in absolute nits and A is straight alpha in [0..1].
 */
export interface ImageF32 {
  width: number;
  height: number;
  data: Float32Array;
}

/** Color spaces we can identify and convert from. Both SDR spaces use the sRGB transfer function. */
export type SdrColorSpace = 'srgb' | 'display-p3';

export type ColorSpace = SdrColorSpace | 'rec2100-pq';
