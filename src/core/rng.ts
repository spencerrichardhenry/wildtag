// Deterministic pseudo-random primitives. Pure, allocation-free, seed-driven.

/**
 * Mulberry32 PRNG. Returns a generator producing floats in [0, 1).
 * Same seed => identical sequence; a foundation for all world generation.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic hash of two (typically integer) coordinates into [0, 1).
 * Stable across runs; used for per-cell gradients / scatter decisions.
 */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
