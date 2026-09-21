import { Service, computed, inject, resource, signal } from '@angular/core';
import { nitsToPqCode } from '../../lib/color/convert';
import { PipelineGateway } from './pipeline-gateway';
import { PreviewStore } from './preview-store';

/** A position inside an image, as fractions of its width and height. */
export interface HoverPosition {
  u: number;
  v: number;
}

function formatNits(nits: number): string {
  return nits >= 100 ? nits.toFixed(0) : nits >= 1 ? nits.toFixed(1) : nits.toFixed(3);
}

const clampIndex = (fraction: number, size: number) =>
  Math.min(Math.max(Math.floor(fraction * size), 0), size - 1);

/** Reads the pixel under the pointer from both images at once. */
@Service()
export class InspectorStore {
  private readonly gateway = inject(PipelineGateway);
  private readonly preview = inject(PreviewStore);

  /** Where the pointer is, or null while it is not over an image. */
  readonly hover = signal<HoverPosition | null>(null);

  private readonly pixel = resource({
    params: () => {
      const hover = this.hover();
      const render = this.preview.result();
      if (!hover || !render) return undefined;
      return {
        x: clampIndex(hover.u, render.width),
        y: clampIndex(hover.v, render.height),
        render,
      };
    },
    loader: ({ params }) => this.gateway.inspect(params.x, params.y),
  });

  /** The values as text, or undefined when there is nothing to show. */
  readonly readout = computed(() => {
    const hover = this.hover();
    const render = this.preview.result();
    const pixel = this.pixel.hasValue() ? this.pixel.value() : undefined;
    if (!hover || !render || !pixel) return undefined;

    const nits = (rgb: number[]) => rgb.map(formatNits).join(' / ');
    const codes = pixel.hdr.map((value) => Math.round(nitsToPqCode(value))).join(' / ');
    return [
      `x ${clampIndex(hover.u, render.fullWidth)}, y ${clampIndex(hover.v, render.fullHeight)}`,
      `Original ${nits(pixel.original)} nits`,
      `HDR ${nits(pixel.hdr)} nits = PQ ${codes}`,
    ].join('  ·  ');
  });
}
