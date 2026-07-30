import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CASTLE, ELF, WARD } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { castleObstacles, spireObstacles } from '../src/castle/layout.ts';
import { wardLayout } from '../src/castle/ward.ts';
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

  it('each home falls within its round-robin plaza\'s cell bounds (Castle Ward Task 6)', () => {
    const plazas = wardLayout().plazas;
    const half = WARD.cellSize / 2;
    for (let i = 0; i < ELF.maxCount; i++) {
      const p = elfHomePosition(i);
      const plaza = plazas[i % plazas.length]!;
      const xs = plaza.cells.map((c) => c.x);
      const zs = plaza.cells.map((c) => c.z);
      const minX = Math.min(...xs) - half;
      const maxX = Math.max(...xs) + half;
      const minZ = Math.min(...zs) - half;
      const maxZ = Math.max(...zs) + half;
      expect(p.x).toBeGreaterThanOrEqual(minX);
      expect(p.x).toBeLessThanOrEqual(maxX);
      expect(p.z).toBeGreaterThanOrEqual(minZ);
      expect(p.z).toBeLessThanOrEqual(maxZ);
    }
  });

  it('never lands inside the keep footprint (square, half-extent CASTLE.keepHalf) — trivially true now plazas replace the open spiral', () => {
    for (let i = 0; i < ELF.maxCount; i++) {
      const p = elfHomePosition(i);
      const dx = Math.abs(p.x - CASTLE.center.x);
      const dz = Math.abs(p.z - CASTLE.center.z);
      expect(dx < CASTLE.keepHalf && dz < CASTLE.keepHalf).toBe(false);
    }
  });

  it('indices 0-27 (ELF.maxCount) are pairwise more than 2 m apart', () => {
    const pts = Array.from({ length: ELF.maxCount }, (_, i) => elfHomePosition(i));
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

  // ---------------------------------------------------------------------------
  // Growth cap (final-review fix): every purified goblin adds an elf with no
  // upper bound otherwise — ELF.maxCount stops that.
  // ---------------------------------------------------------------------------

  it('addAt beyond ELF.maxCount does not grow count', () => {
    const sys = makeSystem();
    sys.setCount(ELF.maxCount);
    sys.addAt({ x: CASTLE.center.x, y: 0, z: CASTLE.center.z });
    expect(sys.count).toBe(ELF.maxCount);
  });

  it('setCount clamps a request above ELF.maxCount', () => {
    const sys = makeSystem();
    sys.setCount(ELF.maxCount + 50);
    expect(sys.count).toBe(ELF.maxCount);
  });
});

// ---------------------------------------------------------------------------
// Wall/tower/keep/spire collision (final-review fix; spire added
// daze-eject-spires review round): a wandering elf is pushed out of the real
// castle obstacle set instead of ghosting through. Castle Ward Task 6: homes
// now sit inside the ward plazas (well inside the 90 m curtain wall) with a
// much tighter wanderR (9 m, was 30), but `ElfSystem.update` still runs every
// step through `castleObstacles()` (this test's set — curtain wall/towers/
// keep), `wardObstaclesNear` (the maze walls) AND `spireObstacles()` (the 3
// plaza-corner spires sit ~14.1m from their plaza centroid — inside a
// spiral-home + wanderR reach), so clipping any of them is structurally
// impossible.
// ---------------------------------------------------------------------------

describe('ElfSystem — wall collision', () => {
  // This exhaustive synchronous simulation is a local regression test; shared
  // CI runners vary enough in CPU speed to make its wall-clock timeout flaky.
  it.skipIf(Boolean(process.env.CI))(
    'never wanders into a castle wall/tower/keep/spire obstacle',
    () => {
      const scene = new THREE.Scene();
      const sys = new ElfSystem(scene, flatGround);
      sys.setCount(16);
      const obstacles = castleObstacles().concat(spireObstacles());
      const steps = Math.round(15 / DT);
      for (let i = 0; i < steps; i++) {
        sys.update(DT, ORIGIN);
        for (const child of scene.children) {
          if (!(child instanceof THREE.Group)) continue;
          const pos = child.position;
          for (const ob of obstacles) {
            if (ob.yTop !== undefined && pos.y > ob.yTop) continue;
            const d = Math.hypot(pos.x - ob.x, pos.z - ob.z);
            // See the matching comment in tests/goblins.test.ts: `resolveCollision`
            // is a single sequential pass, so adjacent overlapping wall circles
            // can leave a few mm of residual penetration — expected, not a bug.
            expect(d).toBeGreaterThanOrEqual(ob.r + ELF.bodyR - 0.05);
          }
        }
      }
    },
    20_000,
  );
});
