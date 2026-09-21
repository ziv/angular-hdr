import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { drawHistogram, type HistogramMarker } from '../../lib/render/histogram';

/** Log-luminance histogram of the HDR output, with markers for SDR white and the content peak. */
@Component({
  selector: 'app-luminance-histogram',
  host: { class: 'panel' },
  template: `
    <h2 class="panel-title">Luminance of the HDR output</h2>
    <canvas #canvas class="block h-24 w-full" role="img" [attr.aria-label]="summary()"></canvas>
    <p class="hint">
      <span class="mr-1 inline-block size-2.5 rounded-sm bg-ok" aria-hidden="true"></span>SDR white
      <span class="mr-1 ml-3 inline-block size-2.5 rounded-sm bg-peak" aria-hidden="true"></span>
      content peak · nits, log scale
    </p>
  `,
})
export class LuminanceHistogram {
  /** Pixel counts per luminance bin, as `luminanceHistogram` produces them. */
  readonly bins = input<Uint32Array>();
  readonly whiteNits = input.required<number>();
  readonly peakNits = input<number>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  /** Bumped when the canvas is resized, which also has to trigger a redraw. */
  private readonly resized = signal(0);

  protected readonly summary = computed(() => {
    const peak = this.peakNits();
    return peak === undefined
      ? 'Luminance histogram, no image rendered yet'
      : `Luminance histogram: content peak ${Math.round(peak)} nits, SDR white at ${Math.round(this.whiteNits())} nits`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.resized();
      const markers: HistogramMarker[] = [{ nits: this.whiteNits(), color: '#3ecf8e' }];
      const peak = this.peakNits();
      if (peak !== undefined) markers.push({ nits: peak, color: '#ffb224' });
      drawHistogram(this.canvas().nativeElement, this.bins() ?? new Uint32Array(1), markers);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.resized.update((count) => count + 1));
      afterRenderEffect(() => observer.observe(this.canvas().nativeElement));
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }
}
