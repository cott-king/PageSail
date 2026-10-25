import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { apply, compose, invert, type Matrix } from '../../src/lib/affine';
import { displaySize, displayToPdfMatrix, normalizeRotation, pdfToDisplayMatrix, type PageGeometry } from '../../src/lib/pdf/coords';
import { fixture, openPdf } from '../helpers/pdf';

function close(a: number[], b: number[], eps = 1e-6) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));
}

async function geometryFromPdfjs(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const out: { g: PageGeometry; transform: number[]; width: number; height: number; vp: { convertToPdfPoint(x: number, y: number): number[] } }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push({
      g: { view: page.view as PageGeometry['view'], rotate: page.rotate, userUnit: page.userUnit },
      transform: vp.transform,
      width: vp.width,
      height: vp.height,
      vp,
    });
  }
  return out;
}

describe('page coordinate transforms', () => {
  it('normalises rotations', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
  });

  it('matches the pdf.js viewport for rotated and cropped fixture pages', async () => {
    for (const name of ['multipage.pdf', 'annotate-targets.pdf']) {
      for (const p of await geometryFromPdfjs(fixture(name))) {
        close(pdfToDisplayMatrix(p.g), p.transform);
        const size = displaySize(p.g);
        close([size.width, size.height], [p.width, p.height]);
        // Display → PDF agrees with pdf.js' own inverse at several points.
        const m = displayToPdfMatrix(p.g);
        for (const [x, y] of [
          [0, 0],
          [size.width, 0],
          [size.width / 3, size.height / 2],
          [size.width, size.height],
        ]) {
          close(apply(m, x, y), p.vp.convertToPdfPoint(x, y), 1e-6);
        }
      }
    }
  });

  it('handles every rotation with an offset CropBox and a UserUnit', async () => {
    for (const rot of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([700, 900]);
      page.setCropBox(120, 80, 300, 500);
      page.setRotation(degrees(rot));
      page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
      const [p] = await geometryFromPdfjs(await doc.save());
      close(pdfToDisplayMatrix(p.g), p.transform);
      const s = displaySize(p.g);
      close([s.width, s.height], [p.width, p.height]);
    }
  });

  it('maps the displayed top-left corner to the visible box corner for each rotation', () => {
    const view: PageGeometry['view'] = [100, 150, 500, 650];
    const tl = (rotate: number) => apply(displayToPdfMatrix({ view, rotate, userUnit: 1 }), 0, 0);
    expect(tl(0)).toEqual([100, 650]); // top-left of the box
    expect(tl(90)).toEqual([100, 150]); // rotated CW: bottom-left becomes top-left
    expect(tl(180)).toEqual([500, 150]);
    expect(tl(270)).toEqual([500, 650]);
  });

  it('is independent of zoom: display units are always PDF units × UserUnit', () => {
    const g: PageGeometry = { view: [0, 0, 595, 842], rotate: 90, userUnit: 1 };
    const zoom: Matrix = [2.5, 0, 0, 2.5, 0, 0];
    // screen = zoom · display; going back through the inverse zoom gives the same PDF point.
    const screen = apply(zoom, 100, 40);
    const back = apply(compose(displayToPdfMatrix(g), invert(zoom)), screen[0], screen[1]);
    close(back, apply(displayToPdfMatrix(g), 100, 40));
  });
});
