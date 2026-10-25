import {
  ActiveSelection,
  Color,
  Ellipse,
  FabricImage,
  FabricObject,
  FabricText,
  InteractiveFabricObject,
  Path,
  PencilBrush,
  Point,
  Rect,
  util,
  type Canvas,
  type TPointerEventInfo,
} from 'fabric';
import { fontDef, fontIdForFamily, type FontId } from './fonts';

/**
 * Shared Fabric.js setup for the PDF annotator and the image editor.
 * Objects carry `psKind` (what the visitor created) plus font/image ids so they can be
 * serialised for undo/redo and converted for export.
 */
export type ObjectKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'freehand' | 'text' | 'image';
export type ToolId = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen';

FabricObject.customProperties = ['psKind', 'psFontId', 'psImageId'];
Object.assign(InteractiveFabricObject.ownDefaults, {
  transparentCorners: false,
  cornerColor: '#ffffff',
  cornerStrokeColor: '#2f6fec',
  borderColor: '#2f6fec',
  cornerStyle: 'circle',
  cornerSize: 11,
  touchCornerSize: 28,
  padding: 4,
  borderScaleFactor: 1.5,
  lockScalingFlip: true,
});

export interface DrawStyle {
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
  dashed: boolean;
  textColor: string;
  fontSize: number;
  fontId: FontId;
}

export function kindOf(obj: FabricObject): ObjectKind | undefined {
  return (obj as FabricObject & { psKind?: ObjectKind }).psKind;
}

function dashFor(style: Pick<DrawStyle, 'dashed' | 'strokeWidth'>): number[] | null {
  return style.dashed ? [Math.max(2, style.strokeWidth * 3), Math.max(2, style.strokeWidth * 2)] : null;
}

function shapeProps(style: DrawStyle) {
  return {
    stroke: style.strokeWidth > 0 ? style.stroke : null,
    strokeWidth: style.strokeWidth,
    fill: style.fill,
    opacity: style.opacity,
    strokeDashArray: dashFor(style),
    strokeLineJoin: 'miter' as const,
    strokeUniform: false,
  };
}

export function createRect(a: Point, b: Point, style: DrawStyle): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  const rect = new Rect({ ...shapeProps(style), width: w, height: h });
  rect.set({ psKind: 'rect' } as never);
  rect.setPositionByOrigin(new Point(x, y), 'left', 'top');
  return rect;
}

export function createEllipse(a: Point, b: Point, style: DrawStyle): Ellipse {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const e = new Ellipse({ ...shapeProps(style), rx: Math.abs(a.x - b.x) / 2, ry: Math.abs(a.y - b.y) / 2 });
  e.set({ psKind: 'ellipse' } as never);
  e.setPositionByOrigin(new Point(x, y), 'left', 'top');
  return e;
}

export function arrowPathData(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const head = Math.min(len * 0.6, Math.max(10, strokeWidth * 4));
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const px = -uy * head * 0.5;
  const py = ux * head * 0.5;
  return `M ${x1} ${y1} L ${bx} ${by} M ${x2} ${y2} L ${bx + px} ${by + py} L ${bx - px} ${by - py} Z`;
}

export function createLine(a: Point, b: Point, style: DrawStyle, arrow: boolean): Path {
  const d = arrow ? arrowPathData(a.x, a.y, b.x, b.y, style.strokeWidth) : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const width = Math.max(1, style.strokeWidth);
  const p = new Path(d, {
    stroke: style.stroke,
    strokeWidth: width,
    fill: arrow ? style.stroke : null,
    opacity: style.opacity,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeDashArray: arrow ? null : dashFor({ dashed: style.dashed, strokeWidth: width }),
  });
  p.set({ psKind: arrow ? 'arrow' : 'line' } as never);
  return p;
}

export function createText(text: string, at: Point, style: DrawStyle): FabricText {
  const def = fontDef(style.fontId);
  const t = new FabricText(text, {
    fontFamily: def.family,
    fontSize: style.fontSize,
    fill: style.textColor,
    opacity: style.opacity,
    lineHeight: 1.2,
    textAlign: 'left',
  });
  t.set({ psKind: 'text', psFontId: style.fontId } as never);
  t.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
  t.setPositionByOrigin(at, 'left', 'top');
  return t;
}

