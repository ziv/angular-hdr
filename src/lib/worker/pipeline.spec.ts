import { encode } from 'fast-png';
import { DEFAULT_ADJUSTMENTS } from '../color/adjust';
import { pqEncode } from '../color/transfer';
import { generatePattern } from '../generate/patterns';
import { identifyColorSpace } from '../icc/identify';
import { exportHdrPng, exportImage, type ExportFormat } from '../io/export';
import { loadImage } from '../io/load';
import { decodePng } from '../png/decode';
import { PngEncoder } from '../png/encode';
import { Pipeline } from './pipeline';
import type { Source } from './protocol';
import { testProfiles } from '../testing/profiles';

const profiles = testProfiles;
const loadProfile = async (format: ExportFormat) => profiles[format];

/** Index of the first differing sample, or -1. (`toEqual` takes seconds on arrays with millions of entries.) */
function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** A 16-bit sRGB gradient, large enough to span several export bands when stretched. */
function gradientPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(
        [(x / (width - 1)) * 65535, (y / (height - 1)) * 65535, ((x + y) % 97) * 600],
        (y * width + x) * 3,
      );
    }
  }
  return encode({ width, height, data, depth: 16, channels: 3 }) as Uint8Array<ArrayBuffer>;
}

describe('PngEncoder', () => {
  it('produces the same pixels whether rows arrive at once or in bands', () => {
    const width = 50;
    const height = 40;
    const data = Uint8Array.from(
      { length: width * height * 4 },
      (_, i) => (i * 37 + (i >> 5)) & 0xff,
    );
    const whole = new PngEncoder({ width, height, channels: 4, depth: 8 });
    whole.writeRows(data);
    const banded = new PngEncoder({ width, height, channels: 4, depth: 8 });
    for (let y = 0; y < height; y += 7)
      banded.writeRows(data.subarray(y * width * 4, Math.min(y + 7, height) * width * 4));

    const a = decodePng(whole.finish([]));
    const b = decodePng(banded.finish([]));
    expect(a).toMatchObject({ width, height, depth: 8, channels: 4 });
    expect(a.data).toEqual(data);
    expect(b.data).toEqual(data);
  });

  it('can skip filtering and compression', () => {
    const data = Uint16Array.from({ length: 30 * 20 * 3 }, (_, i) => (i * 2654435761) & 0xffff);
    const encoder = new PngEncoder({
      width: 30,
      height: 20,
      channels: 3,
      depth: 16,
      compressionLevel: 0,
      filter: 'none',
    });
    encoder.writeRows(data);
    const png = encoder.finish([]);
    expect(png.length).toBeGreaterThan(data.byteLength);
    expect(decodePng(png).data).toEqual(data);
  });

  it('rejects partial rows, overflow, wrong sample types and unfinished images', () => {
    const encoder = new PngEncoder({ width: 4, height: 2, channels: 3, depth: 16 });
    expect(() => encoder.writeRows(new Uint16Array(5))).toThrow('does not match');
    expect(() => encoder.writeRows(new Uint8Array(12))).toThrow('does not match');
    expect(() => encoder.writeRows(new Uint16Array(36))).toThrow('does not match');
    encoder.writeRows(new Uint16Array(12));
    expect(() => encoder.finish([])).toThrow('does not match');
  });
});

