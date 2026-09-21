import { DOCUMENT, DestroyRef, Service, inject, signal } from '@angular/core';

/** Whether the browser reports the current display as HDR capable; follows the window between displays. */
@Service()
export class DisplayCapability {
  private readonly query = inject(DOCUMENT).defaultView?.matchMedia?.('(dynamic-range: high)');
  private readonly isHdrState = signal(this.query?.matches ?? false);

  readonly isHdr = this.isHdrState.asReadonly();

  constructor() {
    const query = this.query;
    if (!query) return;
    const update = () => this.isHdrState.set(query.matches);
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
