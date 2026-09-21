import { DOCUMENT, Service, computed, inject, signal } from '@angular/core';
import { DEFAULT_ADJUSTMENTS, type Adjustments } from '../../lib/color/adjust';
import type { LightLevels } from '../../lib/color/convert';
import type { FileMeta, Source } from '../../lib/worker/protocol';
import { PipelineGateway } from './pipeline-gateway';

export interface LoadedFile {
  id: number;
  meta: FileMeta;
  /** Light levels of the unadjusted image. */
  sourceLevels: LightLevels;
  /** Object URL of the file exactly as it was opened: the "Original" image and its download. */
  originalUrl: string;
}

/** The image that is loaded on start-up; from then on it is a file like any other. */
export const DEFAULT_IMAGE = 'default.jpeg';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The one image the app works on, and how it is to be converted. */
@Service()
export class WorkspaceStore {
  private readonly gateway = inject(PipelineGateway);
  private readonly document = inject(DOCUMENT);
  private nextId = 1;

  private readonly fileState = signal<LoadedFile | undefined>(undefined);
  private readonly loadErrorState = signal<string | null>(null);
  private readonly loadingState = signal<string | null>(null);

  /** The current image. Opening another one replaces it. */
  readonly file = this.fileState.asReadonly();
  /** Why the last `open` failed; the image that was there before stays in place. */
  readonly loadError = this.loadErrorState.asReadonly();
  /** Name of the file that is being decoded right now. */
  readonly loading = this.loadingState.asReadonly();
  /** The conversion settings; they are kept when another image is opened. */
  readonly adjustments = signal<Adjustments>(DEFAULT_ADJUSTMENTS);

  /** What the worker should render or export, or undefined while there is no image. */
  readonly source = computed<Source | undefined>(() => {
    const file = this.file();
    return file && { id: file.id, adjustments: this.adjustments() };
  });

  /** File name of the image without its extension, the stem of the download name. */
  readonly baseName = computed(() => this.file()?.meta.name.replace(/\.[^.]+$/, ''));

  /** Decodes the file and makes it the current image. If that fails, the previous image stays. */
  async open(file: File): Promise<void> {
    this.loadErrorState.set(null);
    this.loadingState.set(file.name);
    try {
      const id = this.nextId++;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { meta, sourceLevels } = await this.gateway.load(id, file.name, bytes);
      const previous = this.file();
      this.fileState.set({ id, meta, sourceLevels, originalUrl: URL.createObjectURL(file) });
      if (previous) {
        URL.revokeObjectURL(previous.originalUrl);
        this.gateway.remove(previous.id);
      }
    } catch (error) {
      this.loadErrorState.set(`${file.name}: ${errorMessage(error)}`);
    } finally {
      this.loadingState.set(null);
    }
  }

  /** Fetches the bundled default image and opens it, so the app never starts empty. */
  async loadDefault(): Promise<void> {
    try {
      const response = await fetch(new URL(DEFAULT_IMAGE, this.document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      await this.open(new File([blob], DEFAULT_IMAGE, { type: blob.type }));
    } catch (error) {
      this.loadErrorState.set(`${DEFAULT_IMAGE}: ${errorMessage(error)}`);
    }
  }

  resetAdjustments(): void {
    this.adjustments.set(DEFAULT_ADJUSTMENTS);
  }
}
