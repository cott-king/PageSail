import { invert, type Matrix } from '../affine';

/**
 * Page coordinate model shared by preview and export.
 *
 * "Display space" is what the visitor sees: the page's visible box (CropBox ∩ MediaBox,
 * as reported by pdf.js `page.view`) after applying `/Rotate`, with the origin at the
 * top-left corner, y pointing down, and 1 unit = 1 PDF unit × UserUnit (= pdf.js
 * viewport at scale 1). Editor objects are stored in display space, independent of
 * zoom and devicePixelRatio; zoom is applied only as a canvas view transform.
 *
 * "User space" is the PDF page coordinate system (y up) in which new content is written.
 */
export interface PageGeometry {
  /** Visible box `[x0, y0, x1, y1]` in PDF user space (pdf.js `page.view`). */
  view: [number, number, number, number];
  /** Page rotation, clockwise, normalised to 0/90/180/270 (pdf.js `page.rotate`). */
  rotate: number;
  /** PDF /UserUnit (pdf.js `page.userUnit`), usually 1. */
  userUnit: number;
}

export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

function normalizedView(view: PageGeometry['view']): [number, number, number, number] {
  const [a, b, c, d] = view;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** Width and height of the page in display space. */
export function displaySize(g: PageGeometry): { width: number; height: number } {
  const [x0, y0, x1, y1] = normalizedView(g.view);
  const s = g.userUnit || 1;
  const w = (x1 - x0) * s;
  const h = (y1 - y0) * s;
  const r = normalizeRotation(g.rotate);
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * User space → display space. Equivalent to pdf.js `page.getViewport({ scale: 1 }).transform`
 * (verified in tests/unit/coords.test.ts against pdf.js itself).
 */
export function pdfToDisplayMatrix(g: PageGeometry): Matrix {
  const [x0, y0, x1, y1] = normalizedView(g.view);
  const s = g.userUnit || 1;
  switch (normalizeRotation(g.rotate)) {
    case 0:
      return [s, 0, 0, -s, -x0 * s, y1 * s];
    case 90:
      return [0, s, s, 0, -y0 * s, -x0 * s];
    case 180:
      return [-s, 0, 0, s, x1 * s, -y0 * s];
    case 270:
      return [0, -s, -s, 0, y1 * s, x1 * s];
  }
}

/** Display space → user space: the matrix used to place new content into the PDF. */
export function displayToPdfMatrix(g: PageGeometry): Matrix {
  return invert(pdfToDisplayMatrix(g));
}
