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

/** Which images are loaded, which one is selected, and how it is to be converted. */
@Service()
export class WorkspaceStore {
  private readonly gateway = inject(PipelineGateway);
  private readonly document = inject(DOCUMENT);
  private nextId = 1;

  private readonly filesState = signal<LoadedFile[]>([]);
  private readonly selectedIdState = signal<number | null>(null);
  private readonly loadErrorsState = signal<string[]>([]);
  private readonly loadingState = signal<string | null>(null);

  readonly files = this.filesState.asReadonly();
  readonly selectedId = this.selectedIdState.asReadonly();
  /** One message per file of the last `open` that could not be loaded. */
  readonly loadErrors = this.loadErrorsState.asReadonly();
  /** Name of the file that is being decoded right now. */
  readonly loading = this.loadingState.asReadonly();
  /** The conversion settings; they apply to whichever file is selected. */
  readonly adjustments = signal<Adjustments>(DEFAULT_ADJUSTMENTS);

  readonly selectedFile = computed(() =>
    this.files().find((file) => file.id === this.selectedId()),
  );

  /** What the worker should render or export, or undefined while no file is selected. */
  readonly source = computed<Source | undefined>(() => {
    const file = this.selectedFile();
    return file && { id: file.id, adjustments: this.adjustments() };
  });

  /** File name of the selected image without its extension, the stem of the download names. */
  readonly baseName = computed(() => this.selectedFile()?.meta.name.replace(/\.[^.]+$/, ''));

  /** Decodes the files one after the other and selects the last one that loaded. */
  async open(files: File[]): Promise<void> {
    const errors: string[] = [];
    let lastLoaded: number | undefined;
    this.loadErrorsState.set([]);
    for (const file of files) {
      this.loadingState.set(file.name);
      try {
        const id = this.nextId++;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { meta, sourceLevels } = await this.gateway.load(id, file.name, bytes);
        const loaded = { id, meta, sourceLevels, originalUrl: URL.createObjectURL(file) };
        this.filesState.update((current) => [...current, loaded]);
        lastLoaded = id;
      } catch (error) {
        errors.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    this.loadingState.set(null);
    this.loadErrorsState.set(errors);
    if (lastLoaded !== undefined) this.selectedIdState.set(lastLoaded);
  }

  /** Fetches the bundled default image and opens it, so the app never starts empty. */
  async loadDefault(): Promise<void> {
    try {
      const response = await fetch(new URL(DEFAULT_IMAGE, this.document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      await this.open([new File([blob], DEFAULT_IMAGE, { type: blob.type })]);
    } catch (error) {
      this.loadErrorsState.set([`${DEFAULT_IMAGE}: ${errorMessage(error)}`]);
    }
  }

  select(id: number): void {
    if (this.files().some((file) => file.id === id)) this.selectedIdState.set(id);
  }

  /** Forgets a file everywhere. When it was the selected one, its neighbour takes over. */
  remove(id: number): void {
    const files = this.files();
    const index = files.findIndex((file) => file.id === id);
    if (index < 0) return;
    const remaining = files.filter((file) => file.id !== id);
    this.filesState.set(remaining);
    if (this.selectedId() === id) {
      this.selectedIdState.set(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    }
    URL.revokeObjectURL(files[index].originalUrl);
    this.gateway.remove(id);
  }

  resetAdjustments(): void {
    this.adjustments.set(DEFAULT_ADJUSTMENTS);
  }
}