describe('exportImage', () => {
  const pattern = generatePattern({ kind: 'ramp', peakNits: 1000 }, 2000, 1200);

  it('matches the one-shot HDR export although it runs in bands', async () => {
    const progress: number[] = [];
    const banded = await exportImage({
      source: pattern,
      format: 'hdr',
      profile: profiles.hdr,
      onProgress: (fraction) => void progress.push(fraction),
    });
    const direct = exportHdrPng(pattern, profiles.hdr);
    expect(firstDifference(decodePng(banded.bytes).data, decodePng(direct.bytes).data)).toBe(-1);
    expect(banded.lightLevels.maxCll).toBeCloseTo(direct.lightLevels.maxCll, 3);
    expect(banded.lightLevels.maxFall).toBeCloseTo(direct.lightLevels.maxFall, 3);
    expect(decodePng(banded.bytes).lightLevels?.maxCll).toBeCloseTo(1000, 1);

    // 2000 px wide → 524 rows per band → 3 bands, measured and then encoded
    expect(progress.length).toBe(6);
    expect(progress).toEqual([...progress].sort((x, y) => x - y));
    expect(progress[5]).toBe(1);
  });

  it('stops as soon as the progress callback throws', async () => {
    let calls = 0;
    const cancel = () => {
      if (++calls === 4) throw new Error('cancelled');
    };
    await expect(
      exportImage({ source: pattern, format: 'hdr', profile: profiles.hdr, onProgress: cancel }),
    ).rejects.toThrow('cancelled');
    expect(calls).toBe(4);
  });

  it('writes a tone mapped 8-bit sRGB PNG', async () => {
    const card = generatePattern({ kind: 'comparison', peakNits: 1000 }, 64, 32);
    const { bytes } = await exportImage({ source: card, format: 'sdr', profile: profiles.sdr });
    const decoded = decodePng(bytes);
    expect(decoded).toMatchObject({
      width: 64,
      height: 32,
      depth: 8,
      channels: 3,
      cicp: undefined,
    });
    expect(identifyColorSpace({ icc: decoded.icc?.profile }).colorSpace).toBe('srgb');
    // the 1000 nit half becomes white, the 203 nit half is pulled below it
    expect(decoded.data[decoded.data.length - 1]).toBe(255);
    expect(decoded.data[0]).toBeGreaterThan(150);
    expect(decoded.data[0]).toBeLessThan(255);
  });

  it('round trips an HDR export within one code value', async () => {
    const adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      boost: true,
      exposureStops: 0.3,
      gamutExpansion: 0.2,
    };
    const source = (await loadImage(gradientPng(64, 48), 'gradient.png')).image;
    const first = await exportImage({ source, adjustments, format: 'hdr', profile: profiles.hdr });
    const reloaded = (await loadImage(first.bytes, 'first.png')).image;
    const second = await exportImage({ source: reloaded, format: 'hdr', profile: profiles.hdr });
    const a = decodePng(first.bytes).data;
    const b = decodePng(second.bytes).data;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe('Pipeline', () => {
  it('renders patterns with pixels, histogram and light levels', async () => {
    const pipeline = new Pipeline(loadProfile);
    const source: Source = {
      kind: 'pattern',
      spec: { kind: 'comparison', peakNits: 1000 },
      width: 4096,
      height: 256,
    };
    expect(pipeline.inspect(0, 0)).toBeUndefined();
    const result = await pipeline.render(source);
    expect(result).toMatchObject({
      width: 2048,
      height: 128,
      fullWidth: 4096,
      fullHeight: 256,
      clippedFraction: 0,
    });
    expect(result.lightLevels.maxCll).toBeCloseTo(1000, 1);
    expect(result.histogram.reduce((sum, count) => sum + count, 0)).toBe(2048 * 128);

    // the same preview, once per output profile
    const hdr = decodePng(result.hdrPng);
    const sdr = decodePng(result.sdrPng);
    expect(hdr).toMatchObject({
      width: 2048,
      height: 128,
      depth: 16,
      cicp: { primaries: 9, transfer: 16 },
    });
    expect(sdr).toMatchObject({ width: 2048, height: 128, depth: 8, cicp: undefined });
    expect(identifyColorSpace({ icc: hdr.icc?.profile }).colorSpace).toBe('rec2100-pq');
    expect(identifyColorSpace({ icc: sdr.icc?.profile }).colorSpace).toBe('srgb');

    // a pattern has no original; the 1000 nit half is white in SDR, the 203 nit half is rolled off below it
    const bright = pipeline.inspect(2000, 5)!;
    const dim = pipeline.inspect(10, 5)!;
    expect(bright.original).toBeUndefined();
    expect(bright.hdr[0]).toBeCloseTo(1000, 1);
    expect(bright.sdr).toEqual([255, 255, 255]);
    expect(dim.hdr[1]).toBeCloseTo(203, 1);
    expect(dim.sdr[0]).toBeLessThan(255);
    expect(pipeline.inspect(2048, 0)).toBeUndefined();
    expect(pipeline.inspect(0, -1)).toBeUndefined();
  });

  it('loads, previews, inspects, exports and forgets a file', async () => {
    const pipeline = new Pipeline(loadProfile);
    const { meta, sourceLevels } = await pipeline.load(7, 'gradient.png', gradientPng(40, 30));
    expect(meta).toMatchObject({
      name: 'gradient.png',
      width: 40,
      height: 30,
      bitDepth: 16,
      colorSpace: 'srgb',
    });
    expect('image' in meta).toBe(false);
    // the brightest pixel is a saturated yellow, whose BT.2020 channels stay just below white
    expect(sourceLevels.maxCll).toBeGreaterThan(195);
    expect(sourceLevels.maxCll).toBeLessThanOrEqual(203);

    const source: Source = {
      kind: 'file',
      id: 7,
      adjustments: { ...DEFAULT_ADJUSTMENTS, boost: true, peakNits: 1000 },
    };
    const adjusted = await pipeline.render(source);
    expect(adjusted.lightLevels.maxCll).toBeGreaterThan(900);
    expect(adjusted.lightLevels.maxCll).toBeLessThanOrEqual(1000);

    // bottom right is the brightest highlight: the original stays SDR, the HDR output is far brighter, the SDR output is back at white
    const bottomRight = 30 * 40 - 1;
    const pixel = pipeline.inspect(39, 29)!;
    expect(Math.max(...pixel.original!)).toBeLessThanOrEqual(203.01);
    expect(pixel.hdr[0]).toBeGreaterThan(pixel.original![0] * 3);
    expect(pixel.sdr[0]).toBe(255);
    // a shadow is untouched by the boost
    const shadow = pipeline.inspect(2, 3)!;
    expect(shadow.hdr[0]).toBeCloseTo(shadow.original![0], 3);

    const hdr = await pipeline.export(source, 'hdr');
    expect(decodePng(hdr.bytes)).toMatchObject({ width: 40, height: 30, depth: 16 });
    expect(decodePng(hdr.bytes).data[bottomRight * 3]).toBe(
      Math.round(pqEncode(pixel.hdr[0]) * 65535),
    );
    const sdr = await pipeline.export(source, 'sdr');
    expect(decodePng(sdr.bytes)).toMatchObject({ width: 40, height: 30, depth: 8 });

    pipeline.remove(7);
    await expect(pipeline.render(source)).rejects.toThrow('no longer loaded');
  });
});
