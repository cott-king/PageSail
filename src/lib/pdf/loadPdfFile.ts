import { LIMITS, BYTES_PER_MB } from '../../config';
import { AppError } from '../errors';
import { detectFileType } from '../files/detect';
import { openPdf, type OpenedPdf } from './pdfjs';
import { ThumbnailCache } from './thumbnails';

export interface LoadedPdf {
  name: string;
  size: number;
  /** Original bytes, kept for pdf-lib export. pdf.js gets its own copy. */
  bytes: Uint8Array;
  opened: OpenedPdf;
  pageCount: number;
  thumbs: ThumbnailCache;
  dispose: () => void;
}

export async function checkPdfFile(file: File): Promise<void> {
  if (file.size === 0) throw new AppError('error.emptyFile', { name: file.name });
  const type = await detectFileType(file);
  if (type === 'png' || type === 'jpeg') throw new AppError('error.notPdfButImage', { name: file.name });
  if (type !== 'pdf') throw new AppError('error.notPdf', { name: file.name });
  if (file.size > LIMITS.maxPdfBytes) {
    throw new AppError('error.pdfTooLarge', { name: file.name, max: Math.round(LIMITS.maxPdfBytes / BYTES_PER_MB) });
  }
}

export async function loadPdfFile(file: File): Promise<LoadedPdf> {
  await checkPdfFile(file);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    throw new AppError('error.fileRead', { name: file.name }, e instanceof Error ? e.message : String(e));
  }
  const opened = await openPdf(bytes);
  const pageCount = opened.doc.numPages;
  if (pageCount < 1) {
    await opened.destroy();
    throw new AppError('error.pdfNoPages');
  }
  const thumbs = new ThumbnailCache(opened.doc);
  return {
    name: file.name,
    size: file.size,
    bytes,
    opened,
    pageCount,
    thumbs,
    dispose: () => {
      thumbs.dispose();
      void opened.destroy();
    },
  };
}
