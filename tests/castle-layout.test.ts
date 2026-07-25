import { describe, expect, it } from 'vitest';
import { CASTLE } from '../src/core/constants.ts';
import {
  castleLayout,
  castleObstacles,
  castleGrappleColliders,
  inCastleRegion,
} from '../src/castle/layout.ts';

describe('castleLayout', () => {
  it('is deterministic with 4 towers, 4 walls, gate in a wall', () => {
    const a = castleLayout();
    const b = castleLayout();
    expect(a).toBe(b); // memoised
    expect(a.towers).toHaveLength(4);
    expect(a.walls).toHaveLength(4);
    expect(a.keep.h).toBe(CASTLE.keepH);
    expect(a.crystalPos.y).toBeCloseTo(CASTLE.padHeight + 1.2);
  });

  it('towers sit at the four corners of the square footprint', () => {
    const l = castleLayout();
    for (const t of l.towers) {
      expect(Math.abs(t.x - CASTLE.center.x)).toBeCloseTo(CASTLE.half, 5);
      expect(Math.abs(t.z - CASTLE.center.z)).toBeCloseTo(CASTLE.half, 5);
      expect(t.r).toBe(CASTLE.towerR);
      expect(t.h).toBe(CASTLE.towerH);
    }
  });

  it('gate sits on the wall facing the origin (spawn direction)', () => {
    const l = castleLayout();
    // The gate must lie on the castle's bounding square (one coordinate at
    // the ± half extent) and its outward normal must point roughly back
    // toward the origin (dot product of outward dir with (origin - gate) > 0).
    const dxHalf = Math.abs(Math.abs(l.gate.x - CASTLE.center.x) - CASTLE.half);
    const dzHalf = Math.abs(Math.abs(l.gate.z - CASTLE.center.z) - CASTLE.half);
    expect(Math.min(dxHalf, dzHalf)).toBeLessThan(1e-6);

    const toOrigin = { x: -l.gate.x, z: -l.gate.z };
    const toCenter = { x: CASTLE.center.x - l.gate.x, z: CASTLE.center.z - l.gate.z };
    // outward normal ~= -toCenter (points away from the castle interior)
    const outward = { x: -toCenter.x, z: -toCenter.z };
    const dot = outward.x * toOrigin.x + outward.z * toOrigin.z;
    expect(dot).toBeGreaterThan(0);
  });

  it('perches sit on tower tops and keep corners', () => {
    const l = castleLayout();
    expect(l.perches).toHaveLength(CASTLE.perchCount);
    for (const p of l.perches) {
      expect(p.y).toBeGreaterThanOrEqual(CASTLE.padHeight + CASTLE.wallH);
    }
  });
});

describe('castleObstacles', () => {
  it('produces circle obstacles covering towers, walls and keep', () => {
    const obs = castleObstacles();
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.z)).toBe(true);
      expect(o.r).toBeGreaterThan(0);
    }
    // A tower-sized obstacle exists at each tower corner.
    const l = castleLayout();
    for (const t of l.towers) {
      const found = obs.some(
        (o) => Math.hypot(o.x - t.x, o.z - t.z) < 0.5 && Math.abs(o.r - CASTLE.towerR) < 1e-6,
      );
      expect(found).toBe(true);
    }
  });
});

describe('castleGrappleColliders', () => {
  it('grapple colliders cover towers to their tops', () => {
    const cols = castleGrappleColliders();
    const towerCol = cols.find((c) => c.yTop >= CASTLE.padHeight + CASTLE.towerH - 0.5);
    expect(towerCol).toBeDefined();
  });

  it('wall grapple colliders use r = wallT * 1.5 and top out at padHeight + wallH', () => {
    const cols = castleGrappleColliders();
    const wallCol = cols.find((c) => Math.abs(c.r - CASTLE.wallT * 1.5) < 1e-6);
    expect(wallCol).toBeDefined();
    expect(wallCol!.yTop).toBeCloseTo(CASTLE.padHeight + CASTLE.wallH, 5);
  });
});

describe('inCastleRegion', () => {
  it('is true at the centre and false past regionR', () => {
    expect(inCastleRegion(CASTLE.center.x, CASTLE.center.z)).toBe(true);
    expect(inCastleRegion(CASTLE.center.x + CASTLE.regionR + 1, CASTLE.center.z)).toBe(false);
  });
});
