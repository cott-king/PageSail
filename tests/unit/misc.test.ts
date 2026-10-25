import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { missingCharacters, parseCmapCoverage } from '../../src/editor/cmap';
import { History } from '../../src/editor/history';
import { initialPagesState, pagesReducer, chunk, type PageRef } from '../../src/features/pdf-pages/pagesState';
import { ZipBuilder } from '../../src/lib/files/zip';
import { safeFileName, uniqueNames, baseName } from '../../src/lib/files/names';
import { cleanTextForPdf } from '../../src/features/pdf-annotate/exportPdf';
import { ROOT } from '../helpers/pdf';

const font = (f: string) => parseCmapCoverage(new Uint8Array(readFileSync(path.join(ROOT, 'public/fonts', f))));

describe('font coverage (cmap)', () => {
  const sc = font('NotoSansSC-Regular.ttf');
  const jp = font('NotoSansJP-Regular.ttf');
  const latin = font('NotoSans-Regular.ttf');

  it('Noto Sans SC covers Chinese, Japanese kana and Latin', () => {
    expect(missingCharacters('简体中文 你们这说时对发 こんにちは カタカナ 漢字 Hello, World!', sc)).toEqual([]);
    expect(sc.size).toBeGreaterThan(25_000);
  });

  it('Noto Sans JP lacks some simplified-only hanzi', () => {
    expect(missingCharacters('日本語のテキスト', jp)).toEqual([]);
    expect(missingCharacters('们这说', jp)).toEqual(['们', '这', '说']);
  });

  it('Noto Sans (Latin) lacks CJK and reports each character once', () => {
    expect(missingCharacters('Ça va? Привет Γεια', latin)).toEqual([]);
    expect(missingCharacters('中中文', latin)).toEqual(['中', '文']);
  });

  it('ignores whitespace and invisible format characters, but reports emoji', () => {
    expect(missingCharacters('a b\n\tc\u200b', latin)).toEqual([]);
    expect(missingCharacters('ok 😀', sc)).toEqual(['😀']);
  });

  it('strips invisible characters before writing PDF text', () => {
    expect(cleanTextForPdf('a\u200bb\ufeffc\tz')).toBe('abc    z');
  });
});

describe('History', () => {
  it('undoes and redoes, collapses duplicates and drops redo on new edits', () => {
    const h = new History<number[]>([], 3);
    expect(h.push([])).toBe(false);
    h.push([1]);
    h.push([1, 2]);
    expect(h.undo()).toEqual([1]);
    expect(h.redo()).toEqual([1, 2]);
    h.undo();
    h.push([1, 3]);
    expect(h.canRedo).toBe(false);
    expect(h.current).toEqual([1, 3]);
  });

  it('keeps at most `limit` undo steps', () => {
    const h = new History<number>(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    let steps = 0;
    while (h.undo() !== null) steps++;
    expect(steps).toBe(3);
    expect(h.current).toBe(7);
  });
});

describe('page organiser state', () => {
  const pages: PageRef[] = [0, 1, 2, 3].map((i) => ({ key: `k${i}`, sourceId: 'A', pageIndex: i, rotation: 0 }));
  const start = pagesReducer(initialPagesState, { type: 'add', pages });

  it('moves selected pages and supports undo/redo', () => {
    let s = pagesReducer(start, { type: 'toggle', key: 'k2' });
    s = pagesReducer(s, { type: 'toggle', key: 'k3' });
    s = pagesReducer(s, { type: 'moveSelected', delta: -1 });
    expect(s.pages.map((p) => p.key)).toEqual(['k0', 'k2', 'k3', 'k1']);
    s = pagesReducer(s, { type: 'moveSelected', delta: -1 });
    expect(s.pages.map((p) => p.key)).toEqual(['k2', 'k3', 'k0', 'k1']);
    s = pagesReducer(s, { type: 'undo' });
    expect(s.pages.map((p) => p.key)).toEqual(['k0', 'k2', 'k3', 'k1']);
    s = pagesReducer(s, { type: 'redo' });
    expect(s.pages.map((p) => p.key)).toEqual(['k2', 'k3', 'k0', 'k1']);
  });

  it('rotates and deletes', () => {
    let s = pagesReducer(start, { type: 'rotate', keys: ['k1'], delta: -90 });
    expect(s.pages[1].rotation).toBe(270);
    s = pagesReducer(s, { type: 'rotate', keys: ['k1'], delta: 180 });
    expect(s.pages[1].rotation).toBe(90);
    s = pagesReducer(s, { type: 'toggle', key: 'k0' });
    s = pagesReducer(s, { type: 'remove', keys: ['k0'] });
    expect(s.pages.map((p) => p.key)).toEqual(['k1', 'k2', 'k3']);
    expect(s.selected).toEqual([]);
  });

  it('drag-moves a page to another position', () => {
    const s = pagesReducer(start, { type: 'moveTo', key: 'k0', toKey: 'k3' });
    expect(s.pages.map((p) => p.key)).toEqual(['k1', 'k2', 'k3', 'k0']);
  });

  it('selects ranges', () => {
    const s = pagesReducer(start, { type: 'selectRange', fromKey: 'k3', toKey: 'k1' });
    expect([...s.selected].sort()).toEqual(['k1', 'k2', 'k3']);
  });

  it('chunks pages for split', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('ZIP and file names', () => {
  it('writes a valid ZIP with UTF-8 names and unique entries', async () => {
    const z = new ZipBuilder();
    z.add('页面-1.png', new Uint8Array([1, 2, 3]));
    z.add('ページ.png', new Uint8Array([4]));
    z.add('页面-1.png', new Uint8Array([5]));
    const blob = await z.finish();
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['ページ.png', '页面-1 (2).png', '页面-1.png'].sort());
    expect([...files['页面-1.png']]).toEqual([1, 2, 3]);
    expect(strFromU8(files['ページ.png'], true).length).toBe(1);
  });

  it('sanitises download names but keeps CJK characters', () => {
    const traversal = safeFileName('../../etc/passwd');
    expect(traversal).not.toMatch(/[\\/]/);
    expect(traversal.startsWith('.')).toBe(false);
    expect(safeFileName('a<b>:c|d?.pdf')).toBe('a_b_c_d_.pdf');
    expect(safeFileName('报告\u0000.pdf')).toBe('报告_.pdf');
    expect(safeFileName('   ')).toBe('pagesail');
    expect(baseName('C:\\docs\\年度报告.final.pdf')).toBe('年度报告.final');
    expect(uniqueNames(['a.png', 'A.png', 'b'])).toEqual(['a.png', 'A (2).png', 'b']);
  });
});
