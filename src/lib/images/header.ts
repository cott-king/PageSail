import { AppError } from '../errors';

/**
 * Reads image dimensions and EXIF orientation straight from PNG/JPEG headers, without
 * decoding pixels. Used to enforce resource limits before any expensive decode and to
 * place JPEG data correctly in PDFs (PDF viewers ignore EXIF orientation).
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ImageInfo {
  type: 'png' | 'jpeg';
  /** Stored pixel size (before EXIF orientation). */
  width: number;
  height: number;
  orientation: ExifOrientation;
  /** Size as displayed (after EXIF orientation). */
  displayWidth: number;
  displayHeight: number;
  /** PNG with an alpha channel or tRNS chunk. JPEG never has alpha. */
  hasAlpha: boolean;
  /** JPEG colour components (1 = gray, 3 = YCbCr/RGB, 4 = CMYK). */
  components?: number;
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function withOrientation(base: Omit<ImageInfo, 'displayWidth' | 'displayHeight'>): ImageInfo {
  const swap = base.orientation >= 5;
  return {
    ...base,
    displayWidth: swap ? base.height : base.width,
    displayHeight: swap ? base.width : base.height,
  };
}

export function readPngInfo(b: Uint8Array): ImageInfo {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) throw new AppError('error.imageCorrupt');
  const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (type !== 'IHDR') throw new AppError('error.imageCorrupt');
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  const colorType = b[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  // Look for a tRNS chunk before the first IDAT.
  let o = 8;
  while (o + 8 <= b.length) {
    const len = u32be(b, o);
    const name = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (name === 'tRNS') hasAlpha = true;
    if (name === 'IDAT' || name === 'IEND') break;
    o += 12 + len;
  }
  if (!width || !height) throw new AppError('error.imageCorrupt');
  return withOrientation({ type: 'png', width, height, orientation: 1, hasAlpha });
}

function readExifOrientation(b: Uint8Array, start: number, end: number): ExifOrientation {
  // start points at "Exif\0\0"
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
  if (!little && !big) return 1;
  const r16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : u16be(b, o));
  const r32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : u32be(b, o));
  if (r16(tiff + 2) !== 42) return 1;
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (r16(entry) === 0x0112) {
      const value = r16(entry + 8);
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
    }
  }
  return 1;
}

export function readJpegInfo(b: Uint8Array): ImageInfo {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new AppError('error.imageCorrupt');
  let o = 2;
  let orientation: ExifOrientation = 1;
  while (o < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    let marker = b[o + 1];
    while (marker === 0xff && o + 2 < b.length) {
      o++;
      marker = b[o + 1];
    }
    o += 2;
    // Standalone markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan before SOF → invalid
    if (o + 2 > b.length) break;
    const len = u16be(b, o);
    if (len < 2) break;
    const segEnd = Math.min(o + len, b.length);
    if (marker === 0xe1 && segEnd - o > 8) {
      const id = String.fromCharCode(b[o + 2], b[o + 3], b[o + 4], b[o + 5]);
      if (id === 'Exif' && b[o + 6] === 0 && b[o + 7] === 0) {
        orientation = readExifOrientation(b, o + 2, segEnd);
      }
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 8 > b.length) break;
      const height = u16be(b, o + 3);
      const width = u16be(b, o + 5);
      const components = b[o + 7];
      if (!width || !height) break;
      return withOrientation({ type: 'jpeg', width, height, orientation, hasAlpha: false, components });
    }
    o += len;
  }
  throw new AppError('error.imageCorrupt');
}

export function readImageInfo(bytes: Uint8Array): ImageInfo {
  if (bytes[0] === 0x89) return readPngInfo(bytes);
  if (bytes[0] === 0xff) return readJpegInfo(bytes);
  throw new AppError('error.unsupportedImage');
}

/**
 * Reads only as much of the file as needed for the header. JPEG EXIF/SOF can sit after
 * large APP segments, so we fall back to more bytes if the first slice is not enough.
 */
export async function readImageInfoFromFile(file: Blob): Promise<ImageInfo> {
  const sizes = [64 * 1024, 1024 * 1024, file.size];
  let lastError: unknown;
  for (const size of sizes) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(size, file.size)).arrayBuffer());
    try {
      return readImageInfo(bytes);
    } catch (e) {
      lastError = e;
      if (size >= file.size) break;
    }
  }
  throw lastError;
}
