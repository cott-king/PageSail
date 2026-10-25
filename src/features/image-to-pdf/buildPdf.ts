import { PDFDocument, clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, rectangle } from 'pdf-lib';
import { AppError, toAppError } from '../../lib/errors';
import type { ExifOrientation } from '../../lib/images/header';
import { pdfImagePlacement } from '../../lib/images/orientation';
import { layoutImagePage, type LayoutOptions } from './layout';

export interface ImageToPdfItem {
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  /** Stored size from the file header. */
  width: number;
  height: number;
  orientation: ExifOrientation;
}

export type ProgressFn = (done: number, total: number) => void;

/**
 * Builds a PDF with one page per image, in the given order. Original JPEG data is
 * embedded as-is (no re-encoding); PNGs are embedded losslessly with their alpha channel.
 * Runs in a Web Worker in the app and directly in Node in the unit tests.
 */
export async function imagesToPdf(items: ImageToPdfItem[], options: LayoutOptions, onProgress?: ProgressFn): Promise<Uint8Array> {
  if (items.length === 0) throw new AppError('error.noFiles');
  const doc = await PDFDocument.create();
  doc.setProducer('PageSail');
  doc.setCreator('PageSail');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let image;
    try {
      image = item.type === 'png' ? await doc.embedPng(item.bytes) : await doc.embedJpg(item.bytes);
    } catch (e) {
      throw toAppError(e, 'error.imageEmbed', { index: i + 1 });
    }
    // pdf-lib reads the stored size from the file; EXIF orientation is applied by our matrix.
    const swap = item.orientation >= 5;
    const dispW = swap ? image.height : image.width;
    const dispH = swap ? image.width : image.height;
    const layout = layoutImagePage(dispW, dispH, options);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const name = page.node.newXObject('Image', image.ref);
    const ops = [pushGraphicsState()];
    if (layout.clip) {
      ops.push(rectangle(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height), clip(), endPath());
    }
    ops.push(concatTransformationMatrix(...pdfImagePlacement(item.orientation, image.width, image.height, layout.image)), drawObject(name), popGraphicsState());
    page.pushOperators(...ops);
    onProgress?.(i + 1, items.length);
  }
  return doc.save({ useObjectStreams: true });
}
