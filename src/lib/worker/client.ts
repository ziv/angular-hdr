import type { ExportFormat } from '../io/export';
import type {
  ExportedFile,
  InspectResult,
  LoadResult,
  PipelineRequest,
  RenderResult,
  RequestEnvelope,
  ResponseEnvelope,
  Source,
} from './protocol';

/** Rejection of an export that the user cancelled. */
export class CancelledError extends Error {}

interface Pending {
  resolve: (result: never) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number) => void;
}

export interface RunningExport {
  result: Promise<ExportedFile>;
  cancel(): void;
}

/** Promise based front end of the pipeline worker. */
export class PipelineClient {
  private readonly worker = new Worker(new URL('./pipeline.worker', import.meta.url), {
    type: 'module',
  });
  private readonly pending = new Map<number, Pending>();
  private nextRequestId = 1;

  /** `baseUrl` is the document's base URI, from which the worker fetches the color profiles. */
  constructor(baseUrl: string) {
    this.notify({ type: 'init', baseUrl });
    this.worker.onmessage = ({ data }: MessageEvent<ResponseEnvelope>) => {
      const entry = this.pending.get(data.requestId);
      if (!entry) return;
      if (data.kind === 'progress') {
        entry.onProgress?.(data.fraction);
        return;
      }
      this.pending.delete(data.requestId);
      if (data.kind === 'result') entry.resolve(data.result as never);
      else
        entry.reject(data.cancelled ? new CancelledError(data.message) : new Error(data.message));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'The image worker crashed');
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  private send<T>(
    request: PipelineRequest,
    transfer: Transferable[] = [],
    onProgress?: (fraction: number) => void,
  ) {
    const requestId = this.nextRequestId++;
    const result = new Promise<T>((resolve, reject) =>
      this.pending.set(requestId, { resolve, reject, onProgress }),
    );
    this.worker.postMessage({ requestId, request } satisfies RequestEnvelope, transfer);
    return { requestId, result };
  }

  /** Fire and forget: nobody waits for the answer, so a failure must not surface as an unhandled rejection. */
  private notify(request: PipelineRequest) {
    this.send<void>(request).result.catch(() => {});
  }

  /** Decodes a file inside the worker. The bytes are handed over, not copied. */
  load(id: number, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<LoadResult> {
    return this.send<LoadResult>({ type: 'load', id, name, bytes }, [bytes.buffer]).result;
  }

  remove(id: number) {
    this.notify({ type: 'remove', id });
  }

  render(source: Source): Promise<RenderResult> {
    return this.send<RenderResult>({ type: 'render', source }).result;
  }

  /** Pixel values of the last render at preview coordinates; undefined outside the image. */
  inspect(x: number, y: number): Promise<InspectResult | undefined> {
    return this.send<InspectResult | undefined>({ type: 'inspect', x, y }).result;
  }

  export(
    source: Source,
    format: ExportFormat,
    onProgress: (fraction: number) => void,
  ): RunningExport {
    const { requestId, result } = this.send<ExportedFile>(
      { type: 'export', source, format },
      [],
      onProgress,
    );
    return { result, cancel: () => this.notify({ type: 'cancel', target: requestId }) };
  }
}
