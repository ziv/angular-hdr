import { TestBed } from '@angular/core/testing';
import { decodePng } from '../../lib/png/decode';
import { InProcessGateway, stubObjectUrls, testImageFile } from '../testing/in-process-gateway';
import { DownloadStore } from './download-store';
import { PipelineGateway } from './pipeline-gateway';
import { WorkspaceStore } from './workspace-store';

describe('DownloadStore', () => {
  let workspace: WorkspaceStore;
  let downloads: DownloadStore;
  let saved: { name: string; blob: Blob }[];

  beforeEach(() => {
    saved = [];
    const urls = stubObjectUrls();
    const blobs: Blob[] = [];
    urls.create.mockImplementation((blob?: Blob) => `blob:test/${blobs.push(blob!)}`);
    // a "download" is a click on a temporary <a download>: record it instead of navigating
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, blob: blobs[Number(this.href.split('/').pop()) - 1] });
    });
    TestBed.configureTestingModule({
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    });
    workspace = TestBed.inject(WorkspaceStore);
    downloads = TestBed.inject(DownloadStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing without a file', async () => {
    await downloads.start('hdr');
    expect(saved).toEqual([]);
    expect(downloads.message()).toBeNull();
  });

  it('downloads the full resolution image in the requested format', async () => {
    await workspace.open([testImageFile('photo.png', 40, 30)]);

    const running = downloads.start('hdr');
    expect(downloads.active()).toEqual({ format: 'hdr', fraction: 0 });
    await running;
    expect(downloads.active()).toBeNull();
    expect(downloads.message()).toMatch(/^Downloaded photo-hdr\.png \(.+ KB\)\.$/);

    await downloads.start('sdr');
    expect(saved.map((file) => file.name)).toEqual(['photo-hdr.png', 'photo-sdr.png']);
    const [hdr, sdr] = await Promise.all(
      saved.map(async (file) => decodePng(new Uint8Array(await file.blob.arrayBuffer()))),
    );
    expect(hdr).toMatchObject({
      width: 40,
      height: 30,
      depth: 16,
      cicp: { primaries: 9, transfer: 16 },
    });
    expect(sdr).toMatchObject({ width: 40, height: 30, depth: 8 });
  });

  it('runs one download at a time and can cancel it', async () => {
    await workspace.open([testImageFile()]);

    const first = downloads.start('hdr');
    await downloads.start('sdr');
    expect(downloads.active()?.format).toBe('hdr');

    downloads.cancel();
    await first;
    expect(saved).toEqual([]);
    expect(downloads.active()).toBeNull();
    expect(downloads.message()).toBe('Download cancelled.');
  });
});
