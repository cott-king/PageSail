import type { Matrix } from '../../lib/affine';
import type { ExifOrientation } from '../../lib/images/header';

/**
 * Serializable description of everything the visitor added to a PDF. The editor converts
 * Fabric objects into this model; the exporter (Web Worker, pdf-lib) turns it into PDF
 * operators. Keeping this boundary explicit makes the export testable without a browser.
 *
 * Every annotation has `matrix`: object-local space (origin at the object's centre,
 * y down, as Fabric draws it) → page display space (see lib/pdf/coords.ts).
 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

export type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

export interface StrokeStyle {
  stroke: RGBA | null;
  strokeWidth: number;
  dash: number[] | null;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
}

interface Base {
  matrix: Matrix;
  /** Object opacity 0..1, multiplied with colour alpha. */
  opacity: number;
}

export interface RectAnnotation extends Base, StrokeStyle {
  kind: 'rect';
  width: number;
  height: number;
  fill: RGBA | null;
}

export interface EllipseAnnotation extends Base, StrokeStyle {
  kind: 'ellipse';
  rx: number;
  ry: number;
  fill: RGBA | null;
}

export interface PathAnnotation extends Base, StrokeStyle {
  kind: 'path';
  commands: PathCommand[];
  fill: RGBA | null;
}

export interface TextLine {
  text: string;
  /** Start of the baseline in object-local space (y down). */
  x: number;
  y: number;
}

export interface TextAnnotation extends Base {
  kind: 'text';
  fontId: string;
  fontSize: number;
  color: RGBA;
  lines: TextLine[];
}

export interface ImageAnnotation extends Base {
  kind: 'image';
  imageId: string;
  /** Displayed (EXIF-oriented) size in object-local units. */
  width: number;
  height: number;
}

export type Annotation = RectAnnotation | EllipseAnnotation | PathAnnotation | TextAnnotation | ImageAnnotation;

export interface AnnotatedPage {
  pageIndex: number;
  /** Page display space → PDF user space (inverse of the pdf.js viewport transform at scale 1). */
  displayToPdf: Matrix;
  annotations: Annotation[];
}

export interface EmbeddedImage {
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  /** Stored size from the header. */
  width: number;
  height: number;
  orientation: ExifOrientation;
}

export interface AnnotationExportInput {
  pdf: Uint8Array;
  pages: AnnotatedPage[];
  fonts: Record<string, Uint8Array>;
  images: Record<string, EmbeddedImage>;
}