export async function createImage(url: string, imageId: string, center: Point, maxW: number, maxH: number): Promise<FabricImage> {
  const img = await FabricImage.fromURL(url);
  const s = Math.min(1, maxW / img.width, maxH / img.height);
  img.set({ scaleX: s, scaleY: s, psKind: 'image', psImageId: imageId } as never);
  img.setPositionByOrigin(center, 'center', 'center');
  return img;
}

/** Re-applies per-type UI settings after objects are restored from JSON. */
export function decorate(obj: FabricObject): void {
  if (kindOf(obj) === 'text' || obj instanceof FabricText) {
    obj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
  }
}

/** Absolute (selection-independent) serialisation for undo snapshots. */
export function snapshotCanvas(canvas: Canvas, filter: (o: FabricObject) => boolean = () => true): object[] {
  const json = canvas.toObject(FabricObject.customProperties) as { objects: (object & { psKind?: string })[] };
  const objects = canvas.getObjects();
  return json.objects.filter((_, i) => filter(objects[i]));
}

export async function enliven(json: object[]): Promise<FabricObject[]> {
  const objs = (await util.enlivenObjects(json)) as FabricObject[];
  objs.forEach(decorate);
  return objs;
}

/** Selected objects (flattening an ActiveSelection). */
export function selectedObjects(canvas: Canvas): FabricObject[] {
  const active = canvas.getActiveObject();
  if (!active) return [];
  if (active instanceof ActiveSelection) return active.getObjects();
  return [active];
}

export function toHexColor(c: unknown, fallback = '#000000'): string {
  if (typeof c !== 'string' || !c || c === 'transparent') return fallback;
  try {
    return `#${new Color(c).toHex()}`.toLowerCase();
  } catch {
    return fallback;
  }
}

export interface SelectionInfo {
  count: number;
  kinds: ObjectKind[];
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
  dashed: boolean;
  text?: string;
  fontSize?: number;
  fontId?: FontId;
  textColor?: string;
}

export function describeSelection(canvas: Canvas): SelectionInfo | null {
  const objs = selectedObjects(canvas);
  if (objs.length === 0) return null;
  const first = objs[0];
  const kinds = [...new Set(objs.map((o) => kindOf(o)).filter(Boolean))] as ObjectKind[];
  const info: SelectionInfo = {
    count: objs.length,
    kinds,
    stroke: toHexColor(first.stroke, '#e5484d'),
    fill: first.fill && first.fill !== 'transparent' && kindOf(first) !== 'arrow' ? toHexColor(first.fill) : null,
    strokeWidth: first.strokeWidth ?? 0,
    opacity: first.opacity ?? 1,
    dashed: !!first.strokeDashArray?.length,
  };
  if (objs.length === 1 && first instanceof FabricText) {
    info.text = first.text;
    info.fontSize = Math.round(first.fontSize * (first.scaleX ?? 1) * 10) / 10;
    info.fontId = (first as FabricText & { psFontId?: FontId }).psFontId ?? fontIdForFamily(first.fontFamily);
    info.textColor = toHexColor(first.fill);
  }
  return info;
}

export interface StylePatch {
  stroke?: string;
  fill?: string | null;
  strokeWidth?: number;
  opacity?: number;
  dashed?: boolean;
  textColor?: string;
  fontSize?: number;
  fontId?: FontId;
  text?: string;
}

