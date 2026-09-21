import { TestBed } from '@angular/core/testing';
import { DEFAULT_ADJUSTMENTS } from '../../lib/color/adjust';
import {
  InProcessGateway,
  imageResponse,
  stubObjectUrls,
  testImageFile,
} from '../testing/in-process-gateway';
import { PipelineGateway } from './pipeline-gateway';
import { WorkspaceStore } from './workspace-store';

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;
  let gateway: InProcessGateway;
  let urls: ReturnType<typeof stubObjectUrls>;

  beforeEach(() => {
    urls = stubObjectUrls();
    TestBed.configureTestingModule({
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    });
    store = TestBed.inject(WorkspaceStore);
    gateway = TestBed.inject(PipelineGateway) as unknown as InProcessGateway;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts empty', () => {
    expect(store.files()).toEqual([]);
    expect(store.selectedFile()).toBeUndefined();
    expect(store.source()).toBeUndefined();
    expect(store.baseName()).toBeUndefined();
  });

  it('opens files, selects the last one and keeps the errors of the others', async () => {
    const broken = new File([new Uint8Array([1, 2, 3, 4])], 'broken.gif');
    await store.open([testImageFile('first.png'), broken, testImageFile('second.final.png')]);

    expect(store.files().map((file) => file.meta.name)).toEqual(['first.png', 'second.final.png']);
    expect(store.files()[0].meta).toMatchObject({ width: 24, height: 16, bitDepth: 16 });
    expect(store.files()[0].originalUrl).toMatch(/^blob:/);
    expect(store.selectedFile()?.meta.name).toBe('second.final.png');
    expect(store.baseName()).toBe('second.final');
    expect(store.loadErrors()).toEqual(['broken.gif: Only PNG and JPEG files are supported']);
    expect(store.loading()).toBeNull();
    expect(store.source()).toEqual({ id: store.selectedId(), adjustments: DEFAULT_ADJUSTMENTS });
  });

  it('puts the adjustments into the source and resets them', async () => {
    await store.open([testImageFile()]);
    store.adjustments.update((current) => ({ ...current, boost: true, peakNits: 1600 }));
    expect(store.source()?.adjustments).toMatchObject({ boost: true, peakNits: 1600 });
    store.resetAdjustments();
    expect(store.source()?.adjustments).toEqual(DEFAULT_ADJUSTMENTS);
  });

  it('selects only files it knows', async () => {
    await store.open([testImageFile('a.png'), testImageFile('b.png')]);
    const [a, b] = store.files();
    store.select(a.id);
    expect(store.selectedId()).toBe(a.id);
    store.select(999);
    expect(store.selectedId()).toBe(a.id);
    store.select(b.id);
    expect(store.selectedFile()).toBe(b);
  });

  it('removes a file everywhere and hands the selection to its neighbour', async () => {
    await store.open([testImageFile('a.png'), testImageFile('b.png'), testImageFile('c.png')]);
    const [a, b, c] = store.files();

    store.remove(a.id);
    expect(store.selectedId()).toBe(c.id);
    expect(urls.revoke).toHaveBeenCalledWith(a.originalUrl);
    expect(gateway.removed).toEqual([a.id]);

    store.remove(c.id);
    expect(store.selectedId()).toBe(b.id);
    store.remove(b.id);
    expect(store.files()).toEqual([]);
    expect(store.selectedId()).toBeNull();
    expect(store.source()).toBeUndefined();

    store.remove(b.id);
    expect(gateway.removed).toEqual([a.id, c.id, b.id]);
  });

  it('opens the bundled default image like any other file', async () => {
    const image = testImageFile('ignored.png');
    const fetchMock = vi.fn(async (_url: URL) => imageResponse(image));
    vi.stubGlobal('fetch', fetchMock);

    await store.loadDefault();

    expect(String(fetchMock.mock.calls[0][0])).toBe(new URL('default.jpeg', document.baseURI).href);
    expect(store.files().map((file) => file.meta.name)).toEqual(['default.jpeg']);
    expect(store.selectedFile()?.meta.name).toBe('default.jpeg');
    expect(store.loadErrors()).toEqual([]);
  });

  it('reports a missing default image and stays usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await store.loadDefault();
    expect(store.files()).toEqual([]);
    expect(store.loadErrors()).toEqual(['default.jpeg: HTTP 404']);

    await store.open([testImageFile()]);
    expect(store.files().length).toBe(1);
    expect(store.loadErrors()).toEqual([]);
  });
});
