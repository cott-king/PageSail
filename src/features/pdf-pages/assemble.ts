import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFPageLeaf, PDFRef, PDFStream, degrees, type PDFObject, type PDFPage } from 'pdf-lib';
import { AppError } from '../../lib/errors';
import { loadForEditing } from '../../lib/pdf/pdfLibLoad';
import { normalizeRotation } from '../../lib/pdf/coords';

export interface AssembleSource {
  id: string;
  bytes: Uint8Array;
}

export interface AssemblePage {
  sourceId: string;
  /** 0-based page index in the source document. */
  pageIndex: number;
  /** Extra clockwise rotation applied on top of the page's own /Rotate. */
  rotation: number;
}

export interface AssembleOutputSpec {
  name: string;
  pages: AssemblePage[];
}

export interface AssembledFile {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export type ProgressFn = (done: number, total: number) => void;

const P = PDFName.of('P');
const PARENT = PDFName.of('Parent');
const TYPE = PDFName.of('Type');
const SUBTYPE = PDFName.of('Subtype');
const ANNOTS = PDFName.of('Annots');
const DEST = PDFName.of('Dest');
const D = PDFName.of('D');
const B = PDFName.of('B');

function isPageLike(obj: PDFObject | undefined): boolean {
  if (obj instanceof PDFPageLeaf) return true;
  if (obj instanceof PDFDict) {
    const type = obj.get(TYPE);
    return type === PDFName.of('Page') || type === PDFName.of('Pages');
  }
  return false;
}

/**
 * pdf-lib's `copyPages` deep-copies everything a page references. Annotations often point
 * at other pages (/P, link destinations, form-field trees, replies), which would drag
 * whole other pages — including pages the visitor deleted — into the output as hidden,
 * unreachable-but-present objects. This cuts those references in the (throwaway) source
 * document before copying:
 *
 *  - references to any page or page-tree node are removed (destinations become inert);
 *  - references to annotations that belong to a different page are removed;
 *  - widget annotations lose /Parent (the AcroForm field tree spans all pages);
 *  - page-level article beads (/B) are dropped.
 *
 * Visible page content (content streams, resources, appearance streams) is untouched.
 */
export function cutCrossPageReferences(doc: PDFDocument): void {
  const ctx = doc.context;
  const pages = doc.getPages();
  const annotOwner = new Map<string, number>();
  pages.forEach((page, i) => {
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
    annots?.asArray().forEach((a) => {
      if (a instanceof PDFRef) annotOwner.set(a.toString(), i);
    });
  });

  const resolve = (o: PDFObject | undefined) => (o instanceof PDFRef ? ctx.lookup(o) : o);

  pages.forEach((page, pageIdx) => {
    const visited = new Set<PDFObject>();

    const isForbiddenRef = (ref: PDFRef): boolean => {
      const target = ctx.lookup(ref);
      if (isPageLike(target)) return true;
      const owner = annotOwner.get(ref.toString());
      return owner !== undefined && owner !== pageIdx;
    };

    const walk = (obj: PDFObject | undefined, isAnnotation: boolean): void => {
      const target = resolve(obj);
      if (!target || visited.has(target)) return;
      visited.add(target);
      const dict = target instanceof PDFStream ? target.dict : target;
      if (dict instanceof PDFDict) {
        if (isAnnotation) {
          dict.delete(P);
          if (dict.get(SUBTYPE) === PDFName.of('Widget')) dict.delete(PARENT);
        }
        for (const [key, value] of dict.entries()) {
          if ((key === DEST || key === D) && value instanceof PDFArray && value.size() > 0) {
            const first = value.get(0);
            if (first instanceof PDFRef && isForbiddenRef(first)) {
              dict.delete(key);
              continue;
            }
          }
          if (value instanceof PDFRef) {
            if (isForbiddenRef(value)) {
              dict.delete(key);
              continue;
            }
            walk(value, key === PDFName.of('Popup') || key === PDFName.of('IRT'));
          } else {
            walk(value, false);
          }
        }
      } else if (dict instanceof PDFArray) {
        for (let i = 0; i < dict.size(); i++) {
          const value = dict.get(i);
          if (value instanceof PDFRef && isForbiddenRef(value)) {
            dict.set(i, PDFNull);
          } else {
            walk(value, false);
          }
        }
      }
    };

    page.node.delete(B);
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.get(i);
        if (a instanceof PDFRef && isForbiddenRef(a)) {
          annots.set(i, PDFNull);
          continue;
        }
        walk(a, true);
      }
    }
    // Page-level additional actions may hold GoTo destinations as well.
    walk(page.node.get(PDFName.of('AA')), false);
  });
}