/** Applies a style change to the selected objects; text keeps its top-left corner in place. */
export function applyStyle(canvas: Canvas, patch: StylePatch): void {
  const objs = selectedObjects(canvas);
  const active = canvas.getActiveObject();
  for (const o of objs) {
    const kind = kindOf(o);
    if (o instanceof FabricText) {
      const anchor = o.getPointByOrigin('left', 'top');
      const props: Record<string, unknown> = {};
      if (patch.text !== undefined) props.text = patch.text;
      if (patch.textColor !== undefined) props.fill = patch.textColor;
      if (patch.opacity !== undefined) props.opacity = patch.opacity;
      if (patch.fontId !== undefined) {
        props.fontFamily = fontDef(patch.fontId).family;
        props.psFontId = patch.fontId;
      }
      if (patch.fontSize !== undefined) {
        // Bake uniform scaling into fontSize so the number shown is the real size.
        props.fontSize = patch.fontSize / (o.scaleX || 1);
      }
      o.set(props);
      o.setPositionByOrigin(anchor, 'left', 'top');
    } else {
      const props: Record<string, unknown> = {};
      if (patch.opacity !== undefined) props.opacity = patch.opacity;
      if (patch.stroke !== undefined) {
        props.stroke = patch.stroke;
        if (kind === 'arrow') props.fill = patch.stroke;
      }
      if (patch.fill !== undefined && (kind === 'rect' || kind === 'ellipse')) props.fill = patch.fill;
      const width = patch.strokeWidth ?? o.strokeWidth ?? 0;
      if (patch.strokeWidth !== undefined) {
        props.strokeWidth = kind === 'line' || kind === 'arrow' || kind === 'freehand' ? Math.max(1, width) : width;
        if ((kind === 'rect' || kind === 'ellipse') && width > 0 && !o.stroke) props.stroke = patch.stroke ?? '#e5484d';
      }
      const dashed = patch.dashed ?? !!o.strokeDashArray?.length;
      if ((patch.dashed !== undefined || patch.strokeWidth !== undefined) && kind !== 'freehand' && kind !== 'arrow' && kind !== 'image') {
        props.strokeDashArray = dashed ? dashFor({ dashed, strokeWidth: width }) : null;
      }
      o.set(props);
    }
    o.setCoords();
  }
  if (active instanceof ActiveSelection) active.setCoords();
  canvas.requestRenderAll();
}

export function bakeTextScale(o: FabricObject): void {
  if (!(o instanceof FabricText)) return;
  const sx = o.scaleX ?? 1;
  const sy = o.scaleY ?? 1;
  if (Math.abs(sx - sy) > 1e-6 || Math.abs(sx - 1) < 1e-6) return;
  const anchor = o.getCenterPoint();
  o.set({ fontSize: o.fontSize * sx, scaleX: 1, scaleY: 1 });
  o.setPositionByOrigin(anchor, 'center', 'center');
  o.setCoords();
}

interface DrawingHooks {
  getStyle(): DrawStyle;
  onCreated(obj: FabricObject): void;
  onTextClick(point: Point): void;
  /** Called with the scene point while dragging a shape; return a clamped point. */
  clamp?(p: Point): Point;
}

/**
 * Turns pointer input into new shapes. Temporary preview objects are added while the
 * pointer is down; undo history is only recorded once a shape is finished.
 */
