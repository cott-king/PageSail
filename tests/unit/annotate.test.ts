import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { apply, translate, compose, rotate, type Matrix } from '../../src/lib/affine';
import { displayToPdfMatrix, pdfToDisplayMatrix, type PageGeometry } from '../../src/lib/pdf/coords';
import { exportAnnotatedPdf } from '../../src/features/pdf-annotate/exportPdf';
import type { Annotation, AnnotatedPage, RGBA } from '../../src/features/pdf-annotate/model';
import { readImageInfo } from '../../src/lib/images/header';
import { ROOT, fixture, near, openPdf, pageText, renderPage, textItems } from '../helpers/pdf';

const fontBytes = (file: string) => new Uint8Array(readFileSync(path.join(ROOT, 'public/fonts', file)));
const FONTS = { 'noto-sans-sc': fontBytes('NotoSansSC-Regular.ttf'), 'noto-sans-jp': fontBytes('NotoSansJP-Regular.ttf'), 'noto-sans': fontBytes('NotoSans-Regular.ttf') };

const RED: RGBA = { r: 1, g: 0, b: 0, a: 1 };
const BLUE: RGBA = { r: 0, g: 0, b: 1, a: 1 };

const stroke = { stroke: null, strokeWidth: 0, dash: null, lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 4 };

/** A filled rectangle whose top-left corner is at display (x, y). */
function rect(x: number, y: number, w: number, h: number, fill: RGBA, opacity = 1): Annotation {
  return { kind: 'rect', matrix: translate(x + w / 2, y + h / 2), width: w, height: h, fill, opacity, ...stroke };
}

async function geometries(bytes: Uint8Array): Promise<PageGeometry[]> {
  const doc = await openPdf(bytes);
  const out: PageGeometry[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    out.push({ view: p.view as PageGeometry['view'], rotate: p.rotate, userUnit: p.userUnit });
  }
  return out;
}

