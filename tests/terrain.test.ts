import { describe, expect, it } from 'vitest';
import { makeNoise2D } from '../src/world/noise.ts';
import { biomeAt, groundNormalAt, heightAt } from '../src/world/terrain.ts';
import type { Biome } from '../src/core/types.ts';

describe('makeNoise2D', () => {
  it('is deterministic for the same seed', () => {
    const a = makeNoise2D(99);
    const b = makeNoise2D(99);
    expect(a(3.14, -2.7)).toBe(b(3.14, -2.7));
  });

  it('differs across seeds', () => {
    const a = makeNoise2D(1);
    const b = makeNoise2D(2);
    // Extremely unlikely to collide at a generic sample point.
    expect(a(3.14, -2.7)).not.toBe(b(3.14, -2.7));
  });

  it('stays within [-1, 1] and varies', () => {
    const noise = makeNoise2D(1337);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const x = (i * 12.9898) % 500;
      const y = (i * 78.233) % 500;
      const v = noise(x, y);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(-0.3);
    expect(max).toBeGreaterThan(0.3);
  });
});

describe('heightAt', () => {
  it('is deterministic', () => {
    expect(heightAt(123.4, -55.2)).toBe(heightAt(123.4, -55.2));
  });

  it('is deterministic at negative coordinates', () => {
    expect(heightAt(-321.5, -777.25)).toBe(heightAt(-321.5, -777.25));
  });

  it('has at least one wetland lake (south sector point below sea level)', () => {
    let found = false;
    for (let x = -400; x <= 400 && !found; x += 10) {
      for (let z = 250; z <= 700; z += 10) {
        if (heightAt(x, z) < 0) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('is underwater beyond the island radius', () => {
    expect(heightAt(1020, 0)).toBeLessThan(0);
  });

  it('is walkable land at spawn', () => {
    expect(heightAt(0, 0)).toBeGreaterThan(0.5);
  });
});

describe('biomeAt', () => {
  it('is meadow at spawn', () => {
    expect(biomeAt(0, 0)).toBe('meadow');
  });

  it('is water beyond the island radius', () => {
    expect(biomeAt(1020, 0)).toBe('water');
  });

  it('contains all five land biomes across a sampled grid', () => {
    const seen = new Set<Biome>();
    const step = 40;
    for (let x = -900; x <= 900; x += step) {
      for (let z = -900; z <= 900; z += step) {
        seen.add(biomeAt(x, z));
      }
    }
    for (const biome of ['meadow', 'forest', 'wetland', 'crags', 'highlands'] as const) {
      expect(seen.has(biome)).toBe(true);
    }
  });
});

describe('groundNormalAt', () => {
  it('returns a unit-length, up-dominant normal on gentle ground', () => {
    const n = groundNormalAt(0, 0);
    const len = Math.hypot(n.x, n.y, n.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
    expect(n.y).toBeGreaterThan(0.9);
  });
});

describe('heightAt performance', () => {
  it('runs 100k calls in under 500 ms', () => {
    // Warm up the JIT so the timed loop reflects steady-state cost.
    for (let i = 0; i < 10000; i++) heightAt(i * 0.7, i * 1.3);
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 100000; i++) {
      acc += heightAt((i % 2048) - 1024, ((i * 3) % 2048) - 1024);
    }
    const elapsed = performance.now() - start;
    expect(acc).not.toBeNaN();
    expect(elapsed).toBeLessThan(500);
  });
});