export class DrawingController {
  tool: ToolId = 'select';
  private start: Point | null = null;
  private temp: FabricObject | null = null;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly canvas: Canvas,
    private readonly hooks: DrawingHooks,
  ) {
    const down = (opt: TPointerEventInfo) => this.onDown(opt);
    const move = (opt: TPointerEventInfo) => this.onMove(opt);
    const up = () => this.onUp();
    const pathCreated = ({ path }: { path: FabricObject }) => {
      const style = this.hooks.getStyle();
      path.set({ psKind: 'freehand', opacity: style.opacity, fill: null } as never);
      this.hooks.onCreated(path);
    };
    canvas.on('mouse:down', down);
    canvas.on('mouse:move', move);
    canvas.on('mouse:up', up);
    canvas.on('path:created', pathCreated as never);
    this.off.push(
      () => canvas.off('mouse:down', down),
      () => canvas.off('mouse:move', move),
      () => canvas.off('mouse:up', up),
      () => canvas.off('path:created', pathCreated as never),
    );
  }

  setTool(tool: ToolId): void {
    this.cancelTemp();
    this.tool = tool;
    const drawing = tool !== 'select';
    this.canvas.isDrawingMode = tool === 'pen';
    this.canvas.selection = !drawing;
    this.canvas.skipTargetFind = drawing;
    this.canvas.defaultCursor = drawing ? 'crosshair' : 'default';
    if (tool === 'pen') this.updateBrush();
    if (drawing) this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  updateBrush(): void {
    const style = this.hooks.getStyle();
    const brush = this.canvas.freeDrawingBrush instanceof PencilBrush ? this.canvas.freeDrawingBrush : new PencilBrush(this.canvas);
    brush.color = style.stroke;
    brush.width = Math.max(1, style.strokeWidth);
    brush.strokeLineCap = 'round';
    brush.strokeLineJoin = 'round';
    brush.decimate = 0.6;
    this.canvas.freeDrawingBrush = brush;
  }

  private point(opt: TPointerEventInfo): Point {
    const p = this.canvas.getScenePoint(opt.e);
    return this.hooks.clamp ? this.hooks.clamp(p) : p;
  }

  private onDown(opt: TPointerEventInfo): void {
    if (this.tool === 'select' || this.tool === 'pen') return;
    const p = this.point(opt);
    if (this.tool === 'text') {
      this.hooks.onTextClick(p);
      return;
    }
    this.start = p;
    this.temp = this.make(p, p, false);
    if (this.temp) {
      this.temp.set({ evented: false, selectable: false });
      this.canvas.add(this.temp);
    }
  }

  private constrain(a: Point, b: Point, shift: boolean): Point {
    if (!shift) return b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (this.tool === 'rect' || this.tool === 'ellipse') {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      return new Point(a.x + Math.sign(dx || 1) * s, a.y + Math.sign(dy || 1) * s);
    }
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return new Point(a.x + Math.cos(angle) * len, a.y + Math.sin(angle) * len);
  }

  private make(a: Point, b: Point, final: boolean): FabricObject | null {
    const style = this.hooks.getStyle();
    switch (this.tool) {
      case 'rect':
        return createRect(a, b, style);
      case 'ellipse':
        return createEllipse(a, b, style);
      case 'line':
      case 'arrow':
        if (!final && a.eq(b)) return null;
        return createLine(a, b, style, this.tool === 'arrow');
      default:
        return null;
    }
  }

  private onMove(opt: TPointerEventInfo): void {
    if (!this.start) return;
    const p = this.constrain(this.start, this.point(opt), (opt.e as MouseEvent).shiftKey);
    if (this.temp) this.canvas.remove(this.temp);
    this.temp = this.make(this.start, p, false);
    if (this.temp) {
      this.temp.set({ evented: false, selectable: false });
      this.canvas.add(this.temp);
    }
    this.canvas.requestRenderAll();
  }

  private onUp(): void {
    if (!this.start) return;
    const obj = this.temp;
    this.start = null;
    this.temp = null;
    if (!obj) return;
    const r = obj.getBoundingRect();
    if (r.width < 3 && r.height < 3) {
      this.canvas.remove(obj);
      this.canvas.requestRenderAll();
      return;
    }
    obj.set({ evented: true, selectable: true });
    obj.setCoords();
    this.hooks.onCreated(obj);
  }

  private cancelTemp(): void {
    if (this.temp) this.canvas.remove(this.temp);
    this.temp = null;
    this.start = null;
  }

  dispose(): void {
    this.cancelTemp();
    this.off.forEach((f) => f());
  }
}

/** Removes the selected objects; returns true if anything was removed. */
export function removeSelected(canvas: Canvas, keep?: (o: FabricObject) => boolean): boolean {
  const objs = selectedObjects(canvas).filter((o) => !keep?.(o));
  if (objs.length === 0) return false;
  canvas.discardActiveObject();
  canvas.remove(...objs);
  canvas.requestRenderAll();
  return true;
}

export type LayerMove = 'forward' | 'backward' | 'front' | 'back';

export function moveLayer(canvas: Canvas, how: LayerMove): boolean {
  const objs = selectedObjects(canvas);
  if (objs.length === 0) return false;
  const ordered = how === 'forward' || how === 'front' ? [...objs].reverse() : objs;
  for (const o of ordered) {
    if (how === 'forward') canvas.bringObjectForward(o);
    else if (how === 'backward') canvas.sendObjectBackwards(o);
    else if (how === 'front') canvas.bringObjectToFront(o);
    else canvas.sendObjectToBack(o);
  }
  canvas.requestRenderAll();
  return true;
}

export function nudgeSelected(canvas: Canvas, dx: number, dy: number): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  active.set({ left: active.left + dx, top: active.top + dy });
  active.setCoords();
  canvas.requestRenderAll();
  return true;
}
