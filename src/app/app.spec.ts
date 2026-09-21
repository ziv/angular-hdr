import { TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { App } from './app';
import { PipelineGateway } from './state/pipeline-gateway';
import { WorkspaceStore } from './state/workspace-store';
import {
  InProcessGateway,
  imageResponse,
  stubObjectUrls,
  testImageFile,
} from './testing/in-process-gateway';

describe('App', () => {
  const eventually = (assertion: () => void) =>
    vi.waitFor(() => {
      TestBed.tick();
      assertion();
    });

  async function renderLoaded() {
    const fixture = TestBed.createComponent(App);
    const element = fixture.nativeElement as HTMLElement;
    await eventually(() => expect(element.querySelectorAll('img').length).toBe(2));
    return { fixture, element };
  }

  beforeEach(async () => {
    stubObjectUrls();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse()),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: PipelineGateway, useClass: InProcessGateway }],
    }).compileComponents();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('should render the title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('HDR Image Tool');
  });

  it('opens the default image on start-up and shows it as original and HDR', async () => {
    const { element } = await renderLoaded();

    const titles = Array.from(
      element.querySelectorAll('figcaption strong'),
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Original', 'HDR']);
    expect(element.querySelector('figcaption')?.textContent).toContain('default.jpeg');
    const sources = Array.from(element.querySelectorAll('img'), (img) => img.getAttribute('src'));
    expect(new Set(sources).size).toBe(2);
    expect(element.querySelector('main [role=status]')?.textContent).toMatch(/peak \d+ nits/);
    expect(element.querySelector('app-source-list')?.textContent).toContain('default.jpeg');
  });

  it('opens files that are dropped or pasted anywhere on the page', async () => {
    const { element } = await renderLoaded();
    const workspace = TestBed.inject(WorkspaceStore);
    // jsdom has no DataTransfer; the handlers only need `types` and `files`
    const transfer = (file: File) => ({ types: ['Files'], files: [file] });
    const fire = (type: string, property: string, file: File) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, property, { value: transfer(file) });
      window.dispatchEvent(event);
      return event;
    };

    fire('dragover', 'dataTransfer', testImageFile('dropped.png'));
    TestBed.tick();
    expect(element.textContent).toContain('Drop PNG or JPEG files');

    const drop = fire('drop', 'dataTransfer', testImageFile('dropped.png'));
    expect(drop.defaultPrevented).toBe(true);
    await eventually(() => expect(workspace.selectedFile()?.meta.name).toBe('dropped.png'));
    expect(element.textContent).not.toContain('Drop PNG or JPEG files');

    fire('paste', 'clipboardData', testImageFile('pasted.png'));
    await eventually(() => expect(workspace.selectedFile()?.meta.name).toBe('pasted.png'));
    expect(workspace.files().map((file) => file.meta.name)).toEqual([
      'default.jpeg',
      'dropped.png',
      'pasted.png',
    ]);
  });

  it('has no accessibility violations that axe can detect', async () => {
    const { element } = await renderLoaded();
    document.body.append(element);
    // jsdom does no layout or painting, so color contrast is checked by hand (see plans.md)
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
