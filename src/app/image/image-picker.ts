import { Component, inject } from '@angular/core';
import { WorkspaceStore } from '../state/workspace-store';

/** Replaces the current image with another file, and says what went wrong when that did not work. */
@Component({
  selector: 'app-image-picker',
  host: { class: 'panel' },
  template: `
    <h2 class="panel-title">Image</h2>
    <button type="button" class="btn btn-primary" (click)="picker.click()">Open PNG / JPEG…</button>
    <input
      #picker
      type="file"
      class="hidden"
      accept="image/png,image/jpeg"
      tabindex="-1"
      aria-hidden="true"
      (change)="onPicked($event)"
    />
    <p class="hint">Or drop / paste an image anywhere on the page. It replaces the current one.</p>

    @if (workspace.loading(); as name) {
      <p class="hint" role="status">Loading {{ name }}…</p>
    }
    @if (workspace.loadError(); as error) {
      <p class="warning" role="alert">{{ error }}</p>
    }
  `,
})
export class ImagePicker {
  protected readonly workspace = inject(WorkspaceStore);

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // reset, so that picking the same file again still fires `change`
    input.value = '';
    if (file) void this.workspace.open(file);
  }
}
