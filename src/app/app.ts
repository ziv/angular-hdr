import { Component, inject, signal } from '@angular/core';
import { AdjustPanel } from './adjust/adjust-panel';
import { LuminanceHistogram } from './histogram/luminance-histogram';
import { ImagePicker } from './image/image-picker';
import { AppHeader } from './shell/app-header';
import { InspectorReadout } from './shell/inspector-readout';
import { StatusLine } from './shell/status-line';
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
    ImagePicker,
    AdjustPanel,
    LuminanceHistogram,
  ],
  // An image can be dropped or pasted anywhere on the page, so these listen on the window.
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
        <app-image-picker />
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
        Drop a PNG or JPEG image
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
    this.openFirst(event.dataTransfer?.files);
  }

  protected onPaste(event: ClipboardEvent): void {
    this.openFirst(event.clipboardData?.files);
  }

  /** The app works on one image, so of several files only the first one is taken. */
  private openFirst(files: FileList | undefined): void {
    const file = files?.[0];
    if (file) void this.workspace.open(file);
  }
}
