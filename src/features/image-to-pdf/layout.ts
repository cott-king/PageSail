import { AppError } from '../../lib/errors';

/** Pure page-layout math for Image → PDF. Shared by the on-screen preview and the exporter. */

export type PageSizeId = 'a4' | 'letter' | 'legal' | 'a3' | 'a5' | 'fit';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type FitMode = 'contain' | 'cover' | 'actual';

/** Portrait sizes in PDF points (1/72 inch). */
export const PAGE_SIZES: Record<Exclude<PageSizeId, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};

/** Pixels are treated as CSS pixels (96 per inch) when an image is placed at "actual size". */
export const PX_TO_PT = 72 / 96;

export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

export interface LayoutOptions {
  pageSize: PageSizeId;
  orientation: PageOrientation;
  marginPt: number;
  fit: FitMode;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  /** Where the (displayed, EXIF-oriented) image is drawn, PDF user space (y up). */
  image: Rect;
  /** Clip rectangle when the image is larger than the content box (cover mode). */
  clip?: Rect;
}

export function layoutImagePage(imgWidth: number, imgHeight: number, opts: LayoutOptions): PageLayout {
  if (!(imgWidth > 0 && imgHeight > 0)) throw new AppError('error.imageCorrupt');
  const margin = Math.max(0, opts.marginPt);

  if (opts.pageSize === 'fit') {
    const w = imgWidth * PX_TO_PT;
    const h = imgHeight * PX_TO_PT;
    return {
      pageWidth: w + 2 * margin,
      pageHeight: h + 2 * margin,
      image: { x: margin, y: margin, width: w, height: h },
    };
  }

  const [pw, ph] = PAGE_SIZES[opts.pageSize];
  const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && imgWidth > imgHeight);
  const pageWidth = landscape ? ph : pw;
  const pageHeight = landscape ? pw : ph;
  const boxW = pageWidth - 2 * margin;
  const boxH = pageHeight - 2 * margin;
  if (boxW < 36 || boxH < 36) throw new AppError('error.marginTooLarge');

  let s: number;
  if (opts.fit === 'cover') s = Math.max(boxW / imgWidth, boxH / imgHeight);
  else if (opts.fit === 'actual') s = Math.min(PX_TO_PT, boxW / imgWidth, boxH / imgHeight);
  else s = Math.min(boxW / imgWidth, boxH / imgHeight);

  const w = imgWidth * s;
  const h = imgHeight * s;
  const image = { x: margin + (boxW - w) / 2, y: margin + (boxH - h) / 2, width: w, height: h };
  const needsClip = w > boxW + 1e-6 || h > boxH + 1e-6;
  return {
    pageWidth,
    pageHeight,
    image,
    clip: needsClip ? { x: margin, y: margin, width: boxW, height: boxH } : undefined,
  };
}
