import { Service, inject, signal } from '@angular/core';
import type { ExportFormat } from '../../lib/io/export';
import { downloadPng } from '../../lib/io/download';
import { CancelledError, type RunningExport } from '../../lib/worker/client';
import { PipelineGateway } from './pipeline-gateway';
import { WorkspaceStore } from './workspace-store';

export interface ActiveDownload {
  format: ExportFormat;
  /** Encoding progress in [0..1]. */
  fraction: number;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Full resolution downloads of the converted image: one at a time, with progress and cancel. */
@Service()
export class DownloadStore {
  private readonly gateway = inject(PipelineGateway);
  private readonly workspace = inject(WorkspaceStore);
  private running: RunningExport | undefined;

  private readonly activeState = signal<ActiveDownload | null>(null);
  private readonly messageState = signal<string | null>(null);

  /** The download that is being encoded right now. */
  readonly active = this.activeState.asReadonly();
  /** Outcome of the last download. */
  readonly message = this.messageState.asReadonly();

  /** Encodes the selected image in the given format and hands it to the browser as a download. */
  async start(format: ExportFormat): Promise<void> {
    const source = this.workspace.source();
    const baseName = this.workspace.baseName();
    if (!source || !baseName || this.running) return;

    const fileName = `${baseName}-${format}.png`;
    this.activeState.set({ format, fraction: 0 });
    this.messageState.set(null);
    try {
      this.running = this.gateway.export(source, format, (fraction) =>
        this.activeState.set({ format, fraction }),
      );
      const { bytes } = await this.running.result;
      downloadPng(fileName, bytes);
      this.messageState.set(`Downloaded ${fileName} (${formatBytes(bytes.length)}).`);
    } catch (error) {
      const cancelled = error instanceof CancelledError;
      this.messageState.set(
        cancelled ? 'Download cancelled.' : error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.running = undefined;
      this.activeState.set(null);
    }
  }

  cancel(): void {
    this.running?.cancel();
  }
}
