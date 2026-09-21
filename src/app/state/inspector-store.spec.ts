import { TestBed } from '@angular/core/testing';
import { InProcessGateway, stubObjectUrls, testImageFile } from '../testing/in-process-gateway';
import { InspectorStore } from './inspector-store';
import { PipelineGateway } from './pipeline-gateway';
import { PreviewStore } from './preview-store';
import { WorkspaceStore } from './workspace-store';

describe('InspectorStore', () => {
  let workspace: WorkspaceStore;
  let preview: PreviewStore;
  let inspector: InspectorStore;

  const eventually = (assertion: () => void) =>
    vi.waitFor(() => {
      TestBed.tick();
      assertion();
    });

  beforeEach(async () => {
    stubObjectUrls();
    TestBed.configureTestingModule({
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    });
    workspace = TestBed.inject(WorkspaceStore);
    preview = TestBed.inject(PreviewStore);
    inspector = TestBed.inject(InspectorStore);
    await workspace.open(testImageFile('wide.png', 40, 20));
    await eventually(() => expect(preview.result()).toBeDefined());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows nothing while the pointer is not over an image', () => {
    expect(inspector.readout()).toBeUndefined();
  });

  it('reads the hovered pixel from the original and the HDR image', async () => {
    // bottom right: red and green at full scale
    inspector.hover.set({ u: 0.999, v: 0.999 });
    await eventually(() => expect(inspector.readout()).toBeDefined());

    const readout = inspector.readout()!;
    expect(readout).toMatch(
      /^x 39, y 19 {2}· {2}Original \S+ \/ \S+ \/ \S+ nits {2}· {2}HDR .+ nits = PQ \d+ \/ \d+ \/ \d+$/,
    );

    inspector.hover.set(null);
    TestBed.tick();
    expect(inspector.readout()).toBeUndefined();
  });

  it('follows the adjustments', async () => {
    inspector.hover.set({ u: 0.999, v: 0.999 });
    await eventually(() => expect(inspector.readout()).toBeDefined());
    const before = inspector.readout();

    workspace.adjustments.update((current) => ({ ...current, exposureStops: -1 }));
    await eventually(() => expect(inspector.readout()).not.toBe(before));
    expect(inspector.readout()).toContain('x 39, y 19');
  });

  it('clamps positions at the image edge', async () => {
    inspector.hover.set({ u: 1.2, v: -0.1 });
    await eventually(() => expect(inspector.readout()).toContain('x 39, y 0'));
  });
});
