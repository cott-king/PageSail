/// <reference types="vite/client" />

/** Folder (relative to the site base) where pdf.js CMaps, fonts and wasm are served. Injected by vite.config.ts. */
declare const __PDFJS_ASSET_DIR__: string;
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Public source repository URL shown in the footer and About page. */
  readonly VITE_REPO_URL?: string;
  readonly VITE_MAX_PDF_MB?: string;
  readonly VITE_MAX_IMAGE_MB?: string;
  readonly VITE_MAX_IMAGE_MEGAPIXELS?: string;
  readonly VITE_MAX_RENDER_MEGAPIXELS?: string;
  readonly VITE_MAX_FILES?: string;
  readonly VITE_HISTORY_STEPS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
