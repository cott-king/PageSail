import fontkit from '@pdf-lib/fontkit';
import {
  LineCapStyle,
  LineJoinStyle,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  appendBezierCurve,
  beginText,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  endText,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { compose, isFiniteMatrix, type Matrix } from '../../lib/affine';
import { AppError } from '../../lib/errors';
import { pdfImagePlacement } from '../../lib/images/orientation';
import { loadForEditing } from '../../lib/pdf/pdfLibLoad';
import type { Annotation, AnnotationExportInput, PathCommand, RGBA, StrokeStyle } from './model';

export type ProgressFn = (done: number, total: number) => void;

/** Flips local y-down space to y-up so glyphs and images are drawn upright. */
const FLIP_Y: Matrix = [1, 0, 0, -1, 0, 0];
/** Bezier circle constant. */
const KAPPA = 0.5522847498307936;

/** Characters that render as nothing in the browser and must not become .notdef boxes. */
const IGNORABLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\uFE00-\uFE0F]/g;

const POSTSCRIPT_NAMES: Record<string, string> = {
  'noto-sans': 'NotoSans-Regular',
  'noto-sans-sc': 'NotoSansSC-Regular',
  'noto-sans-jp': 'NotoSansJP-Regular',
};

/**
 * PDF requires subset fonts to be named "ABCDEF+PostScriptName" (ISO 32000 §9.6.4).
 * pdf-lib appends a random number instead, so we pass a tag derived from the text.
 */
