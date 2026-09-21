import { Component, inject } from '@angular/core';
import { InspectorStore } from '../state/inspector-store';

/** Pixel values under the pointer. It changes with every pointer move, so it is deliberately not a live region. */
@Component({
  selector: 'app-inspector-readout',
  template: `
    <p class="mx-6 mt-1 min-h-5 text-center text-xs whitespace-pre-wrap text-muted tabular-nums">
      {{ inspector.readout() ?? 'Hover over an image to compare pixel values (R / G / B).' }}
    </p>
  `,
})
export class InspectorReadout {
  protected readonly inspector = inject(InspectorStore);
}
