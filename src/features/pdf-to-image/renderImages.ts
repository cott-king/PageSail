import { LIMITS, PIXELS_PER_MEGAPIXEL } from '../../config';
import { canAllocateCanvas, canvasToBlob, createCanvas, releaseCanvas } from '../../lib/canvas';
import { AppError, throwIfAborted } from '../../lib/errors';
import { padNumber, safeFileName } from '../../lib/files/names';
import { ZipBuilder } from '../../lib/files/zip';
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs';

export type ImageFormat = 'png' | 'jpeg';

export interface PageSize {
  /** Page size in PDF points as displayed (after /Rotate, UserUnit applied). */
  width: number;
  height: number;
}

export function outputPixels(size: PageSize, dpi: number): { width: number; height: number } {
  const s = dpi / 72;
  return { width: Math.max(1, Math.round(size.width * s)), height: Math.max(1, Math.round(size.height * s)) };
}

export interface RenderOptions {
  /** 1-based page numbers, in output order. */
  pages: number[];
  format: ImageFormat;
  dpi: number;
  /** JPEG quality 0..1 */
  quality: number;
  /** PNG only: keep the page background transparent instead of white. */
  transparent: boolean;
  baseName: string;
}

export interface RenderProgress {
  done: number;
  total: number;
  page: number;
  stage: 'checking' | 'rendering' | 'packing';
}

export interface RenderResult {
  blob: Blob;
  fileName: string;
  count: number;
}

export async function readPageSize(doc: PDFDocumentProxy, pageNumber: number): Promise<PageSize> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/**
 * Renders the selected pages one at a time (bounded memory: one full-size canvas at a time),
 * encodes each in the browser and streams it into a ZIP when there is more than one page.
 */
export async function renderPdfToImages(
  doc: PDFDocumentProxy,
  opts: RenderOptions,
  signal: AbortSignal,
  onProgress: (p: RenderProgress) => void,
): Promise<RenderResult> {
  const total = opts.pages.length;
  if (total === 0) throw new AppError('error.noPagesSelected');
  const ext = opts.format === 'png' ? 'png' : 'jpg';
  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  const base = safeFileName(opts.baseName, 'document');
  const pageCount = doc.numPages;

  // 1) Check every page against the resource limits before doing any heavy work.
  for (let i = 0; i < total; i++) {
    throwIfAborted(signal);
    const n = opts.pages[i];
    onProgress({ done: i, total, page: n, stage: 'checking' });
    const px = outputPixels(await readPageSize(doc, n), opts.dpi);
    if (px.width * px.height > LIMITS.maxRenderPixels) {
      throw new AppError('error.renderTooLarge', {
        page: n,
        width: px.width,
        height: px.height,
        max: Math.round(LIMITS.maxRenderPixels / PIXELS_PER_MEGAPIXEL),
      });
    }
    if (!canAllocateCanvas(px.width, px.height)) {
      throw new AppError('error.canvasTooLarge', { page: n, width: px.width, height: px.height });
    }
  }

  const zip = total > 1 ? new ZipBuilder() : null;
  let single: Blob | null = null;
  try {
    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const n = opts.pages[i];
      onProgress({ done: i, total, page: n, stage: 'rendering' });
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: opts.dpi / 72 });
      const px = { width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)) };
      const canvas = createCanvas(px.width, px.height);
      try {
        const task = page.render({
          canvas,
          viewport,
          // Stretch the sub-pixel remainder so the bitmap is exactly px.width × px.height.
          transform: [px.width / viewport.width, 0, 0, px.height / viewport.height, 0, 0],
          background: opts.format === 'png' && opts.transparent ? 'rgba(0,0,0,0)' : 'rgb(255,255,255)',
        });
        const abort = () => task.cancel();
        signal.addEventListener('abort', abort);
        try {
          await task.promise;
        } finally {
          signal.removeEventListener('abort', abort);
        }
        throwIfAborted(signal);
        const blob = await canvasToBlob(canvas, mime, opts.format === 'jpeg' ? opts.quality : undefined);
        throwIfAborted(signal);
        const name = `${base}_page-${padNumber(n, pageCount)}.${ext}`;
        if (zip) zip.add(name, new Uint8Array(await blob.arrayBuffer()));
        else single = blob;
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }
    }
    throwIfAborted(signal);
    if (zip) {
      onProgress({ done: total, total, page: opts.pages[total - 1], stage: 'packing' });
      const blob = await zip.finish();
      throwIfAborted(signal);
      return { blob, fileName: `${base}_${ext}.zip`, count: total };
    }
    return { blob: single!, fileName: `${base}_page-${padNumber(opts.pages[0], pageCount)}.${ext}`, count: 1 };
  } catch (e) {
    zip?.abort();
    throw e;
  }
}
