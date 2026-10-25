/**
 * Brightness / contrast as a 256-entry lookup table, applied identically to the on-screen
 * preview and to the full-resolution export. Alpha is never touched.
 *
 * brightness, contrast ∈ [-100, 100]; 0 means "unchanged".
 */
export function buildLut(brightness: number, contrast: number): Uint8ClampedArray {
  const b = (Math.max(-100, Math.min(100, brightness)) / 100) * 255;
  const c = (Math.max(-100, Math.min(100, contrast)) / 100) * 255;
  // Classic contrast factor; c = 255 would divide by ~0, so cap just below.
  const cc = Math.min(254, c);
  const f = (259 * (cc + 255)) / (255 * (259 - cc));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(f * (v + b - 128) + 128);
  }
  return lut;
}

export function isIdentity(brightness: number, contrast: number): boolean {
  return Math.round(brightness) === 0 && Math.round(contrast) === 0;
}

export function applyLut(data: Uint8ClampedArray, lut: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}
