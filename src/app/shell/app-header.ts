import { Component, inject } from '@angular/core';
import { DisplayCapability } from '../state/display-capability';

/** Title bar with a badge that tells whether the browser sees an HDR display. */
@Component({
  selector: 'app-header',
  template: `
    <header class="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4">
      <h1 class="text-xl font-semibold">HDR Image Tool</h1>
      <span
        class="rounded-full border px-3 py-0.5 text-xs"
        [class]="display.isHdr() ? 'border-ok text-ok' : 'border-line text-muted'"
      >
        {{
          display.isHdr()
            ? 'HDR display'
            : 'SDR display — files are still valid, the preview is tone mapped'
        }}
      </span>
    </header>
  `,
})
export class AppHeader {
  protected readonly display = inject(DisplayCapability);
}
