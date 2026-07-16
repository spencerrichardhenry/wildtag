import { mulberry32 } from '../core/rng.ts';

// 2D simplex noise (gradient-hash construction, after Gustavson/Perlin).
// makeNoise2D(seed) returns a pure sampler in the range [-1, 1].

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 gradient directions (the classic simplex gradient set, 2D subset).
const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
]);

/**
 * Build a deterministic 2D simplex-noise sampler.
 * @param seed drives the permutation table; equal seeds => identical field.
 * @returns (x, y) => noise value in [-1, 1], smooth and continuous.
 */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  // Seeded Fisher-Yates shuffle of 0..255, doubled to avoid index wrapping.
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }

  return function noise2D(xin: number, yin: number): number {
    // Skew input space to determine which simplex cell we are in.
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Determine which triangle of the cell (lower or upper) the point is in.
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi0 = permMod12[ii + perm[jj]!]! * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD2[gi0]! * x0 + GRAD2[gi0 + 1]! * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]!]! * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD2[gi1]! * x1 + GRAD2[gi1 + 1]! * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]!]! * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD2[gi2]! * x2 + GRAD2[gi2 + 1]! * y2);
    }

    // Scale to fit [-1, 1] (70 is the canonical 2D simplex normalizer).
    return 70 * (n0 + n1 + n2);
  };
}