export function subsetFontName(fontId: string, text: string): string {
  let h = 2166136261;
  for (const ch of `${fontId}\u0000${text}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + Math.imul(i + 7, 2654435761) >>> 0;
  }
  return `${tag}+${POSTSCRIPT_NAMES[fontId] ?? 'PageSailFont'}`;
}

export function cleanTextForPdf(text: string): string {
  return text.replace(IGNORABLE, '').replace(/\t/g, '    ');
}

interface PageContext {
  page: PDFPage;
  gsCache: Map<string, PDFName>;
  fontKeys: Map<string, PDFName>;
  imageKeys: Map<string, PDFName>;
}

function graphicsState(doc: PDFDocument, pc: PageContext, fillAlpha: number, strokeAlpha: number): PDFName | null {
  const ca = Math.round(Math.min(1, Math.max(0, fillAlpha)) * 1000) / 1000;
  const CA = Math.round(Math.min(1, Math.max(0, strokeAlpha)) * 1000) / 1000;
  if (ca >= 1 && CA >= 1) return null;
  const key = `${ca}/${CA}`;
  let name = pc.gsCache.get(key);
  if (!name) {
    const ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca, CA }));
    name = pc.page.node.newExtGState('PSGS', ref);
    pc.gsCache.set(key, name);
  }
  return name;
}

function strokeOps(s: StrokeStyle): PDFOperator[] {
  if (!s.stroke || !(s.strokeWidth > 0)) return [];
  const ops = [
    setStrokingRgbColor(s.stroke.r, s.stroke.g, s.stroke.b),
    setLineWidth(s.strokeWidth),
    setLineCap(s.lineCap === 'round' ? LineCapStyle.Round : s.lineCap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt),
    setLineJoin(s.lineJoin === 'round' ? LineJoinStyle.Round : s.lineJoin === 'bevel' ? LineJoinStyle.Bevel : LineJoinStyle.Miter),
    PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [PDFNumber.of(Math.max(1, s.miterLimit))]),
  ];
  if (s.dash && s.dash.length > 0 && s.dash.some((d) => d > 0)) ops.push(setDashPattern(s.dash, 0));
  return ops;
}

function paintOp(hasFill: boolean, hasStroke: boolean): PDFOperator {
  if (hasFill && hasStroke) return fillAndStroke();
  if (hasFill) return fill();
  if (hasStroke) return stroke();
  return endPath();
}

function pathOps(commands: PathCommand[]): PDFOperator[] {
  const ops: PDFOperator[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const c of commands) {
    switch (c[0]) {
      case 'M':
        ops.push(moveTo(c[1], c[2]));
        cx = sx = c[1];
        cy = sy = c[2];
        break;
      case 'L':
        ops.push(lineTo(c[1], c[2]));
        cx = c[1];
        cy = c[2];
        break;
      case 'C':
        ops.push(appendBezierCurve(c[1], c[2], c[3], c[4], c[5], c[6]));
        cx = c[5];
        cy = c[6];
        break;
      case 'Q': {
        // PDF has no quadratic curves: elevate to an equivalent cubic.
        const [, qx, qy, x, y] = c;
        ops.push(appendBezierCurve(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y));
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        ops.push(closePath());
        cx = sx;
        cy = sy;
        break;
    }
  }
  return ops;
}

function ellipseOps(rx: number, ry: number): PDFOperator[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    moveTo(rx, 0),
    appendBezierCurve(rx, ky, kx, ry, 0, ry),
    appendBezierCurve(-kx, ry, -rx, ky, -rx, 0),
    appendBezierCurve(-rx, -ky, -kx, -ry, 0, -ry),
    appendBezierCurve(kx, -ry, rx, -ky, rx, 0),
    closePath(),
  ];
}

function alpha(c: RGBA | null): number {
  return c ? c.a : 1;
}

function validate(a: Annotation): void {
  if (!isFiniteMatrix(a.matrix)) throw new AppError('error.internal', undefined, `Invalid matrix for ${a.kind}`);
}

async function drawAnnotation(
  doc: PDFDocument,
  pc: PageContext,
  displayToPdf: Matrix,
  a: Annotation,
  fonts: Map<string, PDFFont>,
  images: Map<string, { image: PDFImage; orientation: AnnotationExportInput['images'][string]['orientation'] }>,
): Promise<void> {
  validate(a);
  const opacity = Math.min(1, Math.max(0, a.opacity));
  const toPdf = compose(displayToPdf, a.matrix);
  const ops: PDFOperator[] = [pushGraphicsState()];

  switch (a.kind) {
    case 'rect':
    case 'ellipse':
    case 'path': {
      const hasFill = !!a.fill && a.fill.a > 0;
      const hasStroke = !!a.stroke && a.stroke.a > 0 && a.strokeWidth > 0;
      if (!hasFill && !hasStroke) return;
      const gs = graphicsState(doc, pc, alpha(a.fill) * opacity, alpha(a.stroke) * opacity);
      if (gs) ops.push(setGraphicsState(gs));
      ops.push(concatTransformationMatrix(...toPdf));
      if (hasFill) ops.push(setFillingRgbColor(a.fill!.r, a.fill!.g, a.fill!.b));
      if (hasStroke) ops.push(...strokeOps(a));
      if (a.kind === 'rect') ops.push(rectangle(-a.width / 2, -a.height / 2, a.width, a.height));
      else if (a.kind === 'ellipse') ops.push(...ellipseOps(a.rx, a.ry));
      else ops.push(...pathOps(a.commands));
      ops.push(paintOp(hasFill, hasStroke));
      break;
    }
    case 'text': {
      const font = fonts.get(a.fontId);
      if (!font) throw new AppError('error.fontMissing', { font: a.fontId });
      let key = pc.fontKeys.get(a.fontId);
      if (!key) {
        key = pc.page.node.newFontDictionary(font.name, font.ref);
        pc.fontKeys.set(a.fontId, key);
      }
      const gs = graphicsState(doc, pc, a.color.a * opacity, 1);
      if (gs) ops.push(setGraphicsState(gs));
      ops.push(concatTransformationMatrix(...compose(toPdf, FLIP_Y)), setFillingRgbColor(a.color.r, a.color.g, a.color.b));
      for (const line of a.lines) {
        const text = cleanTextForPdf(line.text);
        if (!text.trim()) continue;
        ops.push(beginText(), setFontAndSize(key, a.fontSize), setTextMatrix(1, 0, 0, 1, line.x, -line.y), showText(font.encodeText(text)), endText());
      }
      break;
    }
    case 'image': {
      const entry = images.get(a.imageId);
      if (!entry) throw new AppError('error.internal', undefined, `Missing image ${a.imageId}`);
      let key = pc.imageKeys.get(a.imageId);
      if (!key) {
        key = pc.page.node.newXObject('PSImg', entry.image.ref);
        pc.imageKeys.set(a.imageId, key);
      }
      const gs = graphicsState(doc, pc, opacity, opacity);
      if (gs) ops.push(setGraphicsState(gs));
      const rect = { x: -a.width / 2, y: -a.height / 2, width: a.width, height: a.height };
      ops.push(
        concatTransformationMatrix(...compose(toPdf, FLIP_Y)),
        concatTransformationMatrix(...pdfImagePlacement(entry.orientation, entry.image.width, entry.image.height, rect)),
        drawObject(key),
      );
      break;
    }
  }
  ops.push(popGraphicsState());
  pc.page.pushOperators(...ops);
}

/**
 * Writes the added content into the original PDF. Existing page content is left as it
 * is (pdf-lib wraps it in q/Q so its graphics state cannot leak into ours), which keeps
 * original text and vector graphics intact — nothing is rasterised. New shapes become
 * PDF paths, new text becomes real text in a subset-embedded font with a ToUnicode map.
 */
export async function exportAnnotatedPdf(input: AnnotationExportInput, onProgress?: ProgressFn): Promise<Uint8Array> {
  const doc = await loadForEditing(input.pdf);
  doc.registerFontkit(fontkit);

  const usedFonts = new Set<string>();
  const usedImages = new Set<string>();
  for (const p of input.pages) {
    for (const a of p.annotations) {
      if (a.kind === 'text') usedFonts.add(a.fontId);
      if (a.kind === 'image') usedImages.add(a.imageId);
    }
  }

  const fonts = new Map<string, PDFFont>();
  for (const id of usedFonts) {
    const bytes = input.fonts[id];
    if (!bytes) throw new AppError('error.fontMissing', { font: id });
    const text = input.pages.flatMap((p) => p.annotations.flatMap((a) => (a.kind === 'text' && a.fontId === id ? a.lines.map((l) => l.text) : []))).join('\n');
    fonts.set(id, await doc.embedFont(bytes, { subset: true, customName: subsetFontName(id, text) }));
  }
  const images = new Map<string, { image: PDFImage; orientation: AnnotationExportInput['images'][string]['orientation'] }>();
  for (const id of usedImages) {
    const img = input.images[id];
    if (!img) throw new AppError('error.internal', undefined, `Missing image ${id}`);
    try {
      const image = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
      images.set(id, { image, orientation: img.orientation });
    } catch (e) {
      throw new AppError('error.imageEmbed', { index: 1 }, e instanceof Error ? e.message : String(e));
    }
  }

  const pageCount = doc.getPageCount();
  const total = input.pages.length + 1;
  let done = 0;
  for (const p of input.pages) {
    if (p.pageIndex < 0 || p.pageIndex >= pageCount) throw new AppError('error.internal', undefined, `Page ${p.pageIndex} out of range`);
    if (!isFiniteMatrix(p.displayToPdf)) throw new AppError('error.internal', undefined, 'Invalid page matrix');
    const pc: PageContext = { page: doc.getPage(p.pageIndex), gsCache: new Map(), fontKeys: new Map(), imageKeys: new Map() };
    for (const a of p.annotations) {
      await drawAnnotation(doc, pc, p.displayToPdf, a, fonts, images);
    }
    onProgress?.(++done, total);
  }
  doc.setModificationDate(new Date());
  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(total, total);
  return bytes;
}
