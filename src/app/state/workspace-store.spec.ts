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
    expect(store.file()).toBeUndefined();
    expect(store.source()).toBeUndefined();
    expect(store.baseName()).toBeUndefined();
    expect(store.loadError()).toBeNull();
  });

  it('opens an image', async () => {
    await store.open(testImageFile('photo.final.png'));

    expect(store.file()?.meta).toMatchObject({
      name: 'photo.final.png',
      width: 24,
      height: 16,
      bitDepth: 16,
    });
    expect(store.file()?.originalUrl).toMatch(/^blob:/);
    expect(store.baseName()).toBe('photo.final');
    expect(store.loading()).toBeNull();
    expect(store.source()).toEqual({ id: store.file()!.id, adjustments: DEFAULT_ADJUSTMENTS });
  });

  it('replaces the current image and forgets the previous one everywhere', async () => {
    await store.open(testImageFile('first.png'));
    const first = store.file()!;
    expect(gateway.removed).toEqual([]);

    await store.open(testImageFile('second.png'));
    expect(store.file()?.meta.name).toBe('second.png');
    expect(store.file()?.id).not.toBe(first.id);
    expect(urls.revoke).toHaveBeenCalledWith(first.originalUrl);
    expect(gateway.removed).toEqual([first.id]);
  });

  it('keeps the current image when the new file cannot be loaded, and clears the error on the next success', async () => {
    await store.open(testImageFile('good.png'));
    const good = store.file();

    await store.open(new File([new Uint8Array([1, 2, 3, 4])], 'broken.gif'));
    expect(store.file()).toBe(good);
    expect(store.loadError()).toBe('broken.gif: Only PNG and JPEG files are supported');
    expect(gateway.removed).toEqual([]);

    await store.open(testImageFile('next.png'));
    expect(store.loadError()).toBeNull();
    expect(store.file()?.meta.name).toBe('next.png');
  });

  it('keeps the adjustments across images, puts them into the source and resets them', async () => {
    await store.open(testImageFile('a.png'));
    store.adjustments.update((current) => ({ ...current, boost: true, peakNits: 1600 }));
    await store.open(testImageFile('b.png'));
    expect(store.source()?.adjustments).toMatchObject({ boost: true, peakNits: 1600 });

    store.resetAdjustments();
    expect(store.source()?.adjustments).toEqual(DEFAULT_ADJUSTMENTS);
  });

  it('opens the bundled default image like any other file', async () => {
    const fetchMock = vi.fn(async (_url: URL) => imageResponse(testImageFile('ignored.png')));
    vi.stubGlobal('fetch', fetchMock);

    await store.loadDefault();

    expect(String(fetchMock.mock.calls[0][0])).toBe(new URL('default.jpeg', document.baseURI).href);
    expect(store.file()?.meta.name).toBe('default.jpeg');
    expect(store.loadError()).toBeNull();
  });

  it('reports a missing default image and stays usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await store.loadDefault();
    expect(store.file()).toBeUndefined();
    expect(store.loadError()).toBe('default.jpeg: HTTP 404');

    await store.open(testImageFile());
    expect(store.file()).toBeDefined();
    expect(store.loadError()).toBeNull();
  });
});
