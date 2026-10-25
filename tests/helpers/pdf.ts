import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Independent verification helpers: exported files are re-opened with pdf.js (legacy
 * Node build) and rendered with @napi-rs/canvas, i.e. not through the app's own code.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const FIXTURES = path.join(ROOT, 'tests/fixtures');
const PDFJS_DIR = path.join(ROOT, 'node_modules/pdfjs-dist/');

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return (await pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${PDFJS_DIR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIR}standard_fonts/`,
    wasmUrl: `${PDFJS_DIR}wasm/`,
    verbosity: 0,
  }).promise) as unknown as PDFDocumentProxy;
}

export interface RenderedPage {
  width: number;
  height: number;
  /** RGBA at integer pixel (x, y). */
  pixel(x: number, y: number): [number, number, number, number];
  /** Average colour of a square region centred at (x, y). */
  avg(x: number, y: number, r?: number): [number, number, number, number];
}

export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, scale = 1): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const w = Math.round(viewport.width);
  const h = Math.round(viewport.height);
  const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory;
  const { canvas, context } = factory.create(w, h);
  await page.render({ canvas: canvas as HTMLCanvasElement, viewport }).promise;
  const data = context.getImageData(0, 0, w, h).data;
  const pixel = (x: number, y: number): [number, number, number, number] => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    const i = (yi * w + xi) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const avg = (x: number, y: number, r = 2): [number, number, number, number] => {
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const p = pixel(x + dx, y + dy);
        for (let k = 0; k < 4; k++) acc[k] += p[k];
        n++;
      }
    }
    return acc.map((v) => Math.round(v / n)) as [number, number, number, number];
  };
  return { width: w, height: h, pixel, avg };
}

export async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const tc = await (await doc.getPage(pageNumber)).getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

export async function textItems(doc: PDFDocumentProxy, pageNumber: number): Promise<{ str: string; transform: number[] }[]> {
  const tc = await (await doc.getPage(pageNumber)).getTextContent();
  return tc.items.filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i).map((i) => ({ str: i.str, transform: i.transform }));
}

/** Approximate colour equality. */
export function near(actual: number[], expected: number[], tol = 40): boolean {
  return expected.every((v, i) => Math.abs(actual[i] - v) <= tol);
}

export function decodeImage(bytes: Uint8Array): Promise<{ width: number; height: number; pixel(x: number, y: number): [number, number, number, number] }> {
  return import('@napi-rs/canvas').then(async ({ loadImage, createCanvas }) => {
    const img = await loadImage(Buffer.from(bytes));
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    return {
      width: img.width,
      height: img.height,
      pixel: (x: number, y: number) => {
        const i = (Math.round(y) * img.width + Math.round(x)) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]] as [number, number, number, number];
      },
    };
  });
}
