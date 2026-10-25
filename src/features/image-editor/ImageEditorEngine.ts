import { Canvas, FabricImage, Point, Rect, StaticCanvas, util, type FabricObject, type TMat2D } from 'fabric';
import { LIMITS, PIXELS_PER_MEGAPIXEL } from '../../config';
import { compose, multiply, scale as scaleM, translate, type Matrix } from '../../lib/affine';
import { canAllocateCanvas, canvasToBlob, createCanvas, nextFrame, releaseCanvas } from '../../lib/canvas';
import { AppError } from '../../lib/errors';
import { History } from '../../editor/history';
import { DrawingController, bakeTextScale, enliven, kindOf, snapshotCanvas, type DrawStyle } from '../../editor/fabricKit';
import { applyLut, buildLut, isIdentity } from './adjust';

/** Everything about the picture except the annotation objects. Small and serialisable. */
export interface ImageDocState {
  /** Output (artboard) size in pixels. */
  width: number;
  height: number;
  /** Source pixel space → artboard space (crop, rotate, flip and resize accumulate here). */
  G: Matrix;
  brightness: number;
  contrast: number;
}

interface Snapshot {
  doc: ImageDocState;
  objects: object[];
}

interface Hooks {
  getStyle(): DrawStyle;
  onChange(): void;
  onSelection(): void;
  onTextClick(p: Point): void;
  onCreated(obj: FabricObject): void;
  onCrop(rect: CropRect | null): void;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PREVIEW_MAX_SIDE = 2048;

function isCropUi(o: FabricObject): boolean {
  return (o as FabricObject & { psKind?: string }).psKind === 'crop';
}

/**
 * Non-destructive image editing. The decoded source bitmap is never modified: crop,
 * rotation, flips and resizing accumulate in the matrix `G`, brightness/contrast are two
 * numbers, and annotations are Fabric objects in artboard pixels. The on-screen preview
 * uses a downscaled copy; export renders everything again at the real output size.
 */
export class ImageEditorEngine {
  readonly canvas: Canvas;
  readonly drawing: DrawingController;
  readonly history: History<Snapshot>;
  doc: ImageDocState;
  zoom = 1;
  version = 0;
  private readonly initial: ImageDocState;
  private readonly preview: HTMLCanvasElement;
  private readonly filtered: HTMLCanvasElement;
  private readonly previewScale: number;
  private readonly bg: FabricImage;
  private crop: Rect | null = null;
  private cropRatio: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private filterPending = false;

  constructor(
    host: HTMLElement,
    private readonly source: ImageBitmap,
    private readonly hooks: Hooks,
  ) {
    const el = document.createElement('canvas');
    host.appendChild(el);
    this.canvas = new Canvas(el, { preserveObjectStacking: true, enableRetinaScaling: true, uniformScaling: true, width: 1, height: 1 });
    this.canvas.upperCanvasEl.setAttribute('aria-hidden', 'true');

    const s = Math.min(1, PREVIEW_MAX_SIDE / Math.max(source.width, source.height));
    this.previewScale = s;
    this.preview = createCanvas(source.width * s, source.height * s);
    const pctx = this.preview.getContext('2d')!;
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(source, 0, 0, this.preview.width, this.preview.height);
    this.filtered = createCanvas(this.preview.width, this.preview.height);
    this.filtered.getContext('2d')!.drawImage(this.preview, 0, 0);
    this.bg = new FabricImage(this.filtered, { selectable: false, evented: false, objectCaching: false });
    this.canvas.backgroundImage = this.bg;

    this.initial = { width: source.width, height: source.height, G: [1, 0, 0, 1, 0, 0], brightness: 0, contrast: 0 };
    this.doc = { ...this.initial };
    this.history = new History<Snapshot>({ doc: this.doc, objects: [] }, LIMITS.historySteps);

    this.drawing = new DrawingController(this.canvas, {
      getStyle: hooks.getStyle,
      onCreated: (obj) => hooks.onCreated(obj),
      onTextClick: hooks.onTextClick,
      clamp: (p) => new Point(Math.min(this.doc.width, Math.max(0, p.x)), Math.min(this.doc.height, Math.max(0, p.y))),
    });
    this.canvas.on('object:modified', ({ target }) => {
      if (target && isCropUi(target)) {
        this.constrainCrop();
        return;
      }
      if (target) bakeTextScale(target);
      this.commit();
    });
    this.canvas.on('object:moving', ({ target }) => target && isCropUi(target) && this.constrainCrop());
    this.canvas.on('object:scaling', ({ target }) => target && isCropUi(target) && this.constrainCrop());
    this.canvas.on('selection:created', () => hooks.onSelection());
    this.canvas.on('selection:updated', () => hooks.onSelection());
    this.canvas.on('selection:cleared', () => hooks.onSelection());
    this.canvas.on('after:render', ({ ctx }) => this.drawCropShade(ctx as CanvasRenderingContext2D));
    this.applyDoc();
  }

