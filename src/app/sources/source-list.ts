import { Component, inject } from '@angular/core';
import { WorkspaceStore } from '../state/workspace-store';

/** The loaded images, the way to open more, and what went wrong with the ones that did not load. */
@Component({
  selector: 'app-source-list',
  host: { class: 'panel' },
  template: `
    <h2 class="panel-title">Images</h2>
    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      @for (file of workspace.files(); track file.id) {
        <li class="flex gap-1">
          <button
            type="button"
            class="min-w-0 flex-1 truncate rounded border px-3 py-2 text-left text-sm"
            [class]="
              file.id === workspace.selectedId()
                ? 'border-accent bg-page text-ink'
                : 'border-transparent text-ink hover:border-line'
            "
            [attr.aria-pressed]="file.id === workspace.selectedId()"
            [title]="file.meta.name"
            (click)="workspace.select(file.id)"
          >
            {{ file.meta.name }}
          </button>
          <button
            type="button"
            class="btn btn-secondary px-3"
            [attr.aria-label]="'Remove ' + file.meta.name"
            (click)="workspace.remove(file.id)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </li>
      } @empty {
        <li class="text-sm text-muted">Nothing loaded.</li>
      }
    </ul>

    <button type="button" class="btn btn-primary" (click)="picker.click()">Open PNG / JPEG…</button>
    <input
      #picker
      type="file"
      class="hidden"
      accept="image/png,image/jpeg"
      multiple
      tabindex="-1"
      aria-hidden="true"
      (change)="onPicked($event)"
    />
    <p class="hint">Or drop / paste image files anywhere on the page.</p>

    @if (workspace.loading(); as name) {
      <p class="hint" role="status">Loading {{ name }}…</p>
    }
    @for (error of workspace.loadErrors(); track error) {
      <p class="warning" role="alert">{{ error }}</p>
    }
  `,
})
export class SourceList {
  protected readonly workspace = inject(WorkspaceStore);

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // reset, so that picking the same file again still fires `change`
    input.value = '';
    if (files.length) void this.workspace.open(files);
  }
}
