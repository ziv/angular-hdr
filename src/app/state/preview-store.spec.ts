import { TestBed } from '@angular/core/testing';
import { InProcessGateway, stubObjectUrls, testImageFile } from '../testing/in-process-gateway';
import { PipelineGateway } from './pipeline-gateway';
import { PreviewStore } from './preview-store';
import { WorkspaceStore } from './workspace-store';

describe('PreviewStore', () => {
  let workspace: WorkspaceStore;
  let preview: PreviewStore;
  let gateway: InProcessGateway;
  let urls: ReturnType<typeof stubObjectUrls>;

  /** Waits until the debounce, the render and the effects behind them have settled on the expectation. */
  const eventually = (assertion: () => void) =>
    vi.waitFor(() => {
      TestBed.tick();
      assertion();
    });

  beforeEach(() => {
    urls = stubObjectUrls();
    TestBed.configureTestingModule({
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    });
    workspace = TestBed.inject(WorkspaceStore);
    preview = TestBed.inject(PreviewStore);
    gateway = TestBed.inject(PipelineGateway) as unknown as InProcessGateway;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('has nothing to show without a file', () => {
    TestBed.tick();
    expect(preview.result()).toBeUndefined();
    expect(preview.hdrUrl()).toBeUndefined();
    expect(preview.status()).toBe('Open an image to get started.');
  });

  it('renders the selected file into an HDR preview', async () => {
    await workspace.open([testImageFile()]);
    await eventually(() => expect(preview.hdrUrl()).toBeDefined());

    expect(preview.result()).toMatchObject({
      width: 24,
      height: 16,
      fullWidth: 24,
      fullHeight: 16,
    });
    expect(preview.hdrUrl()).toBe('blob:test/2');
    expect(preview.status()).toMatch(/^24×16 · peak \d+ nits, average \d+ nits · \d+ ms$/);
  });

  it('renders again when the adjustments change, keeps the old preview meanwhile and releases its URL', async () => {
    await workspace.open([testImageFile()]);
    await eventually(() => expect(preview.hdrUrl()).toBeDefined());
    const first = preview.hdrUrl()!;
    const firstPeak = preview.result()!.lightLevels.maxCll;

    workspace.adjustments.update((current) => ({ ...current, boost: true, peakNits: 1600 }));
    TestBed.tick();
    expect(preview.hdrUrl()).toEqual(first);

    await eventually(() => expect(preview.hdrUrl()).not.toEqual(first));
    expect(preview.result()!.lightLevels.maxCll).toBeGreaterThan(firstPeak * 3);
    expect(urls.revoke).toHaveBeenCalledWith(first);
  });

  it('collapses a burst of changes into one render', async () => {
    await workspace.open([testImageFile()]);
    await eventually(() => expect(gateway.renders.length).toBe(1));

    for (const exposureStops of [0.1, 0.2, 0.3, 0.4]) {
      workspace.adjustments.update((current) => ({ ...current, exposureStops }));
      TestBed.tick();
    }
    await eventually(() => expect(gateway.renders.at(-1)?.adjustments.exposureStops).toBe(0.4));
    expect(gateway.renders.length).toBe(2);
  });

  it('clears the preview when the last file is removed', async () => {
    await workspace.open([testImageFile()]);
    await eventually(() => expect(preview.hdrUrl()).toBeDefined());

    workspace.remove(workspace.selectedId()!);
    await eventually(() => expect(preview.hdrUrl()).toBeUndefined());
    expect(preview.status()).toBe('Open an image to get started.');
  });
});
