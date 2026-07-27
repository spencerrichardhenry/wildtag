import { describe, expect, it } from 'vitest';
import { CASTLE, TERRAIN, VILLAGE } from '../src/core/constants.ts';
import {
  castleLayout,
  castleObstacles,
  castleGrappleColliders,
  inCastleRegion,
} from '../src/castle/layout.ts';
import { villageCenter } from '../src/village/layout.ts';

/**
 * Project `circles` onto wall segment `w`'s line, keeping only those that
 * (a) lie on the line (perpendicular offset ~0) and (b) have radius `rTarget`
 * (distinguishes wall circles from tower/keep circles that also sit near a
 * wall's corners). Returns arc-length offsets (0 = w's first endpoint),
 * sorted ascending.
 */
function wallLineOffsets(
  w: { x1: number; z1: number; x2: number; z2: number },
  circles: { x: number; z: number; r: number }[],
  rTarget: number,
): number[] {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const out: number[] = [];
  for (const c of circles) {
    if (Math.abs(c.r - rTarget) > 1e-6) continue;
    const relx = c.x - w.x1;
    const relz = c.z - w.z1;
    const s = relx * ux + relz * uz;
    const perp = Math.abs(relx * uz - relz * ux);
    if (perp < 0.25 && s > -1e-6 && s < len + 1e-6) out.push(s);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** The wall whose midpoint matches the gate (i.e. the gated wall). */
function findGateWall(l: ReturnType<typeof castleLayout>) {
  return l.walls.find(
    (w) => Math.hypot((w.x1 + w.x2) / 2 - l.gate.x, (w.z1 + w.z2) / 2 - l.gate.z) < 1e-6,
  )!;
}

/** The keep wall whose midpoint matches its entrance (i.e. the entrance wall). */
function findKeepEntranceWall(l: ReturnType<typeof castleLayout>) {
  return l.keepWalls.find(
    (w) => Math.hypot((w.x1 + w.x2) / 2 - l.keep.entrance.x, (w.z1 + w.z2) / 2 - l.keep.entrance.z) < 1e-6,
  )!;
}

describe('castleLayout', () => {
  it('is deterministic with 4 towers, 4 walls, gate in a wall', () => {
    const a = castleLayout();
    const b = castleLayout();
    expect(a).toBe(b); // memoised
    expect(a.towers).toHaveLength(4);
    expect(a.walls).toHaveLength(4);
    expect(a.keepWalls).toHaveLength(4);
    expect(a.keep.h).toBe(CASTLE.keepH);
    expect(a.crystalPos.y).toBeCloseTo(CASTLE.padHeight + 1.2);
  });

  it('keep entrance sits on the same compass side as the main gate, on a keep wall', () => {
    const l = castleLayout();
    // The entrance's arc-length position on its wall must actually lie ON
    // that wall (both endpoints share an axis with keepHalf).
    const dxHalf = Math.abs(Math.abs(l.keep.entrance.x - CASTLE.center.x) - CASTLE.keepHalf);
    const dzHalf = Math.abs(Math.abs(l.keep.entrance.z - CASTLE.center.z) - CASTLE.keepHalf);
    expect(Math.min(dxHalf, dzHalf)).toBeLessThan(1e-6);
    expect(l.keep.entrance.w).toBe(CASTLE.keepEntranceW);
    expect(l.keep.entrance.h).toBe(CASTLE.keepEntranceH);

    // Same side as the gate: whichever axis is pinned (x or z), the entrance
    // and the gate pin the SAME axis to the SAME sign.
    const gateOnX = Math.abs(Math.abs(l.gate.x - CASTLE.center.x) - CASTLE.half) < 1e-6;
    const entranceOnX = Math.abs(Math.abs(l.keep.entrance.x - CASTLE.center.x) - CASTLE.keepHalf) < 1e-6;
    expect(entranceOnX).toBe(gateOnX);
    if (gateOnX) {
      expect(Math.sign(l.keep.entrance.x - CASTLE.center.x)).toBe(Math.sign(l.gate.x - CASTLE.center.x));
    } else {
      expect(Math.sign(l.keep.entrance.z - CASTLE.center.z)).toBe(Math.sign(l.gate.z - CASTLE.center.z));
    }
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

  it('gives every obstacle a finite yTop so a glider can pass over it', () => {
    const obs = castleObstacles();
    // Towers top out at padHeight + towerH.
    const towerObs = obs.filter((o) => Math.abs(o.r - CASTLE.towerR) < 1e-6);
    expect(towerObs.length).toBeGreaterThan(0);
    for (const o of towerObs) {
      expect(o.yTop).toBeCloseTo(CASTLE.padHeight + CASTLE.towerH, 5);
    }
    // Keep wall circles (radius CASTLE.keepWallT — a perimeter ring, NOT one
    // solid disc over the footprint) top out at padHeight + keepH.
    const l = castleLayout();
    const keepWallObs = obs.filter((o) => Math.abs(o.r - CASTLE.keepWallT) < 1e-6);
    expect(keepWallObs.length).toBeGreaterThan(0);
    for (const o of keepWallObs) {
      expect(o.yTop).toBeCloseTo(CASTLE.padHeight + CASTLE.keepH, 5);
    }
    // Wall circles (radius CASTLE.wallT) top out at padHeight + wallH.
    const wallObs = obs.filter((o) => Math.abs(o.r - CASTLE.wallT) < 1e-6);
    expect(wallObs.length).toBeGreaterThan(0);
    for (const o of wallObs) {
      expect(o.yTop).toBeCloseTo(CASTLE.padHeight + CASTLE.wallH, 5);
    }
  });

  it('the keep is a hollow perimeter ring — no solid disc obstacle near its centre, crystalPos is clear', () => {
    const l = castleLayout();
    const obs = castleObstacles();
    // Task 14 review: a single fat disc (r ~= keepHalf*sqrt(2) ~= 14.14) used
    // to cover the whole keep footprint — that made the interior (and the
    // crystal inside it) physically unreachable. It must be gone now.
    const oldSolidDiscR = l.keep.half * Math.SQRT2;
    const solidDisc = obs.find((o) => Math.abs(o.r - oldSolidDiscR) < 1e-6);
    expect(solidDisc).toBeUndefined();

    // No obstacle at all sits close enough to swallow the exact keep centre.
    for (const o of obs) {
      const d = Math.hypot(o.x - l.keep.x, o.z - l.keep.z);
      expect(d).toBeGreaterThan(o.r);
    }

    // The crystal's own position (keep centre) is inside no obstacle circle.
    const cp = l.crystalPos;
    for (const o of obs) {
      const d = Math.hypot(o.x - cp.x, o.z - cp.z);
      expect(d).toBeGreaterThan(o.r);
    }
  });

  it('solidly covers the 3 non-entrance keep walls (no gap wider than 2*keepWallT anywhere)', () => {
    const l = castleLayout();
    const obs = castleObstacles();
    const entranceWall = findKeepEntranceWall(l);
    const nonEntranceWalls = l.keepWalls.filter((w) => w !== entranceWall);
    expect(nonEntranceWalls).toHaveLength(3);

    for (const w of nonEntranceWalls) {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
      const offsets = wallLineOffsets(w, obs, CASTLE.keepWallT);
      expect(offsets.length).toBeGreaterThan(1);
      expect(offsets[0]).toBeLessThanOrEqual(CASTLE.keepWallT + 1e-6);
      expect(offsets[offsets.length - 1]).toBeGreaterThanOrEqual(len - CASTLE.keepWallT - 1e-6);
      for (let i = 1; i < offsets.length; i++) {
        expect(offsets[i] - offsets[i - 1]).toBeLessThanOrEqual(2 * CASTLE.keepWallT + 1e-6);
      }
    }
  });

  it('leaves the keep entrance span genuinely clear (a player can walk in)', () => {
    const l = castleLayout();
    const obs = castleObstacles();
    const entranceWall = findKeepEntranceWall(l);
    const len = Math.hypot(entranceWall.x2 - entranceWall.x1, entranceWall.z2 - entranceWall.z1);
    const entranceHalf = CASTLE.keepEntranceW / 2;
    const offsets = wallLineOffsets(entranceWall, obs, CASTLE.keepWallT);

    // No keep-wall circle centre lands within the entrance span...
    for (const s of offsets) {
      expect(Math.abs(s - len / 2)).toBeGreaterThanOrEqual(entranceHalf - 1e-6);
    }
    // ...but both flanks are still populated.
    expect(offsets.some((s) => s < len / 2 - entranceHalf)).toBe(true);
    expect(offsets.some((s) => s > len / 2 + entranceHalf)).toBe(true);
  });

  it('solidly covers the 3 non-gate walls (no gap wider than 2*wallT anywhere)', () => {
    const l = castleLayout();
    const obs = castleObstacles();
    const gateWall = findGateWall(l);
    const nonGateWalls = l.walls.filter((w) => w !== gateWall);
    expect(nonGateWalls).toHaveLength(3);

    for (const w of nonGateWalls) {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
      const offsets = wallLineOffsets(w, obs, CASTLE.wallT);
      expect(offsets.length).toBeGreaterThan(1);
      // Flush with both corners...
      expect(offsets[0]).toBeLessThanOrEqual(CASTLE.wallT + 1e-6);
      expect(offsets[offsets.length - 1]).toBeGreaterThanOrEqual(len - CASTLE.wallT - 1e-6);
      // ...and no gap between neighbours wide enough to slip a wallT-radius
      // cylinder through: this is what makes the wall an actual obstacle.
      for (let i = 1; i < offsets.length; i++) {
        expect(offsets[i] - offsets[i - 1]).toBeLessThanOrEqual(2 * CASTLE.wallT + 1e-6);
      }
    }
  });

  it('leaves the gate wall genuinely clear at the gate span (mechanism actually fires)', () => {
    const l = castleLayout();
    const obs = castleObstacles();
    const gateWall = findGateWall(l);
    const len = Math.hypot(gateWall.x2 - gateWall.x1, gateWall.z2 - gateWall.z1);
    const gateHalf = CASTLE.gateW / 2;
    const offsets = wallLineOffsets(gateWall, obs, CASTLE.wallT);

    // No wall circle centre lands within the gate span...
    for (const s of offsets) {
      expect(Math.abs(s - len / 2)).toBeGreaterThanOrEqual(gateHalf - 1e-6);
    }
    // ...but both flanks are still populated (the exclusion isn't just
    // "no circles on this wall at all").
    expect(offsets.some((s) => s < len / 2 - gateHalf)).toBe(true);
    expect(offsets.some((s) => s > len / 2 + gateHalf)).toBe(true);
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

  it('keep wall grapple colliders use r = keepWallT * 1.5 and climb to padHeight + keepH (climb straight over into the room)', () => {
    const cols = castleGrappleColliders();
    const keepCol = cols.find((c) => Math.abs(c.r - CASTLE.keepWallT * 1.5) < 1e-6);
    expect(keepCol).toBeDefined();
    expect(keepCol!.yTop).toBeCloseTo(CASTLE.padHeight + CASTLE.keepH, 5);
  });
});

describe('inCastleRegion', () => {
  it('is true at the centre and false past regionR', () => {
    expect(inCastleRegion(CASTLE.center.x, CASTLE.center.z)).toBe(true);
    expect(inCastleRegion(CASTLE.center.x + CASTLE.regionR + 1, CASTLE.center.z)).toBe(false);
  });
});

describe('castle site clearance (Castle Ward Task 2 resize sanity)', () => {
  // The flattened pad's outer edge (where heightAt fully relaxes back to raw
  // terrain) sits padRadius + padBlend from the castle centre — now 135 + 45
  // = 180 m, up from the pre-resize 80 + 45 = 125 m. Two circular regions
  // (the pad disc around the castle, and a village/meadow disc elsewhere)
  // can't overlap as long as the centre-to-centre distance exceeds the sum
  // of their radii. The castle site was picked far enough out (Task 8) that
  // this still holds comfortably after the resize.
  const padOuter = CASTLE.padRadius + CASTLE.padBlend; // 180

  it('does not reach the spawn meadow at the origin', () => {
    const d = Math.hypot(CASTLE.center.x, CASTLE.center.z); // ~460 m
    expect(d).toBeGreaterThan(padOuter + TERRAIN.meadowRadius); // 180 + 200 = 380
  });

  it('does not reach Haven village', () => {
    const v = villageCenter();
    const d = Math.hypot(CASTLE.center.x - v.x, CASTLE.center.z - v.z); // ~484 m
    expect(d).toBeGreaterThan(padOuter + VILLAGE.radius); // 180 + 55 = 235
  });
});
