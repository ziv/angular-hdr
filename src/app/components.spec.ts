import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { DEFAULT_ADJUSTMENTS } from '../lib/color/adjust';
import { AdjustPanel } from './adjust/adjust-panel';
import { DownloadButton } from './controls/download-button';
import { ImagePicker } from './image/image-picker';
import { DownloadStore } from './state/download-store';
import { PipelineGateway } from './state/pipeline-gateway';
import { WorkspaceStore } from './state/workspace-store';
import { InProcessGateway, stubObjectUrls, testImageFile } from './testing/in-process-gateway';
import { Viewer } from './viewer/viewer';

describe('components', () => {
  let workspace: WorkspaceStore;

  const eventually = (assertion: () => void) =>
    vi.waitFor(() => {
      TestBed.tick();
      assertion();
    });

  function render<T>(component: new () => T): {
    fixture: ComponentFixture<T>;
    element: HTMLElement;
  } {
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    stubObjectUrls();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    });
    workspace = TestBed.inject(WorkspaceStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Viewer', () => {
    it('says so when nothing is loaded', () => {
      const { element } = render(Viewer);
      expect(element.querySelectorAll('figure').length).toBe(0);
      expect(element.textContent).toContain('No image loaded');
    });

    it('shows the original next to the HDR output, each with its own download', async () => {
      await workspace.open(testImageFile('cat.png'));
      const { element } = render(Viewer);
      await eventually(() => expect(element.querySelectorAll('img').length).toBe(2));

      expect(element.querySelectorAll('figure').length).toBe(2);
      const titles = Array.from(
        element.querySelectorAll('figcaption strong'),
        (el) => el.textContent,
      );
      expect(titles).toEqual(['Original', 'HDR']);
      const original = element.querySelector('a')!;
      expect(original.getAttribute('download')).toBe('cat.png');
      expect(original.getAttribute('href')).toBe(workspace.file()!.originalUrl);
      const buttons = Array.from(element.querySelectorAll('app-download-button button'));
      expect(buttons.map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'Download HDR PNG',
      ]);
    });
  });

  describe('DownloadButton', () => {
    function renderButton() {
      const { fixture, element } = render(DownloadButton);
      return { fixture, button: element.querySelector('button')! };
    }

    it('is disabled without an image', () => {
      expect(renderButton().button.disabled).toBe(true);
    });

    it('shows the progress and cancels on a second click', async () => {
      await workspace.open(testImageFile());
      const { fixture, button } = renderButton();
      const downloads = TestBed.inject(DownloadStore);
      expect(button.disabled).toBe(false);

      button.click();
      fixture.detectChanges();
      expect(button.textContent).toContain('Encoding 0% — cancel');
      expect(button.getAttribute('aria-busy')).toBe('true');

      button.click();
      await eventually(() => expect(downloads.message()).toBe('Download cancelled.'));
      fixture.detectChanges();
      expect(button.textContent).toContain('Download');
      expect(button.getAttribute('aria-busy')).toBe('false');
    });
  });

  describe('ImagePicker', () => {
    function pick(element: HTMLElement, files: File[]) {
      const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      input.dispatchEvent(new Event('change'));
      return input;
    }

    it('opens the picked file as the current image', async () => {
      const { element } = render(ImagePicker);
      const input = pick(element, [testImageFile('picked.png')]);

      await eventually(() => expect(workspace.file()?.meta.name).toBe('picked.png'));
      expect(input.multiple).toBe(false);
      expect(element.querySelector('[role=alert]')).toBeNull();
    });

    it('says what went wrong and leaves the current image alone', async () => {
      await workspace.open(testImageFile('current.png'));
      const { fixture, element } = render(ImagePicker);
      pick(element, [new File(['nope'], 'notes.txt')]);

      await eventually(() => expect(workspace.loadError()).not.toBeNull());
      fixture.detectChanges();
      expect(element.querySelector('[role=alert]')?.textContent).toContain(
        'notes.txt: Only PNG and JPEG',
      );
      expect(workspace.file()?.meta.name).toBe('current.png');
    });
  });

  describe('AdjustPanel', () => {
    function slider(element: HTMLElement, label: string): HTMLInputElement {
      const field = Array.from(element.querySelectorAll('app-slider-field')).find((candidate) =>
        candidate.textContent?.includes(label),
      );
      return field!.querySelector('input')!;
    }

    function move(input: HTMLInputElement, value: number) {
      input.value = String(value);
      input.dispatchEvent(new Event('input'));
    }

    it('writes the sliders into the adjustments, converting display units', async () => {
      await workspace.open(testImageFile());
      const { fixture, element } = render(AdjustPanel);

      move(slider(element, 'SDR white level'), 300);
      move(slider(element, 'Exposure'), 0.5);
      move(slider(element, 'Color expansion'), 40);
      fixture.detectChanges();

      expect(workspace.adjustments()).toMatchObject({
        whiteNits: 300,
        exposureStops: 0.5,
        gamutExpansion: 0.4,
      });
      expect(element.textContent).toContain('300 nits');
      expect(element.textContent).toContain('40 %');
      expect(slider(element, 'SDR white level').getAttribute('aria-valuetext')).toBe('300 nits');
    });

    it('enables the knee slider only while the boost is on, and resets everything', async () => {
      await workspace.open(testImageFile());
      const { fixture, element } = render(AdjustPanel);
      const knee = slider(element, 'Boost starts at');
      expect(knee.disabled).toBe(true);
      expect(knee.value).toBe('75');

      element.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      fixture.detectChanges();
      expect(workspace.adjustments().boost).toBe(true);
      expect(knee.disabled).toBe(false);

      move(knee, 90);
      expect(workspace.adjustments().boostKnee).toBeCloseTo(0.787, 3);

      Array.from(element.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Reset'))!
        .click();
      fixture.detectChanges();
      expect(workspace.adjustments()).toEqual(DEFAULT_ADJUSTMENTS);
      expect(knee.disabled).toBe(true);
    });

    it('shows what is known about the file', async () => {
      await workspace.open(testImageFile('info.png', 24, 16));
      const { element } = render(AdjustPanel);
      const info = element.querySelector('dl')!.textContent!;
      expect(info).toContain('info.png');
      expect(info).toContain('24 × 16, 16-bit PNG');
      expect(info).toContain('sRGB');
    });
  });
});
