/**
 * Minimal TrueType/OpenType `cmap` reader (formats 4 and 12) that answers one question:
 * does this font have a glyph for a code point? Used to warn about missing characters
 * before export instead of silently producing empty boxes.
 */
export interface Coverage {
  has(codePoint: number): boolean;
  size: number;
}

const MAX_CP = 0x110000;

class BitCoverage implements Coverage {
  private readonly bits = new Uint8Array(MAX_CP >> 3);
  size = 0;
  add(cp: number) {
    if (cp < 0 || cp >= MAX_CP) return;
    const i = cp >> 3;
    const m = 1 << (cp & 7);
    if (!(this.bits[i] & m)) {
      this.bits[i] |= m;
      this.size++;
    }
  }
  has(cp: number): boolean {
    return cp >= 0 && cp < MAX_CP && (this.bits[cp >> 3] & (1 << (cp & 7))) !== 0;
  }
}

function tag(dv: DataView, o: number): string {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
}

export function parseCmapCoverage(bytes: Uint8Array): Coverage {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (tag(dv, rec) === 'cmap') {
      cmap = dv.getUint32(rec + 8);
      break;
    }
  }
  if (cmap < 0) throw new Error('Font has no cmap table');

  const n = dv.getUint16(cmap + 2);
  const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const offset = cmap + dv.getUint32(rec + 4);
    subtables.push({ platform: dv.getUint16(rec), encoding: dv.getUint16(rec + 2), offset, format: dv.getUint16(offset) });
  }
  const pick =
    subtables.find((s) => s.format === 12 && (s.platform === 3 || s.platform === 0)) ??
    subtables.find((s) => s.format === 4 && ((s.platform === 3 && s.encoding === 1) || s.platform === 0));
  if (!pick) throw new Error('Unsupported cmap');

  const cov = new BitCoverage();
  const o = pick.offset;
  if (pick.format === 12) {
    const groups = dv.getUint32(o + 12);
    for (let g = 0; g < groups; g++) {
      const r = o + 16 + g * 12;
      const start = dv.getUint32(r);
      const end = dv.getUint32(r + 4);
      const glyph = dv.getUint32(r + 8);
      for (let cp = start; cp <= end && cp < MAX_CP; cp++) {
        if (glyph + (cp - start) !== 0) cov.add(cp);
      }
    }
  } else {
    const segX2 = dv.getUint16(o + 6);
    const seg = segX2 / 2;
    const endCodes = o + 14;
    const startCodes = endCodes + segX2 + 2;
    const deltas = startCodes + segX2;
    const rangeOffsets = deltas + segX2;
    for (let s = 0; s < seg; s++) {
      const end = dv.getUint16(endCodes + s * 2);
      const start = dv.getUint16(startCodes + s * 2);
      const delta = dv.getInt16(deltas + s * 2);
      const ro = dv.getUint16(rangeOffsets + s * 2);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let glyph: number;
        if (ro === 0) glyph = (cp + delta) & 0xffff;
        else {
          const addr = rangeOffsets + s * 2 + ro + (cp - start) * 2;
          glyph = addr + 1 < dv.byteLength ? dv.getUint16(addr) : 0;
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) cov.add(cp);
      }
    }
  }
  return cov;
}

/** Code points that render as nothing and do not need a glyph. */
export function isIgnorable(cp: number): boolean {
  return (
    cp === 0x0a ||
    cp === 0x0d ||
    cp === 0x09 ||
    cp === 0x20 ||
    cp === 0xad ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff
  );
}

/** Unique characters of `text` the font cannot display, in order of first appearance. */
export function missingCharacters(text: string, coverage: Coverage): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (seen.has(cp) || isIgnorable(cp)) continue;
    seen.add(cp);
    if (!coverage.has(cp)) out.push(ch);
  }
  return out;
}
