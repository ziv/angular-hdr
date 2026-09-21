import { Component, inject } from '@angular/core';
import { FormField, disabled, form, max, min } from '@angular/forms/signals';
import { linearToSrgb, srgbToLinear } from '../../lib/color/transfer';
import { SliderField } from '../controls/slider-field';
import { WorkspaceStore } from '../state/workspace-store';
import { FileInfo } from './file-info';

/** The conversion settings of the selected image, as a Signal Form directly over the store's adjustments. */
@Component({
  selector: 'app-adjust-panel',
  imports: [FormField, SliderField, FileInfo],
  host: { class: 'panel' },
  template: `
    <h2 class="panel-title">Convert to HDR</h2>
    @if (workspace.file(); as file) {
      <app-file-info [file]="file" />
    }

    <app-slider-field
      [formField]="adjust.whiteNits"
      label="SDR white level"
      unit="nits"
      [rangeMin]="80"
      [rangeMax]="1000"
    />
    <app-slider-field
      [formField]="adjust.exposureStops"
      label="Exposure"
      unit="stops"
      [rangeMin]="-3"
      [rangeMax]="3"
      [step]="0.1"
    />
    <label class="flex items-center gap-2 text-sm text-muted">
      <input type="checkbox" class="accent-accent" [formField]="adjust.boost" />
      Boost highlights up to the peak
    </label>
    <app-slider-field
      [formField]="adjust.peakNits"
      label="Peak luminance"
      unit="nits"
      [rangeMin]="400"
      [rangeMax]="4000"
      [step]="50"
    />
    <app-slider-field
      [formField]="adjust.boostKnee"
      label="Boost starts at"
      unit="% signal"
      [rangeMin]="50"
      [rangeMax]="95"
      [toDisplay]="kneeToPercent"
      [fromDisplay]="percentToKnee"
    />
    <app-slider-field
      [formField]="adjust.gamutExpansion"
      label="Color expansion"
      unit="%"
      [rangeMin]="0"
      [rangeMax]="100"
      [toDisplay]="amountToPercent"
      [fromDisplay]="percentToAmount"
    />

    <button type="button" class="btn btn-secondary" (click)="workspace.resetAdjustments()">
      Reset adjustments
    </button>
  `,
})
export class AdjustPanel {
  protected readonly workspace = inject(WorkspaceStore);

  protected readonly adjust = form(this.workspace.adjustments, (path) => {
    min(path.whiteNits, 80);
    max(path.whiteNits, 1000);
    min(path.exposureStops, -3);
    max(path.exposureStops, 3);
    min(path.peakNits, 400);
    max(path.peakNits, 4000);
    min(path.gamutExpansion, 0);
    max(path.gamutExpansion, 1);
    disabled(path.boostKnee, ({ valueOf }) => !valueOf(path.boost));
  });

  // The knee is a linear fraction of white; people think of it as a percentage of the encoded signal.
  protected readonly kneeToPercent = (linear: number) => Math.round(linearToSrgb(linear) * 100);
  protected readonly percentToKnee = (percent: number) => srgbToLinear(percent / 100);
  protected readonly amountToPercent = (amount: number) => Math.round(amount * 100);
  protected readonly percentToAmount = (percent: number) => percent / 100;
}