function copyInfo(src: PDFDocument, dst: PDFDocument): void {
  const title = src.getTitle();
  const author = src.getAuthor();
  const subject = src.getSubject();
  const keywords = src.getKeywords();
  if (title) dst.setTitle(title);
  if (author) dst.setAuthor(author);
  if (subject) dst.setSubject(subject);
  if (keywords) dst.setKeywords([keywords]);
}

/**
 * Builds one or more PDFs from pages of the given sources. Pages are copied as-is
 * (content streams and resources are preserved; nothing is rasterised); only /Rotate
 * changes. Each output is a fresh document, so deleted pages are not carried along.
 */
export async function assemblePdfs(sources: AssembleSource[], outputs: AssembleOutputSpec[], onProgress?: ProgressFn): Promise<AssembledFile[]> {
  if (outputs.length === 0 || outputs.some((o) => o.pages.length === 0)) throw new AppError('error.noPagesSelected');
  const loaded = new Map<string, PDFDocument>();
  const total = outputs.length + 1;
  for (const s of sources) {
    const doc = await loadForEditing(s.bytes);
    cutCrossPageReferences(doc);
    loaded.set(s.id, doc);
  }
  onProgress?.(1, total);

  const results: AssembledFile[] = [];
  for (let o = 0; o < outputs.length; o++) {
    const spec = outputs[o];
    const out = await PDFDocument.create({ updateMetadata: false });
    out.setProducer('PageSail');
    out.setCreator('PageSail');
    out.setCreationDate(new Date());
    out.setModificationDate(new Date());

    // Copy all pages needed from each source in one call so shared resources
    // (fonts, images) are copied only once per output file.
    const bySource = new Map<string, number[]>();
    for (const p of spec.pages) {
      const src = loaded.get(p.sourceId);
      if (!src) throw new AppError('error.internal', undefined, `Unknown source ${p.sourceId}`);
      if (p.pageIndex < 0 || p.pageIndex >= src.getPageCount()) throw new AppError('error.internal', undefined, `Page ${p.pageIndex} out of range`);
      const list = bySource.get(p.sourceId) ?? [];
      list.push(p.pageIndex);
      bySource.set(p.sourceId, list);
    }
    const copied = new Map<string, PDFPage[]>();
    for (const [sourceId, indices] of bySource) {
      const src = loaded.get(sourceId)!;
      const pages = await out.copyPages(src, indices);
      indices.forEach((idx, i) => {
        const key = `${sourceId}#${idx}`;
        const list = copied.get(key) ?? [];
        list.push(pages[i]);
        copied.set(key, list);
      });
    }
    for (const p of spec.pages) {
      const page = copied.get(`${p.sourceId}#${p.pageIndex}`)!.shift()!;
      const base = page.getRotation().angle;
      page.setRotation(degrees(normalizeRotation(base + p.rotation)));
      out.addPage(page);
    }
    const firstSource = loaded.get(spec.pages[0].sourceId)!;
    if (bySource.size === 1) copyInfo(firstSource, out);

    const bytes = await out.save({ useObjectStreams: true });
    results.push({ name: spec.name, bytes, pageCount: spec.pages.length });
    onProgress?.(o + 2, total);
  }
  return results;
}
