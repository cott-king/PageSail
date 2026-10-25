import { CancelledError } from '../errors';
import { canvasToBlob, createCanvas, releaseCanvas } from '../canvas';
import { normalizeRotation } from './coords';
import type { PDFDocumentProxy } from './pdfjs';

interface QueueItem {
  key: string;
  pageIndex: number;
  rotationDelta: number;
  longSide: number;
  signal?: AbortSignal;
  resolve: (url: string) => void;
  reject: (e: unknown) => void;
}

/**
 * Lazily renders small page previews with bounded concurrency and an LRU cache of
 * compressed JPEG object URLs (much lighter than keeping canvases alive).
 */
export class ThumbnailCache {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly queue: QueueItem[] = [];
  private active = 0;
  private disposed = false;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly maxEntries = 300,
    private readonly concurrency = 2,
  ) {}

  static key(pageIndex: number, rotationDelta: number, longSide: number): string {
    return `${pageIndex}:${normalizeRotation(rotationDelta)}:${longSide}`;
  }

  peek(pageIndex: number, rotationDelta: number, longSide: number): string | undefined {
    const key = ThumbnailCache.key(pageIndex, rotationDelta, longSide);
    const url = this.cache.get(key);
    if (url) {
      this.cache.delete(key);
      this.cache.set(key, url);
    }
    return url;
  }

  get(pageIndex: number, rotationDelta: number, longSide: number, signal?: AbortSignal): Promise<string> {
    const key = ThumbnailCache.key(pageIndex, rotationDelta, longSide);
    const cached = this.peek(pageIndex, rotationDelta, longSide);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = new Promise<string>((resolve, reject) => {
      this.queue.push({ key, pageIndex, rotationDelta, longSide, signal, resolve, reject });
    });
    this.inflight.set(key, p);
    p.catch(() => undefined).finally(() => this.inflight.delete(key));
    this.pump();
    return p;
  }

  private pump(): void {
    while (!this.disposed && this.active < this.concurrency && this.queue.length > 0) {
      // Most recently requested first: it is most likely what is on screen now.
      const item = this.queue.pop()!;
      if (item.signal?.aborted) {
        item.reject(new CancelledError());
        continue;
      }
      this.active++;
      this.render(item)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async render(item: QueueItem): Promise<string> {
    const page = await this.doc.getPage(item.pageIndex + 1);
    const rotation = normalizeRotation(page.rotate + item.rotationDelta);
    const base = page.getViewport({ scale: 1, rotation });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = (item.longSide * dpr) / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale: s, rotation });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas, viewport }).promise;
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
      if (this.disposed) throw new CancelledError();
      const url = URL.createObjectURL(blob);
      this.cache.set(item.key, url);
      this.evict();
      return url;
    } finally {
      releaseCanvas(canvas);
      page.cleanup();
    }
  }

  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      const [oldestKey, url] = this.cache.entries().next().value as [string, string];
      this.cache.delete(oldestKey);
      URL.revokeObjectURL(url);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const item of this.queue) item.reject(new CancelledError());
    this.queue.length = 0;
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
  }
}
