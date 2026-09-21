import { encode } from 'fast-png';
import type { ExportFormat } from '../../lib/io/export';
import { testProfiles } from '../../lib/testing/profiles';
import { CancelledError, type RunningExport } from '../../lib/worker/client';
import { Pipeline } from '../../lib/worker/pipeline';
import type { InspectResult, LoadResult, RenderResult, Source } from '../../lib/worker/protocol';

/**
 * Stand-in for `PipelineGateway` in specs: the real pipeline, but in the test's own thread, since jsdom
 * has no workers. Provide it with `{ provide: PipelineGateway, useClass: InProcessGateway }`.
 */
export class InProcessGateway {
  private readonly pipeline = new Pipeline(async (format) => testProfiles[format]);
  readonly removed: number[] = [];
  readonly renders: Source[] = [];

  load(id: number, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<LoadResult> {
    return this.pipeline.load(id, name, bytes);
  }

  remove(id: number): void {
    this.removed.push(id);
    this.pipeline.remove(id);
  }

  async render(source: Source, abortSignal?: AbortSignal): Promise<RenderResult> {
    abortSignal?.throwIfAborted();
    this.renders.push(source);
    return this.pipeline.render(source);
  }

  async inspect(x: number, y: number): Promise<InspectResult | undefined> {
    return this.pipeline.inspect(x, y);
  }

  export(
    source: Source,
    format: ExportFormat,
    onProgress: (fraction: number) => void,
  ): RunningExport {
    let cancelled = false;
    const result = this.pipeline.export(source, format, async (fraction) => {
      onProgress(fraction);
      // give the caller a chance to cancel between bands, as the worker does
      await new Promise((resolve) => setTimeout(resolve));
      if (cancelled) throw new CancelledError('Export cancelled');
    });
    return { result, cancel: () => (cancelled = true) };
  }
}

/**
 * A small 16-bit sRGB gradient as a PNG file. 16 bits matter: such files are decoded by our own code,
 * while 8-bit files need the browser's decoder, which jsdom does not have.
 */
export function testImageFile(name = 'gradient.png', width = 24, height = 16): File {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([(x / (width - 1)) * 65535, (y / (height - 1)) * 65535, 20000], (y * width + x) * 3);
    }
  }
  const png = encode({ width, height, data, depth: 16, channels: 3 }) as Uint8Array<ArrayBuffer>;
  return new File([png], name, { type: 'image/png' });
}

/** jsdom has no object URLs; this installs countable fakes and returns them. */
export function stubObjectUrls() {
  let next = 1;
  const create = vi.fn(() => `blob:test/${next++}`);
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
}

/**
 * What `fetch` resolves to for an image. Node's `Response` cannot carry a jsdom `File`
 * (it would be stringified), so this is just the part of the interface the app uses.
 */
export function imageResponse(
  file: File = testImageFile(),
): Pick<Response, 'ok' | 'status' | 'blob'> {
  return { ok: true, status: 200, blob: async () => file };
}