  get sourceSize() {
    return { width: this.source.width, height: this.source.height };
  }

  annotations(): FabricObject[] {
    return this.canvas.getObjects().filter((o) => !isCropUi(o) && (o.selectable !== false || o.evented !== false));
  }

  // ---- view -------------------------------------------------------------

  setZoom(z: number): void {
    this.zoom = z;
    this.applyView();
  }

  private applyView(): void {
    const z = this.zoom;
    this.canvas.setDimensions({ width: Math.max(1, Math.round(this.doc.width * z)), height: Math.max(1, Math.round(this.doc.height * z)) });
    this.canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
    this.canvas.getObjects().forEach((o) => o.setCoords());
    this.canvas.requestRenderAll();
  }

  /** Positions the preview bitmap according to G and refreshes the filter. */
  private applyDoc(): void {
    const s = this.previewScale;
    const m = compose(this.doc.G, scaleM(1 / s), translate(this.preview.width / 2, this.preview.height / 2));
    util.applyTransformToObject(this.bg, m as unknown as TMat2D);
    this.refreshFilter();
    this.applyView();
  }

  private refreshFilter(): void {
    const ctx = this.filtered.getContext('2d')!;
    ctx.clearRect(0, 0, this.filtered.width, this.filtered.height);
    ctx.drawImage(this.preview, 0, 0);
    if (!isIdentity(this.doc.brightness, this.doc.contrast)) {
      const img = ctx.getImageData(0, 0, this.filtered.width, this.filtered.height);
      applyLut(img.data, buildLut(this.doc.brightness, this.doc.contrast));
      ctx.putImageData(img, 0, 0);
    }
    this.bg.dirty = true;
    this.canvas.requestRenderAll();
  }

  /** Shows the JPG background colour behind transparent areas, matching the export. */
  setPreviewBackground(color: string | null): void {
    this.canvas.backgroundColor = color ?? '';
    this.canvas.requestRenderAll();
  }

  // ---- history ----------------------------------------------------------

  private snapshot(): Snapshot {
    return { doc: { ...this.doc, G: [...this.doc.G] as Matrix }, objects: snapshotCanvas(this.canvas, (o) => !isCropUi(o)) };
  }

  commit(): void {
    if (this.history.push(this.snapshot())) {
      this.version++;
      this.hooks.onChange();
    }
  }

