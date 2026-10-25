# Third-party notices

PageSail's own source code is licensed under the [MIT License](LICENSE). PageSail
distributes the third-party components listed below. **They keep their own licenses**;
using MIT for PageSail does not relicense them.

The complete license texts are generated at build time into
`dist/licenses/THIRD_PARTY_NOTICES.txt` from the packages that actually end up in the
production bundles, and are served by every deployment at
`/licenses/THIRD_PARTY_NOTICES.txt` (linked from the About page). The build fails if a
bundled package is missing from this summary.

## JavaScript packages bundled into the web app

| Package | License | Used for |
| --- | --- | --- |
| `react`, `react-dom`, `scheduler` | MIT | User interface |
| `pdfjs-dist` (PDF.js) | Apache-2.0 | Rendering PDF pages and previews |
| `pdf-lib` | MIT | Writing PDFs (page operations, image → PDF, annotations) |
| `@pdf-lib/standard-fonts`, `@pdf-lib/upng` | MIT | pdf-lib dependencies (font metrics, PNG decoding) |
| `@pdf-lib/fontkit` | MIT (declared; package ships no license file — see note) | Font parsing and subsetting for embedded text |
| `pako` | MIT AND Zlib | Deflate compression (pdf-lib, fontkit) |
| `tslib` | 0BSD | TypeScript runtime helpers (pdf-lib) |
| `fabric` (Fabric.js) | MIT | Interactive canvas for the editors |
| `fflate` | MIT | Creating ZIP downloads |

Note on `@pdf-lib/fontkit`: it is a fork of [fontkit](https://github.com/foliojs/fontkit)
(MIT); the fork lives at <https://github.com/Hopding/fontkit>. Its prebuilt bundle also
contains small MIT-licensed helper libraries (restructure, unicode-properties,
unicode-trie, tiny-inflate, a brotli decoder, base64-js, ieee754, buffer and others).

## Runtime data files served with the app

| Files | License |
| --- | --- |
| PDF.js CMaps (`vendor/pdfjs-*/cmaps/`) | Adobe CMap license (BSD-3-Clause style), see `cmaps/LICENSE` |
| PDF.js standard fonts — Foxit (`standard_fonts/Foxit*.pfb`) | BSD-style, see `LICENSE_FOXIT` |
| PDF.js standard fonts — Liberation Sans (`standard_fonts/Liberation*.ttf`) | SIL OFL 1.1, see `LICENSE_LIBERATION` |
| PDF.js wasm decoders — OpenJPEG, JBIG2, qcms (`wasm/`) | BSD-2-Clause, BSD-3-Clause (PDFium), MIT, Apache-2.0 (see `wasm/LICENSE_*`) |
| PDF.js ICC profile (`iccs/`) | CC0 1.0 |
| Noto Sans, Noto Sans SC, Noto Sans JP (`fonts/`) | SIL Open Font License 1.1, see `public/fonts/OFL-*.txt` and `public/fonts/README.md` (static Regular instances generated from the upstream variable fonts) |

PDF.js scripting files (`quickjs-eval.*`) are deliberately **not** shipped: PageSail never
executes JavaScript embedded in PDFs.

## Development-only tools (not distributed)

Vite, Rolldown, TypeScript, ESLint, typescript-eslint, Vitest, Playwright,
`@napi-rs/canvas` and Prettier are used only to build and test PageSail. They are not
part of the deployed site. Their own licenses (mostly MIT/Apache-2.0) apply when you
install them via npm.

## Container base images

The Docker build uses `node:24-bookworm-slim` (build stage only) and
`nginxinc/nginx-unprivileged:1.30-alpine` (runtime). Those images contain Debian/Alpine
packages and Nginx under their respective licenses (Nginx: 2-clause BSD).

## Original artwork

The PageSail logo and the icon set in `src/components/Icon.tsx` were drawn for this
project and are covered by PageSail's MIT License.
