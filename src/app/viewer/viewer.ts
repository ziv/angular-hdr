import { Component, inject } from '@angular/core';
import { DownloadButton } from '../controls/download-button';
import { InspectorStore } from '../state/inspector-store';
import { PreviewStore } from '../state/preview-store';
import { WorkspaceStore } from '../state/workspace-store';
import { ImageFigure } from './image-figure';

/** The selected file next to its HDR conversion, each with its download. */
@Component({
  selector: 'app-viewer',
  imports: [ImageFigure, DownloadButton],
  template: `
    @if (workspace.selectedFile(); as file) {
      <section
        class="flex flex-col items-stretch gap-4 px-6 pt-6 lg:flex-row lg:items-start lg:justify-center"
        aria-label="Original image and HDR output"
      >
        <app-image-figure
          title="Original"
          [caption]="file.meta.name + ' · ' + file.meta.colorSpaceLabel"
          [alt]="file.meta.name + ' as it was opened'"
          [src]="file.originalUrl"
          (hover)="inspector.hover.set($event)"
          (leave)="inspector.hover.set(null)"
        >
          <a
            class="btn btn-secondary min-w-40"
            [href]="file.originalUrl"
            [download]="file.meta.name"
          >
            Download<span class="sr-only"> the original file</span>
          </a>
        </app-image-figure>
        <app-image-figure
          title="HDR"
          caption="Rec.2100 PQ · rec2100-pq.icc · 16-bit"
          [alt]="file.meta.name + ' converted to HDR'"
          [src]="preview.hdrUrl()"
          (hover)="inspector.hover.set($event)"
          (leave)="inspector.hover.set(null)"
        >
          <app-download-button />
        </app-image-figure>
      </section>
    } @else {
      <p class="px-6 pt-10 text-center text-muted">No image loaded. Open one below.</p>
    }
  `,
})
export class Viewer {
  protected readonly workspace = inject(WorkspaceStore);
  protected readonly preview = inject(PreviewStore);
  protected readonly inspector = inject(InspectorStore);
}
