import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CASTLE } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { elfHomePosition, ElfSystem } from '../src/castle/elves.ts';

// ---------------------------------------------------------------------------
// Elves (Cursed Castle Task 12). `elfHomePosition` is pure placement math
// (golden-angle spiral around CASTLE.center) — tested standalone, no three.
// `ElfSystem` is the three.js wander/dance manager — `new THREE.Scene()`
// works headlessly here exactly as it does in tests/castle-system.test.ts.
// ---------------------------------------------------------------------------

const flatGround: GroundQuery = {
  heightAt: () => CASTLE.padHeight,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

const DT = 1 / 60;
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

describe('elfHomePosition', () => {
  it('is deterministic', () => {
    expect(elfHomePosition(3)).toEqual(elfHomePosition(3));
    expect(elfHomePosition(17)).toEqual(elfHomePosition(17));
  });

  it('stays within CASTLE.regionR (well inside — near the courtyard, not out at the region radius)', () => {
    for (let i = 0; i < 40; i++) {
      const p = elfHomePosition(i);
      const d = Math.hypot(p.x - CASTLE.center.x, p.z - CASTLE.center.z);
      expect(d).toBeLessThanOrEqual(CASTLE.regionR);
      // Homes settle in/near the courtyard, never out to the goblin region.
      expect(d).toBeLessThan(CASTLE.half);
    }
  });

  it('never lands inside the keep footprint (square, half-extent CASTLE.keepHalf)', () => {
    for (let i = 0; i < 40; i++) {
      const p = elfHomePosition(i);
      const dx = Math.abs(p.x - CASTLE.center.x);
      const dz = Math.abs(p.z - CASTLE.center.z);
      expect(dx < CASTLE.keepHalf && dz < CASTLE.keepHalf).toBe(false);
    }
  });

  it('indices 0-19 are pairwise more than 2 m apart', () => {
    const pts = Array.from({ length: 20 }, (_, i) => elfHomePosition(i));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d).toBeGreaterThan(2);
      }
    }
  });
});

function makeSystem(): ElfSystem {
  return new ElfSystem(new THREE.Scene(), flatGround);
}

describe('ElfSystem', () => {
  it('starts with zero elves', () => {
    const sys = makeSystem();
    expect(sys.count).toBe(0);
  });

  it('setCount spawns up to n and is idempotent', () => {
    const sys = makeSystem();
    sys.setCount(4);
    expect(sys.count).toBe(4);
    sys.setCount(4);
    expect(sys.count).toBe(4);
  });

  it('setCount reconciles upward and downward (load / purify-count restore)', () => {
    const sys = makeSystem();
    sys.setCount(6);
    expect(sys.count).toBe(6);
    sys.setCount(2);
    expect(sys.count).toBe(2);
    sys.setCount(5);
    expect(sys.count).toBe(5);
    sys.setCount(0);
    expect(sys.count).toBe(0);
  });

  it('setCount ignores negative/fractional input sanely', () => {
    const sys = makeSystem();
    sys.setCount(3.9);
    expect(sys.count).toBe(3);
    sys.setCount(-5);
    expect(sys.count).toBe(0);
  });

  it('addAt spawns the next-index elf and increments count', () => {
    const sys = makeSystem();
    sys.setCount(2);
    sys.addAt({ x: CASTLE.center.x + 50, y: 0, z: CASTLE.center.z + 50 });
    expect(sys.count).toBe(3);
  });

  it('update never throws across wander/pause/dance states over a long run', () => {
    const sys = makeSystem();
    sys.setCount(5);
    expect(() => {
      for (let i = 0; i < Math.round(60 / DT); i++) sys.update(DT, ORIGIN);
    }).not.toThrow();
  });

  it('dispose clears all elves', () => {
    const sys = makeSystem();
    sys.setCount(4);
    sys.dispose();
    expect(sys.count).toBe(0);
  });
});
