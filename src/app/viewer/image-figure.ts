import { Component, input, output } from '@angular/core';
import type { HoverPosition } from '../state/inspector-store';

/** One of the images of the viewer with its title and caption; content below the caption is projected. */
@Component({
  selector: 'app-image-figure',
  host: { class: 'flex min-w-0 flex-1 basis-0 flex-col items-center gap-2' },
  template: `
    <figure class="m-0 flex w-full flex-col items-center gap-2">
      @if (src(); as url) {
        <!-- A runtime blob: URL, which NgOptimizedImage does not support. -->
        <img
          class="block max-h-[60vh] max-w-full cursor-crosshair border border-line [dynamic-range-limit:no-limit]"
          [src]="url"
          [alt]="alt()"
          (pointermove)="onPointerMove($event)"
          (pointerleave)="leave.emit()"
        />
      } @else {
        <div
          class="flex aspect-square max-h-[60vh] w-full items-center justify-center border border-dashed border-line text-sm text-muted"
        >
          Rendering…
        </div>
      }
      <figcaption class="text-center text-xs text-muted [overflow-wrap:anywhere]">
        <strong class="mr-1 font-semibold text-ink">{{ title() }}</strong>
        {{ caption() }}
      </figcaption>
    </figure>
    <ng-content />
  `,
})
export class ImageFigure {
  readonly title = input.required<string>();
  readonly caption = input.required<string>();
  readonly alt = input.required<string>();
  /** URL of the image; a placeholder is shown until there is one. */
  readonly src = input<string>();

  /** The pointer's position over the image, as fractions of its size. */
  readonly hover = output<HoverPosition>();
  readonly leave = output<void>();

  protected onPointerMove(event: PointerEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.hover.emit({
      u: (event.clientX - box.left) / box.width,
      v: (event.clientY - box.top) / box.height,
    });
  }
}
