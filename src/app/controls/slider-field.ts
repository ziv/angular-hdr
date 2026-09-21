import { Component, computed, input, model } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';

const identity = (value: number) => value;

/**
 * A labelled range input with a readout, usable as a Signal Forms control: `[formField]="form.exposure"`.
 * The slider can show another scale than the model holds (a percentage for a 0..1 amount, say) through
 * the `toDisplay` / `fromDisplay` pair.
 */
@Component({
  selector: 'app-slider-field',
  host: { class: 'block' },
  template: `
    <label class="flex flex-col gap-1 text-sm text-muted">
      <span class="flex justify-between gap-2">
        {{ label() }}
        <span class="text-ink tabular-nums" aria-hidden="true">{{ valueText() }}</span>
      </span>
      <input
        type="range"
        class="w-full accent-accent disabled:opacity-40"
        [min]="rangeMin()"
        [max]="rangeMax()"
        [step]="step()"
        [value]="shown()"
        [disabled]="disabled()"
        [attr.aria-valuetext]="valueText()"
        (input)="onInput($event)"
      />
    </label>
  `,
})
export class SliderField implements FormValueControl<number> {
  readonly value = model(0);
  readonly disabled = input(false);

  readonly label = input.required<string>();
  readonly unit = input.required<string>();
  readonly rangeMin = input.required<number>();
  readonly rangeMax = input.required<number>();
  readonly step = input(1);
  readonly toDisplay = input<(value: number) => number>(identity);
  readonly fromDisplay = input<(shown: number) => number>(identity);

  protected readonly shown = computed(() => this.toDisplay()(this.value()));
  protected readonly valueText = computed(() => `${this.shown()} ${this.unit()}`);

  protected onInput(event: Event): void {
    this.value.set(this.fromDisplay()((event.target as HTMLInputElement).valueAsNumber));
  }
}
