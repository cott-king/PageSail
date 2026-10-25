import type { Locale, MessageKey } from '../i18n/messages';
import { AppError } from '../lib/errors';
import { parseCmapCoverage, type Coverage } from './cmap';

/**
 * Fonts for added text. They are served by this site (public/fonts, SIL OFL 1.1) and
 * fetched only when the visitor actually uses a text tool. The same bytes are used for
 * the on-screen preview (FontFace) and for PDF embedding (subset by pdf-lib), so what
 * you see is what gets exported.
 */
export type FontId = 'noto-sans' | 'noto-sans-sc' | 'noto-sans-jp';

export interface FontDef {
  id: FontId;
  /** CSS family name registered via FontFace (prefixed to avoid clashing with local fonts). */
  family: string;
  file: string;
  label: MessageKey;
  approxMB: number;
}

export const FONTS: FontDef[] = [
  { id: 'noto-sans-sc', family: 'PageSail Noto Sans SC', file: 'NotoSansSC-Regular.ttf', label: 'font.notoSansSC', approxMB: 10.6 },
  { id: 'noto-sans-jp', family: 'PageSail Noto Sans JP', file: 'NotoSansJP-Regular.ttf', label: 'font.notoSansJP', approxMB: 5.8 },
  { id: 'noto-sans', family: 'PageSail Noto Sans', file: 'NotoSans-Regular.ttf', label: 'font.notoSans', approxMB: 0.7 },
];

export function fontDef(id: string): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function fontIdForFamily(family: string | undefined): FontId | undefined {
  return FONTS.find((f) => f.family === family)?.id;
}

export function defaultFontFor(locale: Locale): FontId {
  if (locale === 'ja') return 'noto-sans-jp';
  if (locale === 'en') return 'noto-sans';
  return 'noto-sans-sc';
}

const HAN_OR_KANA = /[\u3000-\u303F\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F]/u;

/** Font that most likely covers `text` (Noto Sans SC has the broadest CJK + kana coverage). */
export function suggestFont(text: string, locale: Locale): FontId {
  if (!HAN_OR_KANA.test(text)) return 'noto-sans';
  return locale === 'ja' ? 'noto-sans-jp' : 'noto-sans-sc';
}

export interface LoadedFont {
  def: FontDef;
  bytes: Uint8Array;
  coverage: Coverage;
}

const loaded = new Map<FontId, LoadedFont>();
const pending = new Map<FontId, Promise<LoadedFont>>();

export function getLoadedFont(id: FontId): LoadedFont | undefined {
  return loaded.get(id);
}

export function loadFont(id: FontId): Promise<LoadedFont> {
  const ready = loaded.get(id);
  if (ready) return Promise.resolve(ready);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const def = fontDef(id);
  const p = (async () => {
    const url = `${import.meta.env.BASE_URL}fonts/${def.file}`;
    let bytes: Uint8Array;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      throw new AppError('error.fontLoad', { font: def.family.replace('PageSail ', '') }, e instanceof Error ? e.message : String(e));
    }
    const coverage = parseCmapCoverage(bytes);
    const face = new FontFace(def.family, bytes.slice().buffer, { style: 'normal', weight: '400' });
    await face.load();
    document.fonts.add(face);
    const font = { def, bytes, coverage };
    loaded.set(id, font);
    return font;
  })();
  pending.set(id, p);
  p.catch(() => undefined).finally(() => pending.delete(id));
  return p;
}
