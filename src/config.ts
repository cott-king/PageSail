/**
 * Build-time configuration. All values can be overridden with `VITE_*` environment
 * variables when running `npm run build` (see README → "Resource limits").
 *
 * The limits exist to keep the visitor's browser responsive: every file is processed
 * on the visitor's own device, so these numbers are about browser memory and canvas
 * limits, not about the server.
 */

const env = import.meta.env ?? {};

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MB = 1024 * 1024;
const MEGAPIXEL = 1_000_000;

export const REPO_URL: string = env.VITE_REPO_URL || 'https://github.com/cott-king/PageSail';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const LIMITS = {
  /** Largest PDF accepted by any tool. pdf.js keeps the whole file in memory. */
  maxPdfBytes: positive(env.VITE_MAX_PDF_MB, 500) * MB,
  /** Largest single PNG/JPG file accepted. */
  maxImageBytes: positive(env.VITE_MAX_IMAGE_MB, 100) * MB,
  /** Largest decoded image (width × height). Decoded RGBA needs 4 bytes per pixel. */
  maxImagePixels: positive(env.VITE_MAX_IMAGE_MEGAPIXELS, 64) * MEGAPIXEL,
  /** Largest bitmap rendered for one PDF page when exporting images. */
  maxRenderPixels: positive(env.VITE_MAX_RENDER_MEGAPIXELS, 64) * MEGAPIXEL,
  /** Most files accepted in one batch (image → PDF, merge). */
  maxFiles: positive(env.VITE_MAX_FILES, 200),
  /** Undo steps kept per page / per image. Snapshots store object data, never full bitmaps. */
  historySteps: positive(env.VITE_HISTORY_STEPS, 50),
  /** Above this page count we show a "this may be slow" hint. */
  warnPdfPages: 500,
  /** Above this total output (sum of pixels of all exported pages) we warn about memory. */
  warnTotalRenderPixels: 800 * MEGAPIXEL,
} as const;

export const BYTES_PER_MB = MB;
export const PIXELS_PER_MEGAPIXEL = MEGAPIXEL;
