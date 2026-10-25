import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Download, type Page, type Request } from '@playwright/test';
import { FIXTURES } from '../helpers/pdf';

export function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

export async function downloadBytes(download: Download): Promise<Uint8Array> {
  const p = await download.path();
  if (!p) throw new Error('Download failed');
  return new Uint8Array(readFileSync(p));
}

export interface NetworkLog {
  requests: Request[];
  /** Asserts nothing but same-origin GET/HEAD requests were made, without file names in URLs. */
  assertPrivate(fileNames: string[]): void;
}

/**
 * Records every request the page makes. Used to verify that processing a file never
 * sends the file (or its name) anywhere: only static GETs to our own origin are allowed.
 */
export function recordNetwork(page: Page, baseURL: string): NetworkLog {
  const requests: Request[] = [];
  const cspViolations: string[] = [];
  page.on('request', (r) => requests.push(r));
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (load|execute|connect|create)/i.test(m.text())) cspViolations.push(m.text());
  });
  const origin = new URL(baseURL).origin;
  return {
    requests,
    assertPrivate(fileNames: string[]) {
      expect(cspViolations, 'Content-Security-Policy violations').toEqual([]);
      for (const r of requests) {
        const url = r.url();
        if (url.startsWith('blob:') || url.startsWith('data:')) continue;
        expect(new URL(url).origin, `unexpected third-party request ${url}`).toBe(origin);
        expect(['GET', 'HEAD'], `non-GET request ${r.method()} ${url}`).toContain(r.method());
        expect(r.postData(), `request body sent to ${url}`).toBeNull();
        for (const name of fileNames) {
          const stem = name.replace(/\.[^.]+$/, '');
          expect(decodeURIComponent(url).includes(stem), `file name ${name} leaked in ${url}`).toBe(false);
        }
      }
    },
  };
}

/** Converts a point in page display space (PDF points / image pixels) to page coordinates on screen. */
export async function stagePoint(page: Page, displayWidth: number, x: number, y: number): Promise<{ x: number; y: number }> {
  const stage = page.getByTestId('stage');
  await expect(stage).toHaveAttribute('data-display-width', String(displayWidth));
  // Bring the point into view: scroll the editor's own scroll area, then the window.
  await stage.evaluate(
    (node, { dw, px, py }) => {
      const el = node as HTMLElement;
      const sc = el.closest('.editor-stage-scroll') as HTMLElement | null;
      const z = el.getBoundingClientRect().width / dw;
      if (sc) {
        sc.scrollTop = Math.max(0, el.offsetTop + py * z - sc.clientHeight / 2);
        sc.scrollLeft = Math.max(0, el.offsetLeft + px * z - sc.clientWidth / 2);
        const r = sc.getBoundingClientRect();
        window.scrollBy(0, r.top - 70);
      }
    },
    { dw: displayWidth, px: x, py: y },
  );
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage not visible');
  const z = box.width / displayWidth;
  return { x: box.x + x * z, y: box.y + y * z };
}

/** Drags with the mouse between two display-space points on the editor stage. */
export async function dragOnStage(page: Page, displayWidth: number, from: [number, number], to: [number, number]): Promise<void> {
  // Scroll to the middle of the drag once, then compute both screen points.
  await stagePoint(page, displayWidth, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  const box = (await page.getByTestId('stage').boundingBox())!;
  const z = box.width / displayWidth;
  const a = { x: box.x + from[0] * z, y: box.y + from[1] * z };
  const b = { x: box.x + to[0] * z, y: box.y + to[1] * z };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}