  private restore(s: Snapshot): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.cancelCrop();
      const objs = await enliven(s.objects);
      this.canvas.discardActiveObject();
      const old = this.canvas.getObjects().slice();
      if (old.length) this.canvas.remove(...old);
      this.doc = { ...s.doc, G: [...s.doc.G] as Matrix };
      if (objs.length) this.canvas.add(...objs);
      this.applyDoc();
      this.version++;
      this.hooks.onChange();
      this.hooks.onSelection();
    });
    return this.queue;
  }

  undo(): Promise<void> {
    const s = this.history.undo();
    return s ? this.restore(s) : Promise.resolve();
  }

  redo(): Promise<void> {
    const s = this.history.redo();
    return s ? this.restore(s) : Promise.resolve();
  }

  idle(): Promise<void> {
    return this.queue;
  }

  // ---- geometry operations ----------------------------------------------

  /** Applies a transform of the whole composition (picture + annotations). */
  private transformScene(T: Matrix, width: number, height: number): void {
    this.canvas.discardActiveObject();
    for (const o of this.annotations()) {
      const m = multiply(T, o.calcTransformMatrix() as unknown as Matrix);
      util.applyTransformToObject(o, m as unknown as TMat2D);
      o.setCoords();
    }
    this.doc = { ...this.doc, width, height, G: multiply(T, this.doc.G) };
    this.applyDoc();
    this.commit();
  }

  rotate(direction: 1 | -1): void {
    this.cancelCrop();
    const { width: W, height: H } = this.doc;
    const T: Matrix = direction === 1 ? [0, 1, -1, 0, H, 0] : [0, -1, 1, 0, 0, W];
    this.transformScene(T, H, W);
  }

  flip(axis: 'h' | 'v'): void {
    this.cancelCrop();
    const { width: W, height: H } = this.doc;
    this.transformScene(axis === 'h' ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, -1, 0, H], W, H);
  }

  resize(width: number, height: number): void {
    this.cancelCrop();
    const w = Math.round(width);
    const h = Math.round(height);
    if (!(w >= 1 && h >= 1)) throw new AppError('error.resizeInvalid');
    if (w * h > LIMITS.maxImagePixels) {
      throw new AppError('error.resizeTooLarge', { max: Math.round(LIMITS.maxImagePixels / PIXELS_PER_MEGAPIXEL) });
    }
    if (w === this.doc.width && h === this.doc.height) return;
    this.transformScene(scaleM(w / this.doc.width, h / this.doc.height), w, h);
  }

  setAdjust(brightness: number, contrast: number, commit: boolean): void {
    this.doc = { ...this.doc, brightness, contrast };
    if (!this.filterPending) {
      this.filterPending = true;
      requestAnimationFrame(() => {
        this.filterPending = false;
        this.refreshFilter();
      });
    }
    if (commit) this.commit();
  }

  reset(): void {
    this.cancelCrop();
    this.canvas.discardActiveObject();
    const objs = this.canvas.getObjects().slice();
    if (objs.length) this.canvas.remove(...objs);
    this.doc = { ...this.initial };
    this.applyDoc();
    this.commit();
  }

  // ---- crop ---------------------------------------------------------------

  get isCropping(): boolean {
    return this.crop !== null;
  }

  startCrop(ratio: number | null): void {
    this.cancelCrop();
    this.cropRatio = ratio;
    const { width: W, height: H } = this.doc;
    let w = W * 0.8;
    let h = H * 0.8;
    if (ratio) {
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
    }
    const rect = new Rect({
      width: w,
      height: h,
      fill: 'rgba(0,0,0,0)',
      stroke: '#ffffff',
      strokeWidth: 1.5,
      strokeUniform: true,
      strokeDashArray: [6, 4],
      lockRotation: true,
      objectCaching: false,
    });
    rect.set({ psKind: 'crop', excludeFromExport: true } as never);
    rect.setControlsVisibility({ mtr: false, ml: !ratio, mr: !ratio, mt: !ratio, mb: !ratio });
    rect.setPositionByOrigin(new Point(W / 2, H / 2), 'center', 'center');
    this.crop = rect;
    this.annotations().forEach((o) => o.set({ selectable: false, evented: false, psLocked: true } as never));
    this.canvas.add(rect);
    this.canvas.setActiveObject(rect);
    this.canvas.requestRenderAll();
    this.hooks.onCrop(this.cropRect());
  }

  setCropRatio(ratio: number | null): void {
    if (this.crop) this.startCrop(ratio);
  }

  cropRect(): CropRect | null {
    const r = this.crop;
    if (!r) return null;
    const tl = r.getPointByOrigin('left', 'top');
    return {
      x: Math.round(tl.x),
      y: Math.round(tl.y),
      width: Math.round(r.width * r.scaleX),
      height: Math.round(r.height * r.scaleY),
    };
  }

  setCropRect(c: CropRect): void {
    const r = this.crop;
    if (!r) return;
    const width = c.width;
    const height = this.cropRatio ? width / this.cropRatio : c.height;
    r.set({ width: Math.max(1, width), height: Math.max(1, height), scaleX: 1, scaleY: 1 });
    r.setPositionByOrigin(new Point(c.x, c.y), 'left', 'top');
    this.constrainCrop();
  }

  private constrainCrop(): void {
    const r = this.crop;
    if (!r) return;
    const { width: W, height: H } = this.doc;
    let w = r.width * r.scaleX;
    let h = r.height * r.scaleY;
    const k = Math.min(1, W / w, H / h);
    w *= k;
    h *= k;
    w = Math.max(1, w);
    h = Math.max(1, h);
    const c = r.getCenterPoint();
    const cx = Math.min(W - w / 2, Math.max(w / 2, c.x));
    const cy = Math.min(H - h / 2, Math.max(h / 2, c.y));
    r.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
    r.setPositionByOrigin(new Point(cx, cy), 'center', 'center');
    r.setCoords();
    this.canvas.requestRenderAll();
    this.hooks.onCrop(this.cropRect());
  }

  applyCrop(): void {
    const c = this.cropRect();
    if (!c) return;
    const x = Math.max(0, Math.min(this.doc.width - 1, c.x));
    const y = Math.max(0, Math.min(this.doc.height - 1, c.y));
    const w = Math.max(1, Math.min(this.doc.width - x, c.width));
    const h = Math.max(1, Math.min(this.doc.height - y, c.height));
    this.cancelCrop();
    this.transformScene(translate(-x, -y), w, h);
  }

  cancelCrop(): void {
    if (!this.crop) return;
    this.canvas.discardActiveObject();
    this.canvas.remove(this.crop);
    this.crop = null;
    this.canvas.getObjects().forEach((o) => {
      if ((o as FabricObject & { psLocked?: boolean }).psLocked) o.set({ selectable: true, evented: true, psLocked: false } as never);
    });
    this.canvas.requestRenderAll();
    this.hooks.onCrop(null);
  }

  private drawCropShade(ctx: CanvasRenderingContext2D): void {
    const r = this.crop;
    if (!r) return;
    const z = this.zoom;
    const tl = r.getPointByOrigin('left', 'top');
    const w = r.width * r.scaleX;
    const h = r.height * r.scaleY;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, this.doc.width * z, this.doc.height * z);
    ctx.rect(tl.x * z, tl.y * z, w * z, h * z);
    ctx.fill('evenodd');
    ctx.restore();
  }

  // ---- export -------------------------------------------------------------

  /**
   * Renders the final image at its real pixel size: the full-resolution source through G,
   * brightness/contrast on the picture layer only, then the annotations on top.
   */
  async export(format: 'png' | 'jpeg', quality: number, background: string): Promise<Blob> {
    await this.idle();
    this.cancelCrop();
    const { width: W, height: H, G } = this.doc;
    if (W * H > LIMITS.maxImagePixels) throw new AppError('error.resizeTooLarge', { max: Math.round(LIMITS.maxImagePixels / PIXELS_PER_MEGAPIXEL) });
    if (!canAllocateCanvas(W, H)) throw new AppError('error.canvasTooLarge', { page: 1, width: W, height: H });
    const base = createCanvas(W, H);
    const outEl = createCanvas(W, H);
    let out: StaticCanvas | null = null;
    try {
      const ctx = base.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(G[0], G[1], G[2], G[3], G[4], G[5]);
      ctx.drawImage(this.source, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!isIdentity(this.doc.brightness, this.doc.contrast)) {
        await nextFrame();
        const lut = buildLut(this.doc.brightness, this.doc.contrast);
        // Process in bands to keep memory spikes and main-thread pauses short.
        const band = Math.max(1, Math.floor(4_000_000 / W));
        for (let y = 0; y < H; y += band) {
          const h = Math.min(band, H - y);
          const img = ctx.getImageData(0, y, W, h);
          applyLut(img.data, lut);
          ctx.putImageData(img, 0, y);
        }
      }
      out = new StaticCanvas(outEl, {
        width: W,
        height: H,
        enableRetinaScaling: false,
        renderOnAddRemove: false,
        backgroundColor: format === 'jpeg' ? background : '',
      });
      const baseImg = new FabricImage(base, { objectCaching: false });
      util.applyTransformToObject(baseImg, translate(W / 2, H / 2) as unknown as TMat2D);
      out.backgroundImage = baseImg;
      for (const o of this.annotations()) {
        if (kindOf(o)) out.add(await o.clone());
      }
      out.renderAll();
      return await canvasToBlob(outEl, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? quality : undefined);
    } finally {
      void out?.dispose();
      releaseCanvas(base);
      releaseCanvas(outEl);
    }
  }

  dispose(): void {
    this.drawing.dispose();
    void this.canvas.dispose();
    releaseCanvas(this.preview);
    releaseCanvas(this.filtered);
    this.source.close();
  }
}
