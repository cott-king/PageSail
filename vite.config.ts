import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { licenseNotices, trackBundledPackages } from './scripts/vite-licenses.ts';

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjsVersion: string = JSON.parse(readFileSync(path.join(pdfjsDir, 'package.json'), 'utf8')).version;
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** URL folder (relative to the site base) where pdf.js runtime data is served. Versioned for cache busting. */
const PDFJS_ASSET_DIR = `vendor/pdfjs-${pdfjsVersion}`;
/** pdf.js data folders the viewer needs at runtime. Scripting (quickjs) is intentionally not shipped. */
const PDFJS_DATA_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const EXCLUDED = /^quickjs/;

const MIME: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/vnd.iccprofile',
};

function listPdfjsAssets(): { rel: string; abs: string }[] {
  const files: { rel: string; abs: string }[] = [];
  for (const dir of PDFJS_DATA_DIRS) {
    const absDir = path.join(pdfjsDir, dir);
    for (const name of readdirSync(absDir)) {
      if (EXCLUDED.test(name)) continue;
      const abs = path.join(absDir, name);
      if (statSync(abs).isFile()) files.push({ rel: `${dir}/${name}`, abs });
    }
  }
  return files;
}

/**
 * Serves pdf.js CMaps, standard fonts, wasm decoders and ICC profiles from this site
 * (dev middleware + emitted build assets), so production never depends on a CDN.
 */
function pdfjsAssets(): Plugin {
  return {
    name: 'pagesail:pdfjs-assets',
    configureServer(server) {
      const prefix = `${server.config.base}${PDFJS_ASSET_DIR}/`;
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url || !url.startsWith(prefix)) return next();
        const rel = decodeURIComponent(url.slice(prefix.length));
        const [dir] = rel.split('/');
        if (!PDFJS_DATA_DIRS.includes(dir) || rel.includes('..') || EXCLUDED.test(path.basename(rel))) return next();
        const abs = path.join(pdfjsDir, rel);
        if (!existsSync(abs)) return next();
        res.setHeader('Content-Type', MIME[path.extname(abs)] ?? 'application/octet-stream');
        createReadStream(abs).pipe(res);
      });
    },
    generateBundle() {
      for (const { rel, abs } of listPdfjsAssets()) {
        this.emitFile({ type: 'asset', fileName: `${PDFJS_ASSET_DIR}/${rel}`, source: readFileSync(abs) });
      }
    },
  };
}

const root = fileURLToPath(new URL('.', import.meta.url));
const pdfjsLicenseFiles = [
  ['pdf.js CMaps (cmaps/LICENSE)', 'cmaps/LICENSE'],
  ['pdf.js standard fonts: Foxit (standard_fonts/LICENSE_FOXIT)', 'standard_fonts/LICENSE_FOXIT'],
  ['pdf.js standard fonts: Liberation (standard_fonts/LICENSE_LIBERATION)', 'standard_fonts/LICENSE_LIBERATION'],
  ['pdf.js wasm: JBIG2 (wasm/LICENSE_JBIG2)', 'wasm/LICENSE_JBIG2'],
  ['pdf.js wasm: pdf.js JBIG2 glue (wasm/LICENSE_PDFJS_JBIG2)', 'wasm/LICENSE_PDFJS_JBIG2'],
  ['pdf.js wasm: OpenJPEG (wasm/LICENSE_OPENJPEG)', 'wasm/LICENSE_OPENJPEG'],
  ['pdf.js wasm: pdf.js OpenJPEG glue (wasm/LICENSE_PDFJS_OPENJPEG)', 'wasm/LICENSE_PDFJS_OPENJPEG'],
  ['pdf.js wasm: qcms (wasm/LICENSE_QCMS)', 'wasm/LICENSE_QCMS'],
  ['pdf.js wasm: pdf.js qcms glue (wasm/LICENSE_PDFJS_QCMS)', 'wasm/LICENSE_PDFJS_QCMS'],
  ['pdf.js ICC profile (iccs/LICENSE)', 'iccs/LICENSE'],
].map(([title, file]) => ({ title, file: path.join(pdfjsDir, file) }));

export default defineConfig({
  base: process.env.PAGESAIL_BASE ?? '/',
  plugins: [
    react(),
    pdfjsAssets(),
    licenseNotices({
      root,
      pdfjsDir,
      extraFiles: [
        ...pdfjsLicenseFiles,
        { title: 'Noto Sans (public/fonts/NotoSans-Regular.ttf) — SIL Open Font License 1.1', file: 'public/fonts/OFL-NotoSans.txt' },
        { title: 'Noto Sans SC (public/fonts/NotoSansSC-Regular.ttf) — SIL Open Font License 1.1', file: 'public/fonts/OFL-NotoSansSC.txt' },
        { title: 'Noto Sans JP (public/fonts/NotoSansJP-Regular.ttf) — SIL Open Font License 1.1', file: 'public/fonts/OFL-NotoSansJP.txt' },
        { title: 'About the bundled font files', file: 'public/fonts/README.md' },
      ],
    }),
  ],
  define: {
    __PDFJS_ASSET_DIR__: JSON.stringify(PDFJS_ASSET_DIR),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  worker: {
    format: 'es',
    plugins: () => [trackBundledPackages()],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
