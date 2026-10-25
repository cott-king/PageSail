import { compose, type Matrix } from '../affine';
import type { ExifOrientation } from './header';

/**
 * Maps stored pixel coordinates (y down, size w × h) to displayed pixel coordinates
 * for each EXIF orientation value.
 */
export function orientationMatrix(o: ExifOrientation, w: number, h: number): Matrix {
  switch (o) {
    case 1:
      return [1, 0, 0, 1, 0, 0];
    case 2: // mirror horizontal
      return [-1, 0, 0, 1, w, 0];
    case 3: // rotate 180
      return [-1, 0, 0, -1, w, h];
    case 4: // mirror vertical
      return [1, 0, 0, -1, 0, h];
    case 5: // transpose
      return [0, 1, 1, 0, 0, 0];
    case 6: // rotate 90 CW
      return [0, 1, -1, 0, h, 0];
    case 7: // transverse
      return [0, -1, -1, 0, h, w];
    case 8: // rotate 90 CCW
      return [0, -1, 1, 0, 0, w];
  }
}

/**
 * Matrix for the PDF `cm` operator that draws an image XObject (unit square, first row
 * at the top) so that the *displayed* image fills the rectangle (x, y, width, height)
 * in PDF user space (y up), honouring EXIF orientation.
 */
export function pdfImagePlacement(
  o: ExifOrientation,
  storedWidth: number,
  storedHeight: number,
  rect: { x: number; y: number; width: number; height: number },
): Matrix {
  const swap = o >= 5;
  const dispW = swap ? storedHeight : storedWidth;
  const dispH = swap ? storedWidth : storedHeight;
  // unit square (y up) → stored pixels (y down)
  const unitToStored: Matrix = [storedWidth, 0, 0, -storedHeight, 0, storedHeight];
  // displayed pixels (y down) → PDF rectangle (y up)
  const displayToRect: Matrix = [rect.width / dispW, 0, 0, -rect.height / dispH, rect.x, rect.y + rect.height];
  return compose(displayToRect, orientationMatrix(o, storedWidth, storedHeight), unitToStored);
}
