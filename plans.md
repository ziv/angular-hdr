# Moving the HDR Image Tool into this Angular app — Plan

Source: the finished Vite + TypeScript app in `/Users/ziv.perry/code/hdr` (90 unit tests, verified in Chrome).
Target: this workspace — Angular 22.1 (zoneless, standalone, OnPush by default), TypeScript 6, Tailwind 4,
Vitest through `@angular/build:unit-test`, Prettier.

The move is a **port of the engine plus a rewrite of the UI**: everything that is not a component goes to
`src/lib` almost unchanged; the hand-written DOM code in the Vite app's `src/ui` is replaced by signal based
Angular components in `src/app`.

## 0. Ground rules

- `src/app/` — Angular only: components, stores / services, app config.
- `src/lib/` — everything else (color, png, icc, io, generate, worker, types). **No `@angular/*` import in
  `src/lib`**, so it stays plain TypeScript that runs unchanged in a worker and in Node tests.
- Modern Angular, as required by `CLAUDE.md`: standalone components (no `standalone: true`, no explicit `OnPush`),
  signals for all state, `input()` / `output()` / `model()`, `computed()` / `linkedSignal()`, `resource()` for async
  work, Signal Forms, native control flow, `inject()`, `@Service`, `host` object instead of `@HostListener`, class /
  style bindings instead of `ngClass` / `ngStyle`, WCAG AA + AXE clean.
- The app is zoneless (no `zone.js` in `package.json`): every async result must land in a signal, or the view will
  not update. No manual `detectChanges`, no RxJS where a signal does the job.
- Behavior stays what the Vite app does today:
  - viewer with **three images** — original file, HDR output (Rec.2100 PQ + `rec2100-pq.icc`), SDR output (tone
    mapped sRGB + `sRGB-v4.icc`); a generated pattern has no original and shows the two outputs;
  - a plain **Download** button under each image (single image, regular browser download; the HDR / SDR buttons show
    `Encoding NN% — cancel` and cancel on a second click, the other button waits);
  - status line + pixel inspector under the viewer; below that sources | controls | luminance histogram;
  - open button, drag & drop anywhere, paste; per-file load errors that stay visible.
- The Vite repo is the reference and is not modified. Every lib module is copied, then adapted (section 2).

## 1. Workspace preparation

- [x] Add runtime dependencies: `fast-png` (PNG decoding), `fflate` (zlib for our encoder and `iCCP`)
- [x] Add dev dependency `@types/node` and add `"node"` to `types` in `tsconfig.spec.json` (specs read the `.icc`
      files from disk, see 2.4)
- [x] Web worker support: `ng generate web-worker` gave `tsconfig.worker.json` (bumped to
      `lib: ["es2022", "webworker"]`) and `"webWorkerTsConfig"` in the `build` options of `angular.json`;
      `src/**/*.worker.ts` and `src/lib/testing/**` are excluded from `tsconfig.app.json`; the generated sample worker
      is deleted. The schematic also added `webWorkerTsConfig` to the `test` target, which the `unit-test` builder
      rejects ("must NOT have additional properties") — removed again
- [ ] **Node version:** Angular CLI 22 refuses Node 22.17.1 (the shell default here); it needs ≥ 22.22.3, ≥ 24.15 or
      26. All `ng` commands so far were run with `~/.nvm/versions/node/v24.19.0` on the `PATH`. Add an `.nvmrc`
      (`24`) or switch the default, and use the same version in CI
