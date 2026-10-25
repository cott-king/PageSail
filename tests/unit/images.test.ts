import { describe, expect, it } from 'vitest';
import { apply } from '../../src/lib/affine';
import { detectBytes } from '../../src/lib/files/detect';
import { readImageInfo } from '../../src/lib/images/header';
import { orientationMatrix, pdfImagePlacement } from '../../src/lib/images/orientation';
import { applyLut, buildLut } from '../../src/features/image-editor/adjust';
import { fixture } from '../helpers/pdf';

describe('file type detection (content, not extension)', () => {
  it('detects formats from magic bytes', () => {
    expect(detectBytes(fixture('multipage.pdf'))).toBe('pdf');
    expect(detectBytes(fixture('red-wide.png'))).toBe('png');
    expect(detectBytes(fixture('green-tall.jpg'))).toBe('jpeg');
    expect(detectBytes(fixture('image.webp'))).toBe('webp');
    expect(detectBytes(fixture('image-named.pdf'))).toBe('png');
    expect(detectBytes(fixture('empty.pdf'))).toBe('empty');
    expect(detectBytes(new TextEncoder().encode('hello world'))).toBe('unknown');
  });
});

describe('image headers', () => {
  it('reads PNG size and alpha', () => {
    expect(readImageInfo(fixture('red-wide.png'))).toMatchObject({ type: 'png', width: 240, height: 120, displayWidth: 240, displayHeight: 120, orientation: 1 });
    expect(readImageInfo(fixture('transparent.png')).hasAlpha).toBe(true);
  });

  it('reads JPEG size and EXIF orientation', () => {
    expect(readImageInfo(fixture('green-tall.jpg'))).toMatchObject({ type: 'jpeg', width: 120, height: 240, orientation: 1, hasAlpha: false, components: 3 });
    expect(readImageInfo(fixture('exif-rotate6.jpg'))).toMatchObject({ type: 'jpeg', width: 160, height: 80, orientation: 6, displayWidth: 80, displayHeight: 160 });
  });

  it('rejects truncated data', () => {
    expect(() => readImageInfo(fixture('red-wide.png').slice(0, 20))).toThrow();
    expect(() => readImageInfo(fixture('green-tall.jpg').slice(0, 10))).toThrow();
  });
});

describe('EXIF orientation matrices', () => {
  // Where the stored top-left pixel ends up after applying the orientation (w=4, h=2).
  const cases: [number, [number, number]][] = [
    [1, [0, 0]],
    [2, [4, 0]],
    [3, [4, 2]],
    [4, [0, 2]],
    [5, [0, 0]],
    [6, [2, 0]],
    [7, [2, 4]],
    [8, [0, 4]],
  ];
  it.each(cases)('orientation %i moves the stored origin to %j', (o, expected) => {
    expect(apply(orientationMatrix(o as never, 4, 2), 0, 0)).toEqual(expected);
  });

  it('places an EXIF-rotated JPEG upright in a PDF rectangle', () => {
    // Stored 160x80, orientation 6 → displayed 80x160. Stored top-left must land at the
    // displayed top-right corner of the target rectangle (PDF y-up).
    const m = pdfImagePlacement(6, 160, 80, { x: 10, y: 20, width: 80, height: 160 });
    // In PDF image space the stored top-left pixel is unit point (0, 1).
    expect(apply(m, 0, 1).map((v) => Math.round(v))).toEqual([90, 180]);
    // The displayed bottom-left corner of the rect must be covered by the unit square.
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([u, v]) => apply(m, u, v).map((x) => Math.round(x)).join(','));
    expect(new Set(corners)).toEqual(new Set(['10,20', '90,20', '10,180', '90,180']));
  });
});

describe('brightness / contrast LUT', () => {
  it('is the identity at 0/0', () => {
    const lut = buildLut(0, 0);
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it('brightens, darkens and increases contrast monotonically', () => {
    expect(buildLut(50, 0)[100]).toBeGreaterThan(100);
    expect(buildLut(-50, 0)[100]).toBeLessThan(100);
    const c = buildLut(0, 60);
    expect(c[200]).toBeGreaterThan(200);
    expect(c[50]).toBeLessThan(50);
    expect(c[128]).toBe(128);
    for (let v = 1; v < 256; v++) expect(c[v]).toBeGreaterThanOrEqual(c[v - 1]);
  });

  it('never touches alpha or fully transparent pixels', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 0, 100, 100, 100, 128]);
    applyLut(data, buildLut(80, 0));
    expect([...data.slice(0, 4)]).toEqual([100, 100, 100, 0]);
    expect(data[7]).toBe(128);
    expect(data[4]).toBeGreaterThan(100);
  });
});
