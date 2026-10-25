import { describe, expect, it } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDict, PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { assemblePdfs, type AssembleSource } from '../../src/features/pdf-pages/assemble';
import { AppError } from '../../src/lib/errors';
import { inspectPdf } from '../../src/lib/pdf/pdfLibLoad';
import { fixture, openPdf, pageText } from '../helpers/pdf';

const A: AssembleSource = { id: 'A', bytes: fixture('docA.pdf') };
const B: AssembleSource = { id: 'B', bytes: fixture('docB.pdf') };

async function texts(bytes: Uint8Array): Promise<string[]> {
  const doc = await openPdf(bytes);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await pageText(doc, i)).trim());
  return out;
}

async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

/** Number of page dictionaries anywhere in the file, reachable or not. */
async function pageObjectCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Page')) n++;
  }
  return n;
}

describe('assemblePdfs', () => {
  it('merges two PDFs in order and keeps existing rotations', async () => {
    const [out] = await assemblePdfs(
      [A, B],
      [
        {
          name: 'merged.pdf',
          pages: [
            { sourceId: 'A', pageIndex: 0, rotation: 0 },
            { sourceId: 'A', pageIndex: 1, rotation: 0 },
            { sourceId: 'A', pageIndex: 2, rotation: 0 },
            { sourceId: 'B', pageIndex: 0, rotation: 0 },
            { sourceId: 'B', pageIndex: 1, rotation: 0 },
          ],
        },
      ],
    );
    expect(out.pageCount).toBe(5);
    const t = await texts(out.bytes);
    expect(t[0]).toContain('DOC A PAGE 1');
    expect(t[2]).toContain('DOC A PAGE 3');
    expect(t[3]).toContain('DOC B PAGE 1');
    expect(t[4]).toContain('DOC B PAGE 2');
    expect(await rotations(out.bytes)).toEqual([0, 0, 0, 0, 180]);
  });

  it('reorders, rotates and duplicates pages exactly as specified', async () => {
    const [out] = await assemblePdfs(
      [A, B],
      [
        {
          name: 'x.pdf',
          pages: [
            { sourceId: 'B', pageIndex: 1, rotation: 90 },
            { sourceId: 'A', pageIndex: 2, rotation: 0 },
            { sourceId: 'A', pageIndex: 0, rotation: 270 },
            { sourceId: 'A', pageIndex: 0, rotation: 0 },
          ],
        },
      ],
    );
    const t = await texts(out.bytes);
    expect(t.map((s) => s.slice(0, 12))).toEqual(['DOC B PAGE 2', 'DOC A PAGE 3', 'DOC A PAGE 1', 'DOC A PAGE 1']);
    // 180 (original) + 90 = 270; 0 + 270 = 270.
    expect(await rotations(out.bytes)).toEqual([270, 0, 270, 0]);
  });

  it('does not leak deleted pages through annotation references', async () => {
    // docA page 1 has a link to page 3, page 2 a sticky note with /P. Keep pages 1-2 only.
    const [out] = await assemblePdfs(
      [A],
      [
        {
          name: 'deleted.pdf',
          pages: [
            { sourceId: 'A', pageIndex: 0, rotation: 0 },
            { sourceId: 'A', pageIndex: 1, rotation: 0 },
          ],
        },
      ],
    );
    expect(out.pageCount).toBe(2);
    expect(await pageObjectCount(out.bytes)).toBe(2);
    const t = (await texts(out.bytes)).join(' ');
    expect(t).not.toContain('SECRETPAGEA3');
    // The link annotation itself is kept, only its destination to the removed page is cut.
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const link = annots.lookup(0, PDFDict);
    expect(link.get(PDFName.of('Subtype'))).toBe(PDFName.of('Link'));
    expect(link.get(PDFName.of('Dest'))).toBeUndefined();
  });

  it('copies page content as vectors and text (nothing is rasterised)', async () => {
    const [out] = await assemblePdfs([A], [{ name: 'a.pdf', pages: [{ sourceId: 'A', pageIndex: 2, rotation: 90 }] }]);
    const doc = await openPdf(out.bytes);
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    expect(ops.fnArray).toContain(OPS.showText);
    expect(ops.fnArray).not.toContain(OPS.paintImageXObject);
    expect(await pageText(doc, 1)).toContain('SECRETPAGEA3');
  });

  it('splits into several files', async () => {
    const outs = await assemblePdfs(
      [A],
      [0, 1, 2].map((i) => ({ name: `part-${i + 1}.pdf`, pages: [{ sourceId: 'A', pageIndex: i, rotation: 0 }] })),
    );
    expect(outs.map((o) => o.name)).toEqual(['part-1.pdf', 'part-2.pdf', 'part-3.pdf']);
    for (let i = 0; i < 3; i++) {
      expect((await texts(outs[i].bytes))[0]).toContain(`DOC A PAGE ${i + 1}`);
      expect(await pageObjectCount(outs[i].bytes)).toBe(1);
    }
  });

  it('rejects encrypted and damaged PDFs with a clear error instead of producing broken files', async () => {
    for (const [name, code] of [
      ['encrypted-password.pdf', 'error.pdfEncryptedEdit'],
      ['encrypted-owner-only.pdf', 'error.pdfEncryptedEdit'],
      ['corrupt.pdf', 'error.pdfParseEdit'],
    ] as const) {
      const err = await inspectPdf(fixture(name)).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(code);
      const err2 = await assemblePdfs([{ id: 'X', bytes: fixture(name) }], [{ name: 'x.pdf', pages: [{ sourceId: 'X', pageIndex: 0, rotation: 0 }] }]).catch((e) => e);
      expect((err2 as AppError).code).toBe(code);
    }
  });
});
