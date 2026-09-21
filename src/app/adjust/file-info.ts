import { Component, computed, input } from '@angular/core';
import type { FileMeta } from '../../lib/worker/protocol';
import type { LoadedFile } from '../state/workspace-store';

const COLOR_SPACE_NAMES: Record<FileMeta['colorSpace'], string> = {
  srgb: 'sRGB',
  'display-p3': 'Display P3',
  'rec2100-pq': 'Rec.2100 PQ (HDR)',
  unknown: 'Other (converted by the browser)',
};

/** What is known about the selected file, and the warnings its import produced. */
@Component({
  selector: 'app-file-info',
  host: { class: 'flex flex-col gap-2' },
  template: `
    <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      @for (row of rows(); track row.term) {
        <dt class="text-muted">{{ row.term }}</dt>
        <dd class="m-0 [overflow-wrap:anywhere]">{{ row.value }}</dd>
      }
    </dl>
    @for (warning of file().meta.warnings; track warning) {
      <p class="warning">{{ warning }}</p>
    }
  `,
})
export class FileInfo {
  readonly file = input.required<LoadedFile>();

  protected readonly rows = computed(() => {
    const { meta, sourceLevels } = this.file();
    return [
      { term: 'File', value: meta.name },
      {
        term: 'Size',
        value: `${meta.width} × ${meta.height}, ${meta.bitDepth}-bit ${meta.format.toUpperCase()}`,
      },
      { term: 'Color space', value: COLOR_SPACE_NAMES[meta.colorSpace] },
      { term: 'Profile', value: meta.colorSpaceLabel },
      {
        term: 'Source light',
        value: `peak ${Math.round(sourceLevels.maxCll)} nits, average ${Math.round(sourceLevels.maxFall)} nits`,
      },
    ];
  });
}
