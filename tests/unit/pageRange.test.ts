import { describe, expect, it } from 'vitest';
import { formatPageRange, parsePageRange, parseRangeGroups } from '../../src/lib/pdf/pageRange';

describe('parsePageRange', () => {
  it('treats empty input as all pages', () => {
    expect(parsePageRange('', 4)).toEqual({ ok: true, pages: [1, 2, 3, 4] });
    expect(parsePageRange('   ', 2)).toEqual({ ok: true, pages: [1, 2] });
  });

  it('parses single pages and ranges, sorted and de-duplicated', () => {
    expect(parsePageRange('1,3-5', 10)).toEqual({ ok: true, pages: [1, 3, 4, 5] });
    expect(parsePageRange('5, 1, 3-4, 4', 10)).toEqual({ ok: true, pages: [1, 3, 4, 5] });
  });

  it('supports open ranges', () => {
    expect(parsePageRange('8-', 10)).toEqual({ ok: true, pages: [8, 9, 10] });
    expect(parsePageRange('-2', 10)).toEqual({ ok: true, pages: [1, 2] });
  });

  it('accepts full-width digits and CJK punctuation from IMEs', () => {
    expect(parsePageRange('１，３－４', 5)).toEqual({ ok: true, pages: [1, 3, 4] });
    expect(parsePageRange('1、2〜3'.replace('〜', '~'), 5)).toEqual({ ok: true, pages: [1, 2, 3] });
  });

  it('rejects malformed input with the offending token', () => {
    expect(parsePageRange('1,a', 5)).toEqual({ ok: false, error: { code: 'syntax', token: 'a' } });
    expect(parsePageRange('1-2-3', 5)).toEqual({ ok: false, error: { code: 'syntax', token: '1-2-3' } });
    expect(parsePageRange('-', 5)).toEqual({ ok: false, error: { code: 'syntax', token: '-' } });
    expect(parsePageRange('1.5', 5).ok).toBe(false);
  });

  it('rejects out-of-range and reversed ranges', () => {
    expect(parsePageRange('0', 5)).toEqual({ ok: false, error: { code: 'outOfBounds', token: '0' } });
    expect(parsePageRange('2-6', 5)).toEqual({ ok: false, error: { code: 'outOfBounds', token: '2-6' } });
    expect(parsePageRange('4-2', 5)).toEqual({ ok: false, error: { code: 'reversed', token: '4-2' } });
  });

  it('rejects input that selects nothing', () => {
    expect(parsePageRange(',,', 5)).toEqual({ ok: false, error: { code: 'empty', token: ',,' } });
  });
});

describe('formatPageRange', () => {
  it('compresses consecutive pages', () => {
    expect(formatPageRange([1, 2, 3, 5, 7, 8])).toBe('1-3,5,7-8');
    expect(formatPageRange([4])).toBe('4');
    expect(formatPageRange([])).toBe('');
  });

  it('round-trips through the parser', () => {
    const pages = [2, 3, 4, 9, 11, 12];
    const parsed = parsePageRange(formatPageRange(pages), 20);
    expect(parsed).toEqual({ ok: true, pages });
  });
});

describe('parseRangeGroups', () => {
  it('keeps every range as its own group, in order', () => {
    expect(parseRangeGroups('1-3, 4, 5-6', 6)).toEqual({ ok: true, groups: [[1, 2, 3], [4], [5, 6]] });
  });

  it('reports errors', () => {
    expect(parseRangeGroups('1-3, 9', 6).ok).toBe(false);
    expect(parseRangeGroups('', 6).ok).toBe(false);
  });
});
