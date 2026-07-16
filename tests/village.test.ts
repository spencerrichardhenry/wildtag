import { describe, expect, it } from 'vitest';
import {
  computeVillageLayout,
  findVillageCenter,
  inVillage,
  villageLayout,
} from '../src/village/layout.ts';
import { villageObstacles } from '../src/village/buildings.ts';
import { VILLAGE } from '../src/core/constants.ts';
import { biomeAt, heightAt } from '../src/world/terrain.ts';

/** Height range (max − min) over a square footprint window. */
function footprintRange(cx: number, cz: number, half: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  const n = 5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = cx - half + (2 * half * i) / (n - 1);
      const z = cz - half + (2 * half * j) / (n - 1);
      const h = heightAt(x, z);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi - lo;
}

/** True if two axis-aligned w×d boxes (centres c1/c2) overlap with a margin. */
function aabbOverlap(
  a: { x: number; z: number; w: number; d: number },
  b: { x: number; z: number; w: number; d: number },
  margin: number,
): boolean {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return dx < (a.w + b.w) / 2 + margin && dz < (a.d + b.d) / 2 + margin;
}

describe('village layout determinism', () => {
  it('recomputes byte-identical layouts', () => {
    expect(computeVillageLayout()).toEqual(computeVillageLayout());
  });

  it('memoised layout is stable', () => {
    expect(villageLayout()).toBe(villageLayout());
  });
});

describe('village placement', () => {
  const layout = computeVillageLayout();

  it('emits the 5 spec buildings', () => {
    expect(layout.buildings.map((b) => b.id).sort()).toEqual(
      ['barter', 'farmhouse', 'home1', 'home2', 'home3'].sort(),
    );
    expect(layout.buildings.filter((b) => b.kind === 'home')).toHaveLength(3);
    expect(layout.buildings.filter((b) => b.kind === 'farmhouse')).toHaveLength(1);
    expect(layout.buildings.filter((b) => b.kind === 'barter')).toHaveLength(1);
  });

  it('has no overlapping building footprints (AABB + margin)', () => {
    const b = layout.buildings;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        expect(aabbOverlap(b[i]!, b[j]!, VILLAGE.overlapMargin)).toBe(false);
      }
    }
  });

  it('sits every building on gentle meadow ground', () => {
    for (const b of layout.buildings) {
      expect(biomeAt(b.x, b.z)).toBe('meadow');
      expect(footprintRange(b.x, b.z, Math.max(b.w, b.d) / 2)).toBeLessThan(
        VILLAGE.flatThreshold,
      );
    }
  });

  it('snaps the centre to a flat meadow pocket within the search box', () => {
    const c = findVillageCenter();
    expect(biomeAt(c.x, c.z)).toBe('meadow');
    expect(Math.abs(c.x - VILLAGE.nominalCenter.x)).toBeLessThanOrEqual(VILLAGE.searchRadius);
    expect(Math.abs(c.z - VILLAGE.nominalCenter.z)).toBeLessThanOrEqual(VILLAGE.searchRadius);
  });
});

describe('village connectivity + features', () => {
  const layout = computeVillageLayout();

  it('connects every building door via a path ending at the plaza centre', () => {
    expect(layout.paths).toHaveLength(layout.buildings.length);
    for (const path of layout.paths) {
      const last = path.points[path.points.length - 1]!;
      expect(last.x).toBeCloseTo(layout.plaza.x, 6);
      expect(last.z).toBeCloseTo(layout.plaza.z, 6);
    }
    // Each door is the start of exactly one path.
    for (const b of layout.buildings) {
      const match = layout.paths.find(
        (p) => Math.hypot(p.points[0]!.x - b.door.x, p.points[0]!.z - b.door.z) < 1e-6,
      );
      expect(match).toBeDefined();
    }
  });

  it('emits a pen beside each home', () => {
    const homeIds = layout.buildings.filter((b) => b.kind === 'home').map((b) => b.id);
    expect(layout.pens.map((p) => p.homeId).sort()).toEqual(homeIds.sort());
  });

  it('emits the farm plot grid with only the first N unlocked', () => {
    const total = VILLAGE.farm.cols * VILLAGE.farm.rows;
    expect(layout.farm.plots).toHaveLength(total);
    expect(layout.farm.plots.filter((p) => p.unlocked)).toHaveLength(VILLAGE.farm.unlocked);
    // Positions are all distinct.
    const keys = new Set(layout.farm.plots.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    expect(keys.size).toBe(total);
  });

  it('emits lamp posts and a closed fence loop', () => {
    expect(layout.lamps).toHaveLength(VILLAGE.lampCount);
    expect(layout.fences.length).toBeGreaterThanOrEqual(4);
    // Fence loop is closed: each segment end meets the next segment start.
    for (let i = 0; i < layout.fences.length; i++) {
      const cur = layout.fences[i]!;
      const next = layout.fences[(i + 1) % layout.fences.length]!;
      expect(cur.x2).toBeCloseTo(next.x1, 6);
      expect(cur.z2).toBeCloseTo(next.z1, 6);
    }
  });
});

describe('villageObstacles coverage', () => {
  it('covers every building footprint completely (grid inset 0.2m)', () => {
    const layout = villageLayout();
    const obstacles = villageObstacles();
    const inset = 0.2;
    const n = 9; // samples per axis
    for (const b of layout.buildings) {
      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          // Local footprint grid point (inset from the walls), rotated to world.
          const lx = -b.w / 2 + inset + ((b.w - 2 * inset) * i) / (n - 1);
          const lz = -b.d / 2 + inset + ((b.d - 2 * inset) * j) / (n - 1);
          const wx = b.x + lx * cos + lz * sin;
          const wz = b.z - lx * sin + lz * cos;
          const covered = obstacles.some((o) => Math.hypot(wx - o.x, wz - o.z) <= o.r);
          if (!covered) {
            throw new Error(
              `uncovered footprint point on ${b.id} at local (${lx.toFixed(2)}, ${lz.toFixed(2)})`,
            );
          }
        }
      }
    }
  });
});

describe('inVillage', () => {
  it('is true at the plaza and false at the world origin', () => {
    const c = findVillageCenter();
    expect(inVillage(c.x, c.z)).toBe(true);
    expect(inVillage(0, 0)).toBe(false);
  });
});
