import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { AppError } from '../errors';
import { normalizeRotation, type PageGeometry } from './coords';

GlobalWorkerOptions.workerSrc = workerUrl;

export { AnnotationMode };
export type { PDFDocumentProxy, PDFPageProxy };

/** pdf.js runtime data (CMaps, standard fonts, wasm decoders, ICC) is served by this site. */
export function pdfjsAssetBase(): string {
  return new URL(`${import.meta.env.BASE_URL}${__PDFJS_ASSET_DIR__}/`, window.location.href).href;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  task: PDFDocumentLoadingTask;
  destroy: () => Promise<void>;
}

/**
 * Opens a PDF for rendering. pdf.js takes ownership of (transfers) the buffer it is
 * given, so we always hand it a copy and keep the caller's bytes intact.
 *
 * Security notes: PDF JavaScript is never executed (no scripting sandbox is created and
 * its files are not shipped), XFA is disabled, and links/actions are not interactive
 * because only the canvas layer is rendered.
 */
export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const base = pdfjsAssetBase();
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    enableXfa: false,
    verbosity: 0,
  });
  // Without a password prompt pdf.js rejects with PasswordException, which we report.
  try {
    const doc = await task.promise;
    return {
      doc,
      task,
      destroy: async () => {
        try {
          await task.destroy();
        } catch {
          // already destroyed
        }
      },
    };
  } catch (e) {
    task.destroy().catch(() => undefined);
    throw classifyPdfError(e);
  }
}

export function classifyPdfError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const name = (e as { name?: string } | null)?.name ?? '';
  const message = (e as { message?: string } | null)?.message ?? String(e);
  if (name === 'PasswordException') return new AppError('error.pdfPassword', undefined, message);
  if (name === 'InvalidPDFException') return new AppError('error.pdfInvalid', undefined, message);
  return new AppError('error.pdfOpen', undefined, `${name}: ${message}`);
}

export function pageGeometry(page: PDFPageProxy): PageGeometry {
  const v = page.view;
  return {
    view: [v[0], v[1], v[2], v[3]],
    rotate: normalizeRotation(page.rotate),
    userUnit: page.userUnit || 1,
  };
}