- [x] Color profiles: `public/rec2100-pq.icc` and `public/sRGB-v4.icc` are already there (byte-identical to the
      Vite app's) and end up in `dist/` — they are still untracked, `git add` them with the first commit. They are served from the site root by the existing
      `assets` entry, no `angular.json` change needed
- [x] `src/index.html`: title "HDR Image Tool", `<meta name="color-scheme" content="dark">`
- [x] Remove the starter content: "Hello" template and its spec in `src/app/app.ts` / `app.spec.ts`
- [x] Remove the router (decided): `app.routes.ts` deleted, `provideRouter` and `RouterOutlet` gone,
      `@angular/router` uninstalled. `App` is a bare shell with the title until A2
- [x] First production build: initial bundle 103 kB (budget warning at 500 kB), the worker is its own lazy chunk
      (`worker-*.js`, 54 kB). Re-check the budgets, including 4 kB per component style, once the UI exists (A3 / A4)

## 2. Port the engine to `src/lib`

### 2.1 File map

| Vite app (`/Users/ziv.perry/code/hdr/src`) | Here | Notes |
| --- | --- | --- |
| `types.ts` | `src/lib/types.ts` | as is |
| `color/transfer.ts`, `matrices.ts`, `convert.ts`, `adjust.ts`, `resize.ts`, `tonemap.ts`, `analyze.ts` | `src/lib/color/` | as is |
| `png/crc32.ts`, `chunks.ts`, `color-chunks.ts`, `decode.ts`, `encode.ts` | `src/lib/png/` | as is |
| `icc/identify.ts` | `src/lib/icc/` | as is |
| `io/format.ts`, `load.ts`, `export.ts` | `src/lib/io/` | as is |
| `io/profiles.ts` | `src/lib/io/profiles.ts` | **rewrite**: no Vite `?url` imports, see 2.3 |
| `io/save.ts` | `src/lib/io/download.ts` | as is (`downloadPng`); DOM only, never imported by the worker |
| `generate/draw.ts`, `patterns.ts` | `src/lib/generate/` | as is |
| `ui/pattern-panel.ts` → the `PATTERNS` table (labels, descriptions, default nits) and size limits | `src/lib/generate/pattern-info.ts` | data only, the form itself becomes a component |
| `ui/histogram.ts` (`drawHistogram`) | `src/lib/render/histogram.ts` | pure canvas drawing, called by the histogram component |
| `worker/protocol.ts`, `pipeline.ts`, `client.ts` | `src/lib/worker/` | as is, plus 2.3 |
| `worker/pipeline.worker.ts` | `src/lib/worker/pipeline.worker.ts` | simplify, see 2.2 |
| `ui/app.ts`, `ui/adjust-panel.ts`, `ui/pattern-panel.ts`, `style.css`, `main.ts` | — | **not ported**, replaced by section 3–5 |
| `*/*.test.ts` (7 files, 90 tests) | next to their sources as `*.spec.ts` | see 2.4 |

### 2.2 Adaptations every ported file needs

- [x] Drop the `.ts` extension from all relative imports (`'./transfer.ts'` → `'./transfer'`); this workspace has no
      `allowImportingTsExtensions`
- [x] Reformat with this repo's Prettier config (semicolons, `printWidth: 100`, single quotes) — the Vite code is
      semicolon-free and wider
- [x] Compile under the stricter flags here (`noPropertyAccessFromIndexSignature`, `noImplicitReturns`,
      `noImplicitOverride`, `isolatedModules`) and fix what they flag; keep `Uint8Array<ArrayBuffer>` signatures
- [x] `pipeline.worker.ts` is compiled with the `webworker` lib here, so the hand-written `WorkerScope` interface
      and the `self as unknown as …` cast can go; use the real `DedicatedWorkerGlobalScope` typings
- [x] Make sure everything the worker imports compiles under **both** `tsconfig.app.json` (DOM) and
      `tsconfig.worker.json` (WebWorker): `createImageBitmap`, `OffscreenCanvas`, `Blob`, `fetch` exist in both;
      nothing in the worker's import graph may touch `document` / `window`
- [x] `client.ts`: keep `new Worker(new URL('./pipeline.worker', import.meta.url), { type: 'module' })` exactly in
      this shape — it is the pattern the Angular builder detects and bundles

### 2.3 Color profiles without Vite

- [x] `createProfileLoader(baseUrl)` → `ProfileLoader`: `fetch(new URL('rec2100-pq.icc' | 'sRGB-v4.icc', baseUrl))`,
      cached per format, same `IccProfile` result as before
- [x] Inside a worker a relative URL resolves against the worker script, not against `<base href>`: add an `init`
      message to the protocol that carries the base URL; `new PipelineClient(baseUrl)` sends it first, and the
      worker builds its `Pipeline` with a loader bound to it (any other request before `init` is an error)
- [ ] Verify with a non-root `--base-href` build that both profiles still load (needs the UI, moved to section 8)

### 2.4 Tests

- [x] Rename `*.test.ts` → `*.spec.ts` (only `*.spec.ts` is part of `tsconfig.spec.json`); keep them next to the code
      in `src/lib/**`
- [x] Use the Vitest globals like the existing `app.spec.ts` (drop `import { describe, expect, it } from 'vitest'`)
- [x] Profile fixtures: replace `new URL('../assets/profiles/…', import.meta.url)` with one shared helper
      `src/lib/testing/profiles.ts` that reads `public/*.icc` with `node:fs` relative to the workspace root
- [x] **Risk checked:** `ng test` bundles specs with the application builder before Vitest runs them, and
      `node:fs` still works from a spec (tests run in Node with jsdom, working directory = workspace root). No base64
      fixtures needed
- [x] Keep the `firstDifference()` helper instead of `toEqual` on multi-megabyte typed arrays (it took seconds)
- [x] All 90 engine tests green under `ng test` (92 with the two `App` specs); `tsc --noEmit` is clean under
      `tsconfig.app.json`, `tsconfig.worker.json` and `tsconfig.spec.json`

## 3. State: signal stores and services (`src/app/state/`)

Naming follows the current style guide: no `.service` / `.component` suffixes, one concept per file.

- [ ] **`PipelineGateway`** (`pipeline-gateway.ts`, `@Service`): owns the one `PipelineClient` (created lazily, sends
      `init` with `document.baseURI`), exposes `load`, `remove`, `render`, `inspect`, `export`. It is the only
      place that knows about the worker, so component tests can swap it for an in-process fake that runs
      `Pipeline` directly
- [ ] **`WorkspaceStore`** (`workspace-store.ts`, `@Service`) — the source of truth, all signals:
  - `files: Signal<LoadedFile[]>` (id, `FileMeta`, source light levels, object URL of the original `File`),
    `selectedId`, `loadErrors`, `loading`
  - `patternSettings` (kind, width, height, nits, color) and `adjustments` — the models behind the two forms
  - `selectedFile = computed(…)`, `isPattern = computed(…)`
  - `source = computed<Source | string>(…)`: the `Source` for the worker, or the message why there is none
    (invalid pattern form, pattern too large) — same rule as `currentJob()` today
  - `baseName = computed(…)` for download file names
  - methods: `open(files: File[])` (sequential load through the gateway, collects per-file errors, selects the last
    good file), `select(id | null)`, `remove(id)` (also revokes the original's object URL and tells the worker),
    `resetAdjustments()`
- [ ] **`PreviewStore`** (`preview-store.ts`, `@Service`):
  - `settled = debounced(() => workspace.source(), 60)` so dragging a slider does not queue a render per pixel moved
    (`debounced` is `@experimental` in 22; using it is decided)
  - `render = resource({ params: () => validSource, loader: ({ params }) => gateway.render(params) })` → gives
    `value()`, `isLoading()`, `error()` for free, latest request wins
  - the worker itself still processes requests in order, so keep "one render in flight, newest one queued" inside
    the gateway; a superseded render must not be started at all
  - `hdrUrl` / `sdrUrl`: object URLs made from `render.value()` in an `effect` whose `onCleanup` revokes the previous
    pair (a `computed` must stay pure, so not there)
  - `status = computed(…)`: "Preview 2000×1334 of 6000×4000 · peak … · average … · NN% clipped · NN ms", load / render
    errors, download messages
  - `histogram = computed(…)`, `markers = computed(…)` (SDR white from the adjustments, content peak from the render)
- [ ] **`InspectorStore`** (`inspector-store.ts`): `hover = signal<{ u, v } | null>`, a `resource` keyed on it that
      calls `gateway.inspect(x, y)`; `readout = computed(…)` builds the text (full-resolution x / y, original nits, HDR
      nits + 16-bit PQ codes, SDR sRGB codes)
- [ ] **`DownloadStore`** (`download-store.ts`): `active = signal<{ format, fraction } | null>`; `start(format)` runs
      `gateway.export`, feeds progress into the signal, calls `downloadPng`; `cancel()`; `label(format)` and
      `disabled(format)` as `computed`s. The original is a plain `<a [href] [download]>`, no store involved
- [ ] **`DisplayCapability`** (`display-capability.ts`): `isHdr` signal from
      `matchMedia('(dynamic-range: high)')`, listener removed through `DestroyRef`

## 4. Components (`src/app/`)

One folder per component, inline templates (the workspace schematic default), Tailwind classes, no component CSS
unless a rule cannot be expressed as a utility. All inputs via `input()`, events via `output()`.

- [ ] **`App`** (`app.ts`) — page shell and layout grid. Global file intake in the `host` object:
      `(window:dragover)`, `(window:dragleave)`, `(window:drop)`, `(window:paste)` → `workspace.open(files)`;
      `dragging` signal drives the drop overlay
- [ ] **`AppHeader`** — title + HDR / SDR display badge (`DisplayCapability`)
- [ ] **`Viewer`** — the row of figures; `@if (!workspace.isPattern())` around the original
- [ ] **`ImageFigure`** — one image with caption and a projected download control. Inputs: `src`, `alt`, `title`,
      `caption`; outputs: `hover` (normalized `{ u, v }` from the image's bounding box) and `leave`. Carries
      `dynamic-range-limit: no-limit` so HDR content uses the display's headroom
- [ ] **`DownloadButton`** — input `format`; label / disabled / click from `DownloadStore`; announces progress
      accessibly (see 6)
- [ ] **`StatusLine`** and **`InspectorReadout`** — small presentational components bound to the stores
- [ ] **`SourceList`** — "Test pattern" + loaded files (`@for … track file.id`), selection with `aria-pressed`,
      remove buttons, "Open PNG / JPEG…" button with the hidden `<input type="file" multiple accept>`, load errors
- [ ] **`PatternPanel`** — Signal Form over `workspace.patternSettings` (section 5)
- [ ] **`AdjustPanel`** — file info (`<dl>`), warnings, sliders, boost checkbox, reset; Signal Form over
      `workspace.adjustments`
- [ ] **`FileInfo`** — the `<dl>` + warnings, split out of `AdjustPanel` to keep it small
- [ ] **`SliderField`** — reusable labelled range input with a value readout (label, unit, min / max / step, the
      bound field, optional display ↔ model conversion for "Boost starts at %" and "Color expansion %")
- [ ] **`LuminanceHistogram`** — `<canvas>` via `viewChild`, redraw in `afterRenderEffect` when `bins` / `markers`
      change (and on resize), using `drawHistogram` from `src/lib/render`; a text alternative for screen readers
- [ ] `NgOptimizedImage` is deliberately **not** used for the viewer images: they are runtime `blob:` URLs, which it
      does not support; note that next to the `<img>` so it is not "fixed" later

## 5. Forms (Signal Forms, `@angular/forms/signals`)

- [ ] `PatternPanel`: `form(patternSettings, schema)` with `required`, `min` / `max` for width, height
      (16–8192) and nits (1–10 000), plus a `validate` rule for the 32 MP limit; fields bound with `[formField]`
- [ ] The nits field depends on the pattern kind (label, default value, hidden for "patches"): reset the value when
      the kind changes (explicit handler on the select, or a `linkedSignal` keyed on the kind) and use `disabled` /
      `hidden` rules in the schema rather than template logic
- [ ] `AdjustPanel`: `form(adjustments)`; "Boost starts at" is `disabled` while `boost` is off
- [ ] `workspace.source` must only become a valid `Source` while the pattern form is valid — invalid input shows the
      same "Fix the highlighted fields" message as today and never reaches the worker
- [ ] Rendering is debounced in `PreviewStore` (one place); use the forms' own `debounce()` rule only if a field
      needs it specifically

## 6. Styling and accessibility

- [ ] Port the dark theme to Tailwind 4: design tokens (`--bg`, `--panel`, `--border`, `--text`, `--muted`,
      `--accent`, `--ok`, warning colors) as `@theme` variables in `src/styles.css`; layout and components as utility
      classes in the templates. Nothing from the Vite app's `style.css` is copied verbatim
- [ ] Same responsive behavior: three figures in a row, stacking below ~1000 px; three control columns collapsing
      to one
- [ ] WCAG AA / AXE (required by `CLAUDE.md`):
  - every input has a programmatic label; sliders expose value text with units (`aria-valuetext`)
  - source buttons are real `<button>`s with `aria-pressed`; remove buttons have `aria-label="Remove <name>"`
  - status line is `role="status"` (polite); the inspector readout is **not** a live region (it changes on every
    mouse move)
  - download progress: `aria-busy` + a label that includes the percentage, without announcing every tick
  - images have meaningful `alt` text; the histogram canvas has a text summary (peak / average / white level)
  - visible `:focus-visible` ring on all controls; drop overlay does not trap focus and is `aria-hidden`
  - contrast of muted text, badge and warning colors checked against the panel and page backgrounds
  - run an AXE pass (browser extension or `axe-core` in a component test) and fix what it reports

## 7. Tests for the Angular layer

- [ ] Test double for `PipelineGateway` that runs the real `Pipeline` in-process (no worker in jsdom), with profiles
      from the fixture helper
- [ ] `WorkspaceStore`: open → select → remove; error collection; `source` turns into a message for invalid pattern
      input; `baseName`
- [ ] `PreviewStore`: renders on change, newest request wins, object URLs are revoked, status text
- [ ] `DownloadStore`: progress, cancel, the other button is disabled while one runs
- [ ] Component tests (TestBed, signals inputs): `Viewer` hides the original for patterns; `SourceList` selection and
      removal; `AdjustPanel` writes adjustments and resets; `PatternPanel` validation; `DownloadButton` labels
- [ ] `App`: creates, and a dropped file reaches `WorkspaceStore.open`
- [ ] jsdom has no `createImageBitmap` / `OffscreenCanvas`: the browser decode path stays covered by the manual
      browser check (section 8), as in the Vite app

## 8. Verification

- [ ] `ng test` — engine specs (90) + the new Angular specs
- [ ] `ng build` — no budget errors; the worker is emitted as its own chunk; both `.icc` files are in `dist/`
- [ ] `ng serve` in Chrome on an HDR display, same checklist as the Vite app:
  - test patterns render, HDR badge is shown, both outputs appear
  - sRGB JPEG, Display P3 JPEG, 8-bit PNG, 16-bit PNG, one of our own HDR PNGs, a bogus `.png` (error stays visible)
  - sliders re-render both outputs; inspector shows plausible values on all three images; histogram markers move
  - download original / HDR / SDR; cancel a 24 MP HDR download mid-way; page stays responsive during the encode
  - no console errors
- [ ] Production build served from a sub-path (`ng build --base-href /hdr/`): worker and profiles load
- [ ] Exported files are still valid: `sips -g bitsPerSample -g profile`, ImageMagick `identify -verbose`, embedded
      profile `cmp`-identical to `public/rec2100-pq.icc` / `public/sRGB-v4.icc`
- [ ] Feature parity walk-through against the Vite app running side by side

## 9. Docs and housekeeping

- [ ] Replace the generated `README.md` with the tool's README (what it does, requirements, HDR PNG structure,
      verification commands), updated for `ng serve` / `ng test` / `ng build` and the `src/app` + `src/lib` layout
- [ ] Carry over the decisions that explain the code (16-bit PNG + `cICP` + `iCCP`, 203-nit SDR white, no general ICC
      engine, previews are real files, banded export in a worker, BT.2390 on the brightest sRGB channel)
- [ ] CI workflow: `npm ci`, `ng test --watch=false`, `ng build`
- [ ] `/Users/ziv.perry/code/hdr` stays exactly as it is (decided): nothing is moved out of it or deleted, files
      are only copied from it

## Milestones

| # | Deliverable | Sections |
| --- | --- | --- |
| A1 ✅ | Workspace prepared; engine in `src/lib`; all 90 engine specs green under `ng test`; `ng build` compiles the worker | 1, 2 |
| A2 | Stores + gateway; minimal `App` that renders the default test pattern into the two output images (end-to-end proof through the worker, profiles fetched from `public/`) | 3, part of 4 |
| A3 | Full UI: viewer, downloads with progress / cancel, sources with open / drop / paste, pattern and adjust forms, inspector, histogram | 4, 5 |
| A4 | Styling, accessibility pass, Angular-layer tests | 6, 7 |
| A5 | Verification in Chrome + production build, README, CI | 8, 9 |

## Decisions log

| Question | Answer |
| --- | --- |
| Keep the router? | No — remove it, the app is a single screen. |
| What happens to the Vite repo? | It stays as is; this app gets copies. |
| Use the experimental `debounced()`? | Yes. |
