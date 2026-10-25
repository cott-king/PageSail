import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { imagesToPdf, type ImageToPdfItem } from '../../src/features/image-to-pdf/buildPdf';
import { PAGE_SIZES, layoutImagePage, mmToPt } from '../../src/features/image-to-pdf/layout';
import { readImageInfo } from '../../src/lib/images/header';
import { fixture, near, openPdf, renderPage } from '../helpers/pdf';

function item(name: string): ImageToPdfItem {
  const bytes = fixture(name);
  const info = readImageInfo(bytes);
  return { bytes, type: info.type, width: info.width, height: info.height, orientation: info.orientation };
}

describe('image → PDF layout', () => {
  it('keeps the aspect ratio for every fit mode and page size', () => {
    for (const pageSize of ['a4', 'letter', 'legal', 'a3', 'a5', 'fit'] as const) {
      for (const fit of ['contain', 'cover', 'actual'] as const) {
        for (const orientation of ['auto', 'portrait', 'landscape'] as const) {
          for (const [w, h] of [
            [4000, 3000],
            [800, 2400],
            [500, 500],
          ]) {
            const l = layoutImagePage(w, h, { pageSize, orientation, marginPt: mmToPt(10), fit });
            expect(l.image.width / l.image.height).toBeCloseTo(w / h, 6);
          }
        }
      }
    }
  });

  it('contain fits inside the margins and centres the image', () => {
    const m = mmToPt(10);
    const l = layoutImagePage(4000, 3000, { pageSize: 'a4', orientation: 'portrait', marginPt: m, fit: 'contain' });
    expect(l.pageWidth).toBeCloseTo(PAGE_SIZES.a4[0]);
    expect(l.image.x).toBeCloseTo(m);
    expect(l.image.width).toBeCloseTo(PAGE_SIZES.a4[0] - 2 * m);
    expect(l.image.y + l.image.height / 2).toBeCloseTo(l.pageHeight / 2);
    expect(l.clip).toBeUndefined();
  });

  it('auto orientation picks landscape for wide images', () => {
    const l = layoutImagePage(4000, 3000, { pageSize: 'a4', orientation: 'auto', marginPt: 0, fit: 'contain' });
    expect(l.pageWidth).toBeGreaterThan(l.pageHeight);
  });

  it('cover fills the box and clips instead of stretching', () => {
    const l = layoutImagePage(1000, 1000, { pageSize: 'a4', orientation: 'portrait', marginPt: 0, fit: 'cover' });
    expect(l.image.height).toBeCloseTo(PAGE_SIZES.a4[1]);
    expect(l.clip).toEqual({ x: 0, y: 0, width: PAGE_SIZES.a4[0], height: PAGE_SIZES.a4[1] });
  });

  it('"same as image" uses 96 DPI plus margins', () => {
    const l = layoutImagePage(960, 480, { pageSize: 'fit', orientation: 'auto', marginPt: 10, fit: 'contain' });
    expect(l.pageWidth).toBeCloseTo(720 + 20);
    expect(l.pageHeight).toBeCloseTo(360 + 20);
  });

  it('rejects margins that leave no room', () => {
    expect(() => layoutImagePage(100, 100, { pageSize: 'a5', orientation: 'portrait', marginPt: 300, fit: 'contain' })).toThrow();
  });
});

describe('imagesToPdf (real pdf-lib output)', () => {
  it('creates one page per image, in order, with correct content and orientation', async () => {
    const items = [item('red-wide.png'), item('exif-rotate6.jpg'), item('transparent.png'), item('green-tall.jpg')];
    const progress: number[] = [];
    const bytes = await imagesToPdf(items, { pageSize: 'fit', orientation: 'auto', marginPt: 0, fit: 'contain' }, (d) => progress.push(d));
    expect(progress).toEqual([1, 2, 3, 4]);

    // Structure check with pdf-lib, rendering check with pdf.js.
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(4);
    const sizes = reloaded.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    // 96 DPI: px × 0.75 = pt. The EXIF-rotated JPEG (stored 160x80) becomes an 80x160 px page.
    expect(sizes).toEqual([
      [180, 90],
      [60, 120],
      [150, 150],
      [90, 180],
    ]);

    const doc = await openPdf(bytes);
    // Page 1: red with a black marker top-left.
    let r = await renderPage(doc, 1, 4 / 3); // 1 px per image pixel
    expect(r.width).toBe(240);
    expect(near(r.avg(10, 10), [0, 0, 0])).toBe(true);
    expect(near(r.avg(200, 80), [255, 0, 0])).toBe(true);
    // Page 2: EXIF orientation 6 → upright 80x160, marker (stored top-left) now at top-right.
    r = await renderPage(doc, 2, 4 / 3);
    expect([r.width, r.height]).toEqual([80, 160]);
    expect(near(r.avg(70, 10), [0, 0, 0])).toBe(true);
    expect(near(r.avg(10, 10), [255, 136, 0])).toBe(true);
    // Page 3: transparent left half shows the white page; right half blue, bottom-right yellow.
    r = await renderPage(doc, 3, 4 / 3);
    expect(near(r.avg(50, 100), [255, 255, 255])).toBe(true);
    expect(near(r.avg(125, 50), [0, 0, 255])).toBe(true);
    expect(near(r.avg(185, 185), [255, 255, 0])).toBe(true);
    // Page 4: green JPEG with black marker top-left.
    r = await renderPage(doc, 4, 4 / 3);
    expect(near(r.avg(10, 10), [0, 0, 0])).toBe(true);
    expect(near(r.avg(60, 200), [0, 192, 0])).toBe(true);
  });

  it('embeds JPEG data without re-encoding', async () => {
    const jpg = fixture('green-tall.jpg');
    const bytes = await imagesToPdf([item('green-tall.jpg')], { pageSize: 'a4', orientation: 'auto', marginPt: 0, fit: 'contain' });
    // The original JPEG byte sequence (after the SOI marker) is present verbatim in the PDF.
    const needle = Buffer.from(jpg.slice(0, 64));
    expect(Buffer.from(bytes).includes(needle)).toBe(true);
  });

  it('places images inside A4 margins without distortion', async () => {
    const bytes = await imagesToPdf([item('red-wide.png')], { pageSize: 'a4', orientation: 'portrait', marginPt: mmToPt(20), fit: 'contain' });
    const doc = await openPdf(bytes);
    const r = await renderPage(doc, 1, 1);
    expect([r.width, r.height]).toEqual([595, 842]);
    const m = mmToPt(20);
    const imgW = 595.28 - 2 * m;
    const imgH = imgW / 2;
    const top = (841.89 - imgH) / 2;
    expect(near(r.avg(m + 3, top + 3, 1), [0, 0, 0])).toBe(true); // marker corner
    expect(near(r.avg(m + imgW - 5, top + imgH - 5, 1), [255, 0, 0])).toBe(true);
    expect(near(r.avg(m / 2, 421), [255, 255, 255])).toBe(true); // margin stays white
  });
});
