import { describe, expect, it } from 'vitest';
import { hash2, mulberry32 } from '../src/core/rng.ts';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('emits floats in [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hash2', () => {
  it('is deterministic for the same seed and coords', () => {
    expect(hash2(7, 12, -34)).toBe(hash2(7, 12, -34));
  });

  it('differs for different coords', () => {
    expect(hash2(7, 12, -34)).not.toBe(hash2(7, 13, -34));
    expect(hash2(7, 12, -34)).not.toBe(hash2(7, 12, -33));
  });

  it('differs for different seeds', () => {
    expect(hash2(7, 12, -34)).not.toBe(hash2(8, 12, -34));
  });

  it('returns a float in [0, 1)', () => {
    for (let x = -20; x < 20; x++) {
      for (let y = -20; y < 20; y++) {
        const v = hash2(1337, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
