import { AppError } from './errors';

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/** Frees the backing store immediately instead of waiting for garbage collection. */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export function canvasToBlob(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new AppError('error.canvasExport'));
      },
      type,
      quality,
    );
  });
}

const probeCache = new Map<string, boolean>();

/**
 * Browsers silently produce blank canvases above their size limits (e.g. ~16.7 MP on
 * iOS Safari). Probe by drawing into the far corner and reading it back.
 */
export function canAllocateCanvas(width: number, height: number): boolean {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < 1 || h < 1) return false;
  const key = `${w}x${h}`;
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;
  let ok = false;
  const c = document.createElement('canvas');
  try {
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = 'rgb(255, 0, 0)';
      ctx.fillRect(w - 1, h - 1, 1, 1);
      const px = ctx.getImageData(w - 1, h - 1, 1, 1).data;
      ok = px[0] === 255 && px[3] === 255;
    }
  } catch {
    ok = false;
  } finally {
    releaseCanvas(c);
  }
  probeCache.set(key, ok);
  return ok;
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
