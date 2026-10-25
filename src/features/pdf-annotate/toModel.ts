import { Color, Ellipse, FabricImage, FabricText, Path, Rect, type FabricObject } from 'fabric';
import type { Matrix } from '../../lib/affine';
import { kindOf } from '../../editor/fabricKit';
import type { FontId } from '../../editor/fonts';
import type { Annotation, PathCommand, RGBA, StrokeStyle } from './model';

export function parseColor(c: unknown): RGBA | null {
  if (typeof c !== 'string' || c === '' || c === 'transparent' || c === 'none') return null;
  try {
    const [r, g, b, a] = new Color(c).getSource();
    return { r: r / 255, g: g / 255, b: b / 255, a: a ?? 1 };
  } catch {
    return null;
  }
}

function strokeStyle(o: FabricObject): StrokeStyle {
  const lineCap = o.strokeLineCap === 'round' || o.strokeLineCap === 'square' ? o.strokeLineCap : 'butt';
  const lineJoin = o.strokeLineJoin === 'round' || o.strokeLineJoin === 'bevel' ? o.strokeLineJoin : 'miter';
  return {
    stroke: parseColor(o.stroke),
    strokeWidth: o.strokeWidth ?? 0,
    dash: o.strokeDashArray?.length ? [...o.strokeDashArray] : null,
    lineCap,
    lineJoin,
    miterLimit: o.strokeMiterLimit ?? 4,
  };
}

/** Internal Fabric text layout members we mirror so baselines match the preview exactly. */
interface TextLayout {
  _textLines: string[][];
  _fontSizeFraction: number;
  lineHeight: number;
  _getLeftOffset(): number;
  _getTopOffset(): number;
  _getLineLeftOffset(i: number): number;
  getHeightOfLine(i: number): number;
}

export function textLines(t: FabricText): { text: string; x: number; y: number }[] {
  const layout = t as unknown as TextLayout;
  const left = layout._getLeftOffset();
  let top = layout._getTopOffset();
  const out: { text: string; x: number; y: number }[] = [];
  for (let i = 0; i < layout._textLines.length; i++) {
    const heightOfLine = layout.getHeightOfLine(i);
    // Fabric: baseline = lineTop + lineHeightImpl - lineHeightImpl * _fontSizeFraction
    const impl = heightOfLine / layout.lineHeight;
    out.push({
      text: layout._textLines[i].join(''),
      x: left + layout._getLineLeftOffset(i),
      y: top + impl * (1 - layout._fontSizeFraction),
    });
    top += heightOfLine;
  }
  return out;
}

function localPath(p: Path): PathCommand[] {
  const ox = p.pathOffset.x;
  const oy = p.pathOffset.y;
  const out: PathCommand[] = [];
  for (const seg of p.path as unknown as (string | number)[][]) {
    const [cmd, ...v] = seg as [string, ...number[]];
    switch (cmd) {
      case 'M':
      case 'L':
        out.push([cmd, v[0] - ox, v[1] - oy]);
        break;
      case 'C':
        out.push(['C', v[0] - ox, v[1] - oy, v[2] - ox, v[3] - oy, v[4] - ox, v[5] - oy]);
        break;
      case 'Q':
        out.push(['Q', v[0] - ox, v[1] - oy, v[2] - ox, v[3] - oy]);
        break;
      case 'Z':
      case 'z':
        out.push(['Z']);
        break;
      default:
        // Fabric normalises paths to M/L/C/Q/Z; anything else is a bug worth surfacing.
        throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return out;
}

/** Converts one Fabric object (in page display space) into the export model. */
export function objectToAnnotation(o: FabricObject): Annotation | null {
  if (!o.visible) return null;
  const matrix = o.calcTransformMatrix() as unknown as Matrix;
  const opacity = o.opacity ?? 1;
  const kind = kindOf(o);
  if (o instanceof FabricText) {
    const color = parseColor(o.fill) ?? { r: 0, g: 0, b: 0, a: 1 };
    const fontId = (o as FabricText & { psFontId?: FontId }).psFontId ?? 'noto-sans-sc';
    return { kind: 'text', matrix, opacity, fontId, fontSize: o.fontSize, color, lines: textLines(o) };
  }
  if (o instanceof FabricImage) {
    const imageId = (o as FabricImage & { psImageId?: string }).psImageId;
    if (!imageId) return null;
    return { kind: 'image', matrix, opacity, imageId, width: o.width, height: o.height };
  }
  if (o instanceof Rect) {
    return { kind: 'rect', matrix, opacity, width: o.width, height: o.height, fill: parseColor(o.fill), ...strokeStyle(o) };
  }
  if (o instanceof Ellipse) {
    return { kind: 'ellipse', matrix, opacity, rx: o.rx, ry: o.ry, fill: parseColor(o.fill), ...strokeStyle(o) };
  }
  if (o instanceof Path) {
    return { kind: 'path', matrix, opacity, commands: localPath(o), fill: kind === 'freehand' ? null : parseColor(o.fill), ...strokeStyle(o) };
  }
  return null;
}
