import { Canvas, Point, type FabricObject } from 'fabric';
import { LIMITS } from '../../config';
import { History } from '../../editor/history';
import { DrawingController, bakeTextScale, enliven, snapshotCanvas, type DrawStyle } from '../../editor/fabricKit';

interface PageState {
  /** Objects of pages that are not on screen (detached from the canvas). */
  objects: FabricObject[];
  history: History<object[]>;
}

interface Hooks {
  getStyle(): DrawStyle;
  onChange(): void;
  onSelection(): void;
  onTextClick(p: Point): void;
  onCreated(obj: FabricObject): void;
}

/**
 * One Fabric canvas reused for every page. Switching pages stashes the live objects of
 * the current page and restores those of the next one, so each page keeps its own
 * objects and its own undo history. Objects live in page display space (PDF points,
 * top-left origin); zoom is only a view transform, devicePixelRatio is handled by Fabric.
 */
export class AnnotatorEngine {
  readonly canvas: Canvas;
  readonly drawing: DrawingController;
  private readonly pages = new Map<number, PageState>();
  private size = { width: 1, height: 1 };
  private queue: Promise<void> = Promise.resolve();
  current = -1;
  zoom = 1;
  /** Increments on every recorded edit; compared with the exported version for "unsaved changes". */
  version = 0;

  constructor(
    host: HTMLElement,
    private readonly hooks: Hooks,
  ) {
    const el = document.createElement('canvas');
    host.appendChild(el);
    this.canvas = new Canvas(el, {
      preserveObjectStacking: true,
      enableRetinaScaling: true,
      uniformScaling: true,
      targetFindTolerance: 6,
      width: 1,
      height: 1,
    });
    this.canvas.upperCanvasEl.setAttribute('aria-hidden', 'true');
    this.drawing = new DrawingController(this.canvas, {
      getStyle: hooks.getStyle,
      onCreated: (obj) => hooks.onCreated(obj),
      onTextClick: hooks.onTextClick,
      clamp: (p) => new Point(Math.min(this.size.width, Math.max(0, p.x)), Math.min(this.size.height, Math.max(0, p.y))),
    });
    this.canvas.on('object:modified', ({ target }) => {
      if (target) bakeTextScale(target);
      this.commit();
    });
    this.canvas.on('selection:created', () => hooks.onSelection());
    this.canvas.on('selection:updated', () => hooks.onSelection());
    this.canvas.on('selection:cleared', () => hooks.onSelection());
  }

  private state(index: number): PageState {
    let s = this.pages.get(index);
    if (!s) {
      s = { objects: [], history: new History<object[]>([], LIMITS.historySteps) };
      this.pages.set(index, s);
    }
    return s;
  }

  showPage(index: number, size: { width: number; height: number }): void {
    this.canvas.discardActiveObject();
    if (this.current >= 0 && this.current !== index) {
      const objs = this.canvas.getObjects().slice();
      this.state(this.current).objects = objs;
      if (objs.length) this.canvas.remove(...objs);
    }
    const switching = this.current !== index;
    this.current = index;
    this.size = size;
    this.applyZoom();
    if (switching) {
      const st = this.state(index);
      if (st.objects.length) this.canvas.add(...st.objects);
      st.objects = [];
    }
    this.canvas.requestRenderAll();
    this.hooks.onSelection();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.applyZoom();
  }

  private applyZoom(): void {
    const z = this.zoom;
    this.canvas.setDimensions({ width: Math.round(this.size.width * z), height: Math.round(this.size.height * z) });
    this.canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
    this.canvas.getObjects().forEach((o) => o.setCoords());
    this.canvas.requestRenderAll();
  }

  get pageSize() {
    return this.size;
  }

  /** Records an undo step for the current page if anything changed. */
  commit(): void {
    if (this.current < 0) return;
    if (this.state(this.current).history.push(snapshotCanvas(this.canvas))) {
      this.version++;
      this.hooks.onChange();
    }
  }

  private restore(snapshot: object[]): Promise<void> {
    this.queue = this.queue.then(async () => {
      const objs = await enliven(snapshot);
      this.canvas.discardActiveObject();
      const old = this.canvas.getObjects().slice();
      if (old.length) this.canvas.remove(...old);
      if (objs.length) this.canvas.add(...objs);
      this.canvas.requestRenderAll();
      this.version++;
      this.hooks.onChange();
      this.hooks.onSelection();
    });
    return this.queue;
  }

  undo(): Promise<void> {
    const snap = this.current >= 0 ? this.state(this.current).history.undo() : null;
    return snap ? this.restore(snap) : Promise.resolve();
  }

  redo(): Promise<void> {
    const snap = this.current >= 0 ? this.state(this.current).history.redo() : null;
    return snap ? this.restore(snap) : Promise.resolve();
  }

  get canUndo(): boolean {
    return this.current >= 0 && this.state(this.current).history.canUndo;
  }

  get canRedo(): boolean {
    return this.current >= 0 && this.state(this.current).history.canRedo;
  }

  objectsFor(index: number): FabricObject[] {
    if (index === this.current) return this.canvas.getObjects().filter((o) => o.selectable !== false || o.evented !== false);
    return this.pages.get(index)?.objects ?? [];
  }

  /** Pages that currently contain added objects, ascending. */
  editedPages(): number[] {
    const out = new Set<number>();
    for (const [i, s] of this.pages) if (s.objects.length) out.add(i);
    if (this.current >= 0 && this.canvas.getObjects().length) out.add(this.current);
    return [...out].sort((a, b) => a - b);
  }

  /** Waits for pending undo/redo restores. */
  idle(): Promise<void> {
    return this.queue;
  }

  dispose(): void {
    this.drawing.dispose();
    void this.canvas.dispose();
  }
}
