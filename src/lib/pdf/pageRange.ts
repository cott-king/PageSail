/**
 * Page range syntax used across the app (1-based, inclusive):
 *
 *   ""          → all pages
 *   "3"         → page 3
 *   "1,3-5"     → pages 1, 3, 4, 5
 *   "8-"        → page 8 to the last page
 *   "-3"        → pages 1 to 3
 *
 * Whitespace is ignored; both "," and the CJK commas "，" / "、" separate items, and
 * "–", "—", "~" and "～" are accepted as range dashes because IMEs often produce them.
 */

export type RangeErrorCode = 'syntax' | 'outOfBounds' | 'reversed' | 'empty';

export interface RangeError {
  code: RangeErrorCode;
  /** The offending part of the input, for the error message. */
  token: string;
}

export type ParsedRange = { ok: true; pages: number[] } | { ok: false; error: RangeError };

export function parsePageRange(input: string, pageCount: number): ParsedRange {
  const normalized = input
    .normalize('NFKC')
    .replace(/[，、;；]/g, ',')
    .replace(/[–—~～－]/g, '-')
    .replace(/\s+/g, '');
  if (normalized === '') {
    return pageCount > 0 ? { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) } : { ok: false, error: { code: 'empty', token: '' } };
  }
  const set = new Set<number>();
  for (const token of normalized.split(',')) {
    if (token === '') continue;
    const m = /^(\d*)-(\d*)$/.exec(token);
    let from: number;
    let to: number;
    if (/^\d+$/.test(token)) {
      from = to = Number(token);
    } else if (m && (m[1] !== '' || m[2] !== '')) {
      from = m[1] === '' ? 1 : Number(m[1]);
      to = m[2] === '' ? pageCount : Number(m[2]);
    } else {
      return { ok: false, error: { code: 'syntax', token } };
    }
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      return { ok: false, error: { code: 'outOfBounds', token } };
    }
    if (from > to) return { ok: false, error: { code: 'reversed', token } };
    for (let p = from; p <= to; p++) set.add(p);
  }
  if (set.size === 0) return { ok: false, error: { code: 'empty', token: input } };
  return { ok: true, pages: [...set].sort((a, b) => a - b) };
}

/** Formats a set of 1-based page numbers compactly, e.g. [1,2,3,5] → "1-3,5". */
export function formatPageRange(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * Splits an ordered list of N items into consecutive groups described by ranges, e.g.
 * "1-3,4,5-9" for split-by-ranges. Unlike parsePageRange, order and duplicates are kept
 * and every range becomes one group.
 */
export function parseRangeGroups(input: string, count: number): { ok: true; groups: number[][] } | { ok: false; error: RangeError } {
  const normalized = input
    .normalize('NFKC')
    .replace(/[，、;；]/g, ',')
    .replace(/[–—~～－]/g, '-')
    .replace(/\s+/g, '');
  const groups: number[][] = [];
  for (const token of normalized.split(',')) {
    if (token === '') continue;
    const single = parsePageRange(token, count);
    if (!single.ok) return single;
    groups.push(single.pages);
  }
  if (groups.length === 0) return { ok: false, error: { code: 'empty', token: input } };
  return { ok: true, groups };
}
