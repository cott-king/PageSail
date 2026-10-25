/**
 * File type detection by content ("magic bytes"), never by file name or the MIME
 * type reported by the browser, which are easy to get wrong.
 */
export type DetectedType = 'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'avif' | 'bmp' | 'tiff' | 'empty' | 'unknown';

const HEAD_BYTES = 1024;

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function detectBytes(bytes: Uint8Array): DetectedType {
  if (bytes.length === 0) return 'empty';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
    if (/^avi[fs]$/.test(brand)) return 'avif';
  }
  // The PDF header may be preceded by junk; readers accept it within the first 1 KiB.
  const head = ascii(bytes, 0, Math.min(bytes.length, HEAD_BYTES));
  if (head.includes('%PDF-')) return 'pdf';
  return 'unknown';
}

export async function detectFileType(file: Blob): Promise<DetectedType> {
  if (file.size === 0) return 'empty';
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  return detectBytes(head);
}

export function isImageType(t: DetectedType): t is 'png' | 'jpeg' {
  return t === 'png' || t === 'jpeg';
}
