import type { Vec3 } from '../color/matrices';
import type { ImageF32 } from '../types';

// 3×5 pixel digits, one string per glyph, rows top to bottom
const DIGITS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
};

const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;

export function createImage(width: number, height: number): ImageF32 {
  const data = new Float32Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 1;
  return { width, height, data };
}

/** Fills a rectangle (clipped to the image) with a linear BT.2020 color in nits. */
export function fillRect(
  image: ImageF32,
  x: number,
  y: number,
  width: number,
  height: number,
  [r, g, b]: Vec3,
) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + width));
  const y1 = Math.min(image.height, Math.round(y + height));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * image.width + px) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
    }
  }
}

/** Width in pixels of a number drawn with `drawNumber` at the given scale. */
export function numberWidth(text: string, scale: number): number {
  return (text.length * (GLYPH_WIDTH + 1) - 1) * scale;
}

/** Draws a string of digits horizontally centered on `centerX`, with its top edge at `y`. */
export function drawNumber(
  image: ImageF32,
  text: string,
  centerX: number,
  y: number,
  scale: number,
  color: Vec3,
) {
  let x = Math.round(centerX - numberWidth(text, scale) / 2);
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (!glyph) throw new Error(`Cannot draw "${ch}", only digits are supported`);
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (glyph[row * GLYPH_WIDTH + col] === '1') {
          fillRect(image, x + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    x += (GLYPH_WIDTH + 1) * scale;
  }
}
