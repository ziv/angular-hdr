import { DOCUMENT, Service, inject } from '@angular/core';
import type { ExportFormat } from '../../lib/io/export';
import { PipelineClient, type RunningExport } from '../../lib/worker/client';
import type { InspectResult, LoadResult, RenderResult, Source } from '../../lib/worker/protocol';

/**
 * The app's only door to the image worker. Everything else talks to this service, which makes it the
 * one thing to replace in tests, where no worker can run.
 */
@Service()
export class PipelineGateway {
  private readonly document = inject(DOCUMENT);
  private client: PipelineClient | undefined;
  /** Settles when the render that is currently in the worker is done; renders queue up behind it. */
  private renderTail: Promise<unknown> = Promise.resolve();

  /** The worker is started on first use and told where the app lives, so it can fetch the color profiles. */
  private get pipeline(): PipelineClient {
    return (this.client ??= new PipelineClient(this.document.baseURI));
  }

  load(id: number, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<LoadResult> {
    return this.pipeline.load(id, name, bytes);
  }

  remove(id: number): void {
    this.pipeline.remove(id);
  }

  /**
   * Renders the previews of a source. The worker handles one request at a time, so a render waits
   * for the one before it, and one that was superseded while waiting is dropped without reaching the worker.
   */
  async render(source: Source, abortSignal?: AbortSignal): Promise<RenderResult> {
    const previous = this.renderTail;
    let release = () => {};
    this.renderTail = new Promise<void>((resolve) => (release = resolve));
    try {
      await previous;
      abortSignal?.throwIfAborted();
      return await this.pipeline.render(source);
    } finally {
      release();
    }
  }

  inspect(x: number, y: number): Promise<InspectResult | undefined> {
    return this.pipeline.inspect(x, y);
  }

  export(
    source: Source,
    format: ExportFormat,
    onProgress: (fraction: number) => void,
  ): RunningExport {
    return this.pipeline.export(source, format, onProgress);
  }
}
