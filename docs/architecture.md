# PageSail architecture

PageSail is a static single-page application. There is no backend code, database or
account system: the server (Nginx) only delivers files, and every document is processed
inside the visitor's browser.

## Layout of the source tree

```
src/
  app/            shell: router (history API), layout, home/privacy/about pages, error boundary
  i18n/           typed translation catalogue (en is the key source; zh-CN, ja must match)
  components/     shared UI: drop zone, alerts, progress, modal, PDF thumbnails
  lib/            framework-free helpers
    affine.ts       2D matrices shared by preview and export
    pdf/            pdf.js wrapper, page-range parser, coordinates, thumbnails, pdf-lib loading
    images/         PNG/JPEG header + EXIF parsing, orientation matrices, decoding/thumbnails
    files/          content-based type detection, names, downloads, incremental ZIP
  editor/         Fabric.js toolkit shared by both editors (tools, styles, history, fonts, panels)
  features/
    pdf-to-image/   rendering loop (pdf.js, main thread, one page at a time)
    image-to-pdf/   layout math + pdf-lib builder (Web Worker)
    pdf-pages/      page-list reducer + assembler with reference sanitising (Web Worker)
    pdf-annotate/   per-page Fabric engine, Fabric → model conversion, vector exporter (Web Worker)
    image-editor/   non-destructive engine (source bitmap + matrix + LUT + objects), export
  workers/        typed job protocol; one worker per job so cancel = terminate
```

## Key decisions

**Static, client-side processing.** Privacy follows from architecture rather than policy:
the page has no endpoint to send files to, the CSP restricts connections to the same
origin, and Nginx rejects anything but GET/HEAD. Performance therefore depends on the
visitor's device, which is why there are explicit, documented resource limits.

**PDF.js for reading, pdf-lib for writing.** PDF.js renders pages accurately (CMaps,
standard fonts and wasm decoders are served from the site). pdf-lib modifies or assembles
PDFs at the object level, so original page content streams are preserved and never
rasterised. pdf-lib work runs in a Web Worker created per job; terminating it is a real
cancel and releases its memory.

**One coordinate model.** Editor objects live in *page display space*: PDF.js viewport at
scale 1 (PDF units × UserUnit, after `/Rotate`, origin top-left of the visible CropBox).
Zoom and devicePixelRatio are only view transforms. On export, each object's Fabric
matrix is composed with the inverse of the PDF.js viewport transform
(`lib/pdf/coords.ts`), so rotation, CropBox offsets and UserUnit are handled by one matrix.
Unit tests compare that matrix with PDF.js for every rotation, a cropped page and a
UserUnit page; e2e tests draw in the real UI and check pixels in the re-rendered output.
Existing page content is wrapped in `q … Q` by pdf-lib, so a page whose content leaves
the CTM modified cannot shift new content (covered by a fixture).

**Serializable annotation model.** Fabric objects are converted to a plain model
(`features/pdf-annotate/model.ts`) — rectangles, ellipses, paths (M/L/C/Q/Z), text lines,
images — before export. The exporter is a pure function of (PDF bytes, model, fonts,
images), which makes it testable in Node and runnable in a worker. Text baselines are
computed from Fabric's own layout values so PDF text lands exactly where the preview
showed it.

**Real text with subset fonts.** Added text uses static Regular instances of Noto Sans,
Noto Sans SC and Noto Sans JP (SIL OFL), served by the site and loaded only when a text
tool is used. The same bytes feed the on-screen FontFace and pdf-lib's subsetting embedder
(with a proper `ABCDEF+Name` subset tag and a ToUnicode map), so the preview matches the
output and the text stays searchable. A small cmap reader checks coverage and blocks
export with a clear message if a character is missing.

**Page assembly without leaks.** Page operations build a new document with `copyPages`.
Because annotations can reference other pages (link destinations, `/P`, form-field trees,
replies), references to pages and to annotations of other pages are cut before copying.
Otherwise a deleted page could be silently carried along as an unreachable object.
Tests assert the output contains exactly as many page objects as pages.

**Non-destructive image editing.** The decoded source bitmap is never modified. Crop,
rotation, flips and resizing accumulate in one matrix, brightness/contrast are a 256-entry
LUT, annotations are Fabric objects in output pixels. The preview uses a downscaled copy
(≤ 2048 px); export renders the full-resolution source through the matrix at the real
output size. Undo snapshots contain only these small values plus object JSON, never bitmaps.

**Bounded memory.** PDF → image renders one page at a time and streams results into a
ZIP; thumbnails are rendered lazily (IntersectionObserver) with an LRU cache of compressed
object URLs; canvases are released explicitly; undo history is capped.

## Testing strategy

- **Unit (Vitest, Node):** page ranges, coordinate math vs PDF.js, image headers/EXIF,
  layout, LUT, cmap coverage, history, page reducer, ZIP, and the three pdf-lib pipelines
  on real fixture PDFs — verified by re-opening outputs with PDF.js, extracting text and
  rendering pixels with `@napi-rs/canvas`.
- **End-to-end (Playwright, Chromium desktop + mobile emulation):** every tool's main flow
  through the real UI, with downloaded files decoded and checked (page count, order,
  orientation, pixel sizes, colours at known positions, extracted text, embedded font
  names), error handling and recovery, i18n persistence, SPA fallback, production asset
  loading (worker, CMaps, wasm, fonts, notices), network privacy and CSP violations.
  `PAGESAIL_BASE_URL` points the suite at a running deployment (e.g. the Nginx container).
- Fixtures are synthetic and generated by `scripts/make-fixtures.mjs`
  (`scripts/make-encrypted-fixtures.py` for the encrypted ones).
