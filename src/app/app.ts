import { Component, inject, signal } from '@angular/core';
import { AdjustPanel } from './adjust/adjust-panel';
import { LuminanceHistogram } from './histogram/luminance-histogram';
import { AppHeader } from './shell/app-header';
import { InspectorReadout } from './shell/inspector-readout';
import { StatusLine } from './shell/status-line';
import { SourceList } from './sources/source-list';
import { PreviewStore } from './state/preview-store';
import { WorkspaceStore } from './state/workspace-store';
import { Viewer } from './viewer/viewer';

const draggedFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));

@Component({
  selector: 'app-root',
  imports: [
    AppHeader,
    Viewer,
    StatusLine,
    InspectorReadout,
    SourceList,
    AdjustPanel,
    LuminanceHistogram,
  ],
  // Files can be dropped or pasted anywhere on the page, so these listen on the window.
  host: {
    '(window:dragover)': 'onDragOver($event)',
    '(window:dragleave)': 'onDragLeave($event)',
    '(window:drop)': 'onDrop($event)',
    '(window:paste)': 'onPaste($event)',
  },
  template: `
    <app-header />

    <main>
      <app-viewer />
      <app-status-line />
      <app-inspector-readout />

      <div class="grid items-start gap-6 p-6 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
        <app-source-list />
        <app-adjust-panel />
        <app-luminance-histogram
          [bins]="preview.result()?.histogram"
          [whiteNits]="workspace.adjustments().whiteNits"
          [peakNits]="preview.result()?.lightLevels?.maxCll"
        />
      </div>
    </main>

    @if (dragging()) {
      <div
        class="pointer-events-none fixed inset-0 grid place-items-center border-4 border-dashed border-accent bg-page/85 text-2xl"
        aria-hidden="true"
      >
        Drop PNG or JPEG files
      </div>
    }
  `,
})
export class App {
  protected readonly workspace = inject(WorkspaceStore);
  protected readonly preview = inject(PreviewStore);

  protected readonly dragging = signal(false);

  constructor() {
    // The app never starts empty: the bundled default image is opened like a file the user picked.
    void this.workspace.loadDefault();
  }

  protected onDragOver(event: DragEvent): void {
    if (!draggedFiles(event)) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    // leaving the window, not just moving between elements
    if (!event.relatedTarget) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!draggedFiles(event)) return;
    event.preventDefault();
    this.dragging.set(false);
    void this.workspace.open(Array.from(event.dataTransfer?.files ?? []));
  }

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) void this.workspace.open(files);
  }
}
