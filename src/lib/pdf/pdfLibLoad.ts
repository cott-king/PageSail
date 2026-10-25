import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { AppError } from '../errors';

/**
 * Loads a PDF for modification with pdf-lib. Encrypted PDFs are rejected with a clear
 * message: pdf-lib cannot decrypt, and `ignoreEncryption` would silently produce
 * broken output, so we never use it.
 */
export async function loadForEditing(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  let count: number;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib parses leniently; touching the page tree surfaces structural damage now
    // rather than in the middle of an export.
    count = doc.getPageCount();
    doc.getPages();
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new AppError('error.pdfEncryptedEdit');
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (/encrypt/i.test(msg)) throw new AppError('error.pdfEncryptedEdit', undefined, msg);
    throw new AppError('error.pdfParseEdit', undefined, msg);
  }
  if (count === 0) throw new AppError('error.pdfNoPages');
  return doc;
}

export interface InspectResult {
  pageCount: number;
}

export async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  const doc = await loadForEditing(bytes);
  return { pageCount: doc.getPageCount() };
}
