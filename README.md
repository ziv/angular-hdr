# HDR Image Tool

A client-side Angular app that turns images into **true HDR files**. Everything runs in the browser; no file ever
leaves the machine.

- The app opens with a default image (`public/default.jpeg`); **open**, **drop** or **paste** PNG and JPEG files to
  add your own. sRGB, Display P3 and Rec.2100 PQ sources are recognized, anything else is color-managed by the
  browser.
- The viewer always shows three images side by side: the **original** file, the **HDR** output (Rec.2100 PQ with
  `rec2100-pq.icc`) and the **SDR** output (tone mapped sRGB with `sRGB-v4.icc`). Hovering any of them reads the
  same pixel from all three.
- **Convert** with SDR white level, exposure, highlight boost (inverse tone mapping up to a chosen peak), color
  expansion toward BT.2020 and a hue-preserving peak clamp. A log-luminance histogram shows the HDR output.
- **Download** any of the three with the button below it. HDR and SDR downloads are encoded at full resolution in a
  web worker; the button shows the progress and cancels on a second click.

## Requirements

- **Node 24** (`.nvmrc`). Angular CLI 22 refuses Node versions below 22.22.3 / 24.15: run `nvm use` first.
- A current Chrome or Safari. Seeing HDR needs an HDR display with HDR enabled; the badge in the header shows what
  the browser reports. On an SDR display everything still works and the files are just as valid, the browser simply
  tone maps the preview.

## Commands

```sh
npm install
npm start                    # ng serve, http://localhost:4200
npx ng test --watch=false    # unit tests (Vitest + jsdom)
npx ng build                 # production build in dist/angular-hdr/browser
npx ng build --base-href /some/path/   # when hosting below a sub-path
```

## Layout

| Path                                    | Role                                                                                                                                                                                  |
|-----------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/app/`                              | Angular only. `state/` holds the signal stores and the worker gateway; `viewer/`, `sources/`, `adjust/`, `controls/`, `histogram/` hold the components; `testing/` holds spec helpers |
| `src/lib/`                              | Plain TypeScript without any Angular import, so it runs unchanged in the worker and in Node                                                                                           |
| `src/lib/color/`                        | sRGB / PQ transfer functions, primaries matrices, SDR→HDR adjustments, BT.2390 tone mapping, downscaling, histogram                                                                   |
| `src/lib/png/`                          | PNG chunk layer, color chunks (`cICP`, `iCCP`, `cLLi`, `mDCv`), streaming 8/16-bit encoder with adaptive filtering, decoder (on top of `fast-png`)                                    |
| `src/lib/icc/`, `src/lib/io/`           | Color space identification; format sniffing, JPEG ICC extraction, loading, banded export, profile loading, download                                                                   |
| `src/lib/worker/`                       | The pipeline that owns all pixel data, its worker entry, the message protocol and the promise based client                                                                            |
| `src/lib/generate/`, `src/lib/testing/` | Test pattern generators and profile fixtures, used by the specs only                                                                                                                  |
| `public/`                               | `default.jpeg` and the two ICC profiles, served from the app's base URL                                                                                                               |

### How the Angular side is built

- **Signals all the way.** `WorkspaceStore` (files, selection, adjustments) → `PreviewStore` (`debounced()` +
  `resource()` render, object URLs released in an `effect` cleanup) → components. `InspectorStore` and
  `DownloadStore` follow the same pattern. The app is zoneless; nothing calls change detection by hand.
- **One door to the worker.** `PipelineGateway` is the only class that knows there is a worker. Renders queue behind
  the one in flight and a superseded render never reaches the worker. Specs replace the gateway with
  `InProcessGateway`, which runs the real pipeline in the test's thread.
- **Signal Forms.** The adjust panel is `form(workspace.adjustments, schema)`; the sliders are a custom control
  (`SliderField`, a `FormValueControl<number>`) bound with `[formField]`, and the schema disables "Boost starts at"
  while the boost is off.
- **The previews are real files.** The HDR and SDR images are PNGs made by the same encoders as the downloads, each
  with its profile embedded, and rendered by the browser; the original is the opened file itself. Previews are
  encoded at reduced resolution without filtering or compression, which keeps slider changes fast.
- The worker fetches the ICC profiles itself. A relative URL inside a worker resolves against the worker script, so
  the page passes `document.baseURI` in an `init` message; that is what makes sub-path hosting work.

## What an exported HDR file looks like

```
PNG signature
IHDR   16-bit RGB (or RGBA when the image has transparency)
cICP   9 / 16 / 0 / 1      BT.2020 primaries, PQ transfer, RGB, full range
cLLi   MaxCLL / MaxFALL    measured from the exported pixels
iCCP   rec2100-pq.icc      embedded byte for byte
IDAT…  adaptively filtered scanlines, zlib
IEND
```

`cICP` is what Chrome, Safari and macOS (Preview, Quick Look) use to render the image as HDR; the ICC profile carries
the same information for software that only reads profiles. Pixels are absolute: a PQ code value stands for a
luminance in nits, and SDR content is placed with its white at 203 nits (ITU-R BT.2408) unless the white level
slider says otherwise.

SDR exports are 8-bit sRGB PNGs with `sRGB-v4.icc` embedded. Highlights are rolled off with the ITU-R BT.2390 EETF,
applied to the brightest sRGB channel so bright saturated colors keep their hue, and out-of-gamut colors are
desaturated toward their own luminance.

Limits: 50 MP per image (a 24 MP image already needs about 400 MB as float data; a 24 MP HDR download takes
several seconds). HLG and other HDR encodings are imported as SDR with a warning. 16-bit PNGs with exotic features
(palette, `tRNS`, bare `gAMA`, unknown profiles) are imported through the browser at 8-bit precision, also with a
warning.

## Verifying output

Automated (`ng test`): transfer functions against reference values, matrices against BT.2087, CRC vectors, chunk
order, byte-identical embedded profiles, encode → decode round trips with `fast-png` as an independent decoder, HDR
export → reload → export within one code value, the stores, the components, drop / paste, and an `axe-core` pass
(color contrast is checked by calculation, jsdom cannot paint).

With external tools, on a downloaded file:

```sh
sips -g bitsPerSample -g profile out-hdr.png     # 16, "Rec. ITU-R BT.2100 PQ"
magick identify -verbose out-hdr.png             # libpng reads it without warnings, shows the ICC description
magick out-hdr.png icc:out.icc && cmp out.icc public/rec2100-pq.icc
pngcheck -v out-hdr.png                          # chunk structure
exiftool -a -G1 out-hdr.png                      # profile description, cICP
```

By eye, on an HDR display: turn on **Boost highlights** — the bright parts of the HDR image must become clearly
brighter than the same parts of the original and of the SDR image. Then open the downloaded file in Preview / Quick
Look and in Safari.

## Origin

The engine in `src/lib` was ported from a framework-free Vite + TypeScript version of the tool; for the same input
both produce byte-identical files. `public/rec2100-pq.icc` and `public/sRGB-v4.icc` were created by the repository
owner. See [plans.md](plans.md) for the migration plan and its decisions.