describe('exportAnnotatedPdf — positions on normal, rotated and cropped pages', () => {
  it('draws shapes exactly where they were placed in display space', async () => {
    const src = fixture('annotate-targets.pdf');
    const geos = await geometries(src);
    const pages: AnnotatedPage[] = geos.map((g, i) => ({
      pageIndex: i,
      displayToPdf: displayToPdfMatrix(g),
      annotations: [rect(100, 120, 80, 40, RED), rect(30, 300, 20, 20, BLUE, 0.5)],
    }));
    const out = await exportAnnotatedPdf({ pdf: src, pages, fonts: {}, images: {} });
    const doc = await openPdf(out);
    for (let i = 1; i <= geos.length; i++) {
      const r = await renderPage(doc, i, 1);
      // Inside the red rectangle, near each corner.
      for (const [x, y] of [
        [103, 123],
        [177, 123],
        [103, 157],
        [177, 157],
        [140, 140],
      ]) {
        expect(near(r.avg(x, y, 1), [255, 0, 0]), `page ${i} inside (${x},${y}) = ${r.avg(x, y, 1)}`).toBe(true);
      }
      // Just outside each edge stays white.
      for (const [x, y] of [
        [95, 140],
        [186, 140],
        [140, 114],
        [140, 166],
      ]) {
        expect(near(r.avg(x, y, 1), [255, 255, 255]), `page ${i} outside (${x},${y}) = ${r.avg(x, y, 1)}`).toBe(true);
      }
      // 50% blue over white.
      expect(near(r.avg(40, 310, 2), [128, 128, 255], 30), `page ${i} translucent = ${r.avg(40, 310, 2)}`).toBe(true);
    }
  });

  it('writes CJK and Latin text as real, extractable PDF text at the right place', async () => {
    const src = fixture('annotate-targets.pdf');
    const geos = await geometries(src);
    const sample = 'Hello 你好世界 こんにちは';
    const pages: AnnotatedPage[] = geos.map((g, i) => ({
      pageIndex: i,
      displayToPdf: displayToPdfMatrix(g),
      annotations: [
        {
          kind: 'text',
          matrix: translate(200, 300),
          fontId: 'noto-sans-sc',
          fontSize: 20,
          color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          opacity: 1,
          lines: [
            { text: sample, x: -100, y: 0 },
            { text: 'Second line 第二行', x: -100, y: 24 },
          ],
        },
      ],
    }));
    const out = await exportAnnotatedPdf({ pdf: src, pages, fonts: FONTS, images: {} });
    const doc = await openPdf(out);
    for (let i = 1; i <= geos.length; i++) {
      const text = await pageText(doc, i);
      expect(text).toContain(sample);
      expect(text).toContain('Second line 第二行');
      expect(text).toMatch(/Original text/); // the page's own text is still text
      const item = (await textItems(doc, i)).find((t) => t.str === sample)!;
      // Baseline origin, mapped back to display space, is where the editor put it.
      const toDisplay = pdfToDisplayMatrix(geos[i - 1]);
      const [x, y] = apply(toDisplay, item.transform[4], item.transform[5]);
      expect(x).toBeCloseTo(100, 3);
      expect(y).toBeCloseTo(300, 3);
      // Text runs left-to-right and upright on screen, whatever /Rotate is.
      const dir = [toDisplay[0] * item.transform[0] + toDisplay[2] * item.transform[1], toDisplay[1] * item.transform[0] + toDisplay[3] * item.transform[1]];
      expect(dir[0]).toBeCloseTo(20, 3);
      expect(dir[1]).toBeCloseTo(0, 3);
    }
  });

  it('honours object rotation and scaling from the editor matrix', async () => {
    const src = fixture('annotate-targets.pdf');
    const [g] = await geometries(src);
    // A 100x20 bar rotated 90° around its centre at (300, 400) becomes a 20x100 vertical bar.
    const m: Matrix = compose(translate(300, 400), rotate(90), [1.5, 0, 0, 1, 0, 0]);
    const out = await exportAnnotatedPdf({
      pdf: src,
      pages: [{ pageIndex: 1, displayToPdf: displayToPdfMatrix((await geometries(src))[1]), annotations: [{ kind: 'rect', matrix: m, width: 100, height: 20, fill: RED, opacity: 1, ...stroke }] }],
      fonts: {},
      images: {},
    });
    void g;
    const r = await renderPage(await openPdf(out), 2, 1);
    expect(near(r.avg(300, 330, 1), [255, 0, 0])).toBe(true); // 75 px above centre (scaled 1.5)
    expect(near(r.avg(300, 470, 1), [255, 0, 0])).toBe(true);
    expect(near(r.avg(300, 320, 1), [255, 255, 255])).toBe(true);
    expect(near(r.avg(315, 400, 1), [255, 255, 255])).toBe(true);
  });

  it('embeds only a subset of the font and keeps original page content untouched', async () => {
    const src = fixture('annotate-targets.pdf');
    const geos = await geometries(src);
    const out = await exportAnnotatedPdf({
      pdf: src,
      pages: [
        {
          pageIndex: 0,
          displayToPdf: displayToPdfMatrix(geos[0]),
          annotations: [{ kind: 'text', matrix: translate(100, 100), fontId: 'noto-sans-sc', fontSize: 12, color: RED, opacity: 1, lines: [{ text: '中文テスト', x: 0, y: 0 }] }],
        },
      ],
      fonts: FONTS,
      images: {},
    });
    // The full Noto Sans SC is 10.6 MB; the subset must be tiny.
    expect(out.length).toBeLessThan(200_000);
    const reloaded = await PDFDocument.load(out);
    const descriptors = [...reloaded.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'));
    const noto = descriptors.find((d) => /NotoSansSC/.test(String(d.get(PDFName.of('FontName')))));
    expect(noto).toBeDefined();
    expect(String(noto!.get(PDFName.of('FontName')))).toMatch(/^\/[A-Z]{6}\+NotoSansSC-Regular$/);
    expect(noto!.get(PDFName.of('FontFile2'))).toBeInstanceOf(PDFRef);
    const fontFile = reloaded.context.lookup(noto!.get(PDFName.of('FontFile2')) as PDFRef) as PDFRawStream;
    expect(fontFile.contents.length).toBeLessThan(100_000);

    // Original page content is still vector/text; no image was introduced.
    const doc = await openPdf(out);
    const ops = await (await doc.getPage(1)).getOperatorList();
    expect(ops.fnArray).not.toContain(OPS.paintImageXObject);
    expect(await pageText(doc, 1)).toContain('Original text rotate 0');
    // Pages without additions are byte-for-byte the same content.
    expect(await pageText(doc, 2)).toContain('Original text rotate 90');
  });

  it('places images upright honouring EXIF orientation', async () => {
    const src = fixture('annotate-targets.pdf');
    const geos = await geometries(src);
    const jpg = fixture('exif-rotate6.jpg');
    const info = readImageInfo(jpg);
    // Displayed 80x160; place at 2x scale with its top-left at (100, 100) on the 270°-rotated page.
    const out = await exportAnnotatedPdf({
      pdf: src,
      pages: [
        {
          pageIndex: 3,
          displayToPdf: displayToPdfMatrix(geos[3]),
          annotations: [{ kind: 'image', imageId: 'img', width: 80, height: 160, opacity: 1, matrix: compose(translate(180, 260), [2, 0, 0, 2, 0, 0]) }],
        },
      ],
      fonts: {},
      images: { img: { bytes: jpg, type: 'jpeg', width: info.width, height: info.height, orientation: info.orientation } },
    });
    const r = await renderPage(await openPdf(out), 4, 1);
    expect(near(r.avg(250, 115, 3), [0, 0, 0])).toBe(true); // marker at displayed top-right
    expect(near(r.avg(115, 115, 3), [255, 136, 0])).toBe(true);
    expect(near(r.avg(180, 400, 3), [255, 136, 0])).toBe(true);
    expect(near(r.avg(180, 430, 3), [255, 255, 255])).toBe(true); // below the image
  });

  it('draws freehand paths (quadratic curves) and dashed strokes', async () => {
    const src = fixture('annotate-targets.pdf');
    const geos = await geometries(src);
    const out = await exportAnnotatedPdf({
      pdf: src,
      pages: [
        {
          pageIndex: 0,
          displayToPdf: displayToPdfMatrix(geos[0]),
          annotations: [
            {
              kind: 'path',
              matrix: translate(300, 500),
              commands: [
                ['M', -100, 0],
                ['Q', 0, -100, 100, 0],
              ],
              fill: null,
              stroke: BLUE,
              strokeWidth: 6,
              dash: null,
              lineCap: 'round',
              lineJoin: 'round',
              miterLimit: 4,
              opacity: 1,
            },
          ],
        },
      ],
      fonts: {},
      images: {},
    });
    const r = await renderPage(await openPdf(out), 1, 1);
    // Quadratic from (-100,0) via (0,-100) to (100,0): its apex is at y = -50.
    expect(near(r.avg(300, 450, 1), [0, 0, 255], 60)).toBe(true);
    expect(near(r.avg(300, 470, 1), [255, 255, 255])).toBe(true);
    expect(near(r.avg(200, 500, 1), [0, 0, 255], 60)).toBe(true);
  });
});
