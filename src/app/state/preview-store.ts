import {
  Service,
  computed,
  debounced,
  effect,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import type { RenderResult } from '../../lib/worker/protocol';
import { PipelineGateway } from './pipeline-gateway';
import { WorkspaceStore } from './workspace-store';

/** How long the settings have to stay unchanged before a render starts, so a dragged slider renders once. */
const RENDER_DEBOUNCE_MS = 60;

function pngUrl(png: Uint8Array<ArrayBuffer>): string {
  return URL.createObjectURL(new Blob([png], { type: 'image/png' }));
}

/** The HDR preview of the selected file, re-rendered whenever the file or the adjustments change. */
@Service()
export class PreviewStore {
  private readonly gateway = inject(PipelineGateway);
  private readonly workspace = inject(WorkspaceStore);

  private readonly settledSource = debounced(() => this.workspace.source(), RENDER_DEBOUNCE_MS);

  /** The render of the current source. A resource drops its value while new params load, see `result`. */
  readonly render = resource({
    params: () => (this.settledSource.hasValue() ? this.settledSource.value() : undefined),
    loader: ({ params, abortSignal }) => this.gateway.render(params, abortSignal),
  });

  private readonly hdrUrlState = signal<string | undefined>(undefined);
  /** Object URL of the preview PNG; undefined until the first render, and again when no file is selected. */
  readonly hdrUrl = this.hdrUrlState.asReadonly();

  /**
   * The latest finished render. It stays in place while the next one is on its way, so the images
   * do not blink on every slider move; it only goes away when there is nothing selected anymore.
   */
  private readonly resultState = linkedSignal<RenderResult | undefined, RenderResult | undefined>({
    source: () => (this.render.hasValue() ? this.render.value() : undefined),
    computation: (fresh, previous) =>
      fresh ?? (this.workspace.source() ? previous?.value : undefined),
  });
  readonly result = this.resultState.asReadonly();
  readonly isRendering = computed(() => this.render.isLoading() || this.settledSource.isLoading());

  /** One line about the current preview: its size, light levels, clipping and render time. */
  readonly status = computed(() => {
    const loading = this.workspace.loading();
    if (loading) return `Loading ${loading}…`;
    const error = this.render.error();
    if (error) return error.message;
    const result = this.result();
    if (!result)
      return this.workspace.selectedFile() ? 'Rendering…' : 'Open an image to get started.';

    const { width, height, fullWidth, fullHeight, lightLevels, clippedFraction, elapsedMs } =
      result;
    const size =
      width === fullWidth
        ? `${fullWidth}×${fullHeight}`
        : `Preview ${width}×${height} of ${fullWidth}×${fullHeight}`;
    const clipped =
      clippedFraction > 0
        ? ` · ${(clippedFraction * 100).toFixed(clippedFraction < 0.001 ? 3 : 1)}% of pixels clipped at the peak`
        : '';
    const peak = Math.round(lightLevels.maxCll);
    const average = Math.round(lightLevels.maxFall);
    return `${size} · peak ${peak} nits, average ${average} nits${clipped} · ${elapsedMs} ms`;
  });

  constructor() {
    // A computed must stay pure, so the object URL, which has to be released again, lives in an effect.
    effect((onCleanup) => {
      const result = this.result();
      if (!result) {
        this.hdrUrlState.set(undefined);
        return;
      }
      const url = pngUrl(result.hdrPng);
      this.hdrUrlState.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }
}
