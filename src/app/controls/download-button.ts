import { Component, computed, inject } from '@angular/core';
import { DownloadStore } from '../state/download-store';
import { WorkspaceStore } from '../state/workspace-store';

/**
 * Downloads the converted image as a full resolution HDR PNG. While that is being encoded the
 * button shows the progress and a second click cancels.
 */
@Component({
  selector: 'app-download-button',
  template: `
    <button
      type="button"
      class="btn btn-primary min-w-40"
      [disabled]="disabled()"
      [attr.aria-busy]="busy()"
      (click)="busy() ? downloads.cancel() : downloads.start('hdr')"
    >
      {{ label() }}<span class="sr-only"> HDR PNG</span>
    </button>
  `,
})
export class DownloadButton {
  protected readonly downloads = inject(DownloadStore);
  private readonly workspace = inject(WorkspaceStore);

  protected readonly busy = computed(() => this.downloads.active() !== null);
  protected readonly disabled = computed(() => !this.workspace.source());
  protected readonly label = computed(() => {
    const active = this.downloads.active();
    return active && this.busy()
      ? `Encoding ${Math.round(active.fraction * 100)}% — cancel`
      : 'Download';
  });
}
