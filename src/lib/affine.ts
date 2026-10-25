/**
 * 2D affine matrices in the canvas / PDF layout `[a, b, c, d, e, f]`:
 *
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 *
 * `multiply(A, B)` returns A·B, i.e. the transform that applies B first and then A.
 * This matches Fabric's `util.multiplyTransformMatrices` and the PDF `cm` operator
 * (emitting `cm` with X makes new drawing coordinates go through X before the old CTM).
 */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Multiplies left to right: compose(A, B, C) = A·B·C (C is applied first). */
export function compose(...ms: Matrix[]): Matrix {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('Matrix is not invertible');
  }
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

/** Rotation by `deg` degrees; positive is clockwise in a y-down space. */
export function rotate(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Snap exact quarter turns so 90° rotations stay integer-precise.
  const c = Math.abs(cos) < 1e-12 ? 0 : cos;
  const s = Math.abs(sin) < 1e-12 ? 0 : sin;
  return [c, s, -s, c, 0, 0];
}

export function isFiniteMatrix(m: readonly number[]): m is Matrix {
  return m.length === 6 && m.every((v) => Number.isFinite(v));
}
