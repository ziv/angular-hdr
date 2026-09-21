import { Component, inject } from '@angular/core';
import { DownloadStore } from '../state/download-store';
import { PreviewStore } from '../state/preview-store';

/** What the preview shows right now, and how the last download went. Announced politely to screen readers. */
@Component({
  selector: 'app-status-line',
  template: `
    <p class="mx-6 mt-3 min-h-5 text-center text-xs text-muted" role="status">
      {{ preview.status() }}
      @if (downloads.message(); as message) {
        <span class="ml-2 text-ink">{{ message }}</span>
      }
    </p>
  `,
})
export class StatusLine {
  protected readonly preview = inject(PreviewStore);
  protected readonly downloads = inject(DownloadStore);
}
