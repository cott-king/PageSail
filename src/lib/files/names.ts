/**
 * File names come from the visitor's own files. They are only ever rendered as plain
 * text (React escapes them) and sanitised before being used for downloads.
 */

// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

export function safeFileName(name: string, fallback = 'pagesail'): string {
  let s = name.normalize('NFC').replace(FORBIDDEN, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '');
  if (!s) s = fallback;
  // Keep names well below common file system limits (counted in UTF-16 units, good enough).
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

export function withExtension(base: string, ext: string): string {
  return `${safeFileName(base)}.${ext}`;
}

export function padNumber(n: number, total: number): string {
  return String(n).padStart(String(total).length, '0');
}

/** Ensures names are unique inside one ZIP archive. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return n;
    const dot = n.lastIndexOf('.');
    return dot > 0 ? `${n.slice(0, dot)} (${count + 1})${n.slice(dot)}` : `${n} (${count + 1})`;
  });
}

export function formatBytes(bytes: number, locale?: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v < 10 ? 1 : 0;
  return `${v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`;
}
