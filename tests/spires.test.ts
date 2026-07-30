import { describe, expect, it } from 'vitest';
import { CASTLE, ELF, SPIRES } from '../src/core/constants.ts';
import { spireObstacles, spireGrappleColliders } from '../src/castle/layout.ts';
import { cellToWorld, wardLayout } from '../src/castle/ward.ts';
import { WARD_MAP } from '../src/castle/wardMap.ts';
import { elfHomePosition } from '../src/castle/elves.ts';

// ---------------------------------------------------------------------------
// Gargoyle-hunting spires (daze-eject-spires design spec §2). `SPIRES.list`'s
// 5 authored {dx, dz, h} entries are hand-picked cells off `wardMap.ts` (see
// the doc comment on `SPIRES` in constants.ts for the exact row/col of each);
// these tests cross-check that authoring against the real ward grid + elf
// homes, so a future edit to WARD_MAP or CASTLE.center that silently moves a
// spire onto a wall or into an elf's lap fails loudly here instead of only
// showing up as a visual glitch.
// ---------------------------------------------------------------------------

/** The documented (row, col) ward-map cell for each of the 5 authored spires,
 *  in the same order as `SPIRES.list` — see constants.ts's SPIRES doc comment. */
const SPIRE_CELLS: readonly [row: number, col: number][] = [
  [4, 4], // 1. NW plaza corner
  [27, 15], // 2. S-center plaza corner
  [31, 31], // 3. SE plaza corner
  [1, 33], // 4. NE alcove
  [33, 1], // 5. SW alcove
];

describe('SPIRES authoring', () => {
  it('has exactly 5 entries, each on the documented open (non-wall) ward cell', () => {
    expect(SPIRES.list).toHaveLength(5);
    SPIRES.list.forEach((s, i) => {
      const [row, col] = SPIRE_CELLS[i]!;
      const sym = WARD_MAP[row]![col];
      expect(sym).not.toBe('#');

      const w = cellToWorld(col, row);
      const x = CASTLE.center.x + s.dx;
      const z = CASTLE.center.z + s.dz;
      expect(x).toBeCloseTo(w.x, 6);
      expect(z).toBeCloseTo(w.z, 6);
    });
  });

  it('every spire is taller than both existing gargoyle-perch heights (towers, keep), within [22, 26]', () => {
    for (const s of SPIRES.list) {
      expect(s.h).toBeGreaterThan(CASTLE.towerH);
      expect(s.h).toBeGreaterThan(CASTLE.keepH);
      expect(s.h).toBeGreaterThanOrEqual(22);
      expect(s.h).toBeLessThanOrEqual(26);
    }
  });

  it('the 3 plaza-corner spires (indices 0-2) sit clear of every elf home by at least obstacleR + ELF.bodyR (the real no-overlap distance, ~4m actual)', () => {
    // Review round (daze-eject-spires): elves are now pushed out of
    // `spireObstacles()` too (elves.ts's resolveCollision), so the bound that
    // actually matters is the sum of the two bodies' radii, not an arbitrary
    // 1m — a home any closer than this would sit INSIDE the spire's obstacle
    // circle and the elf would never be able to stand at its own home.
    const minClearance = SPIRES.obstacleR + ELF.bodyR; // 1.6 + 0.5 = 2.1
    const plazaSpires = SPIRES.list.slice(0, 3);
    for (const s of plazaSpires) {
      const x = CASTLE.center.x + s.dx;
      const z = CASTLE.center.z + s.dz;
      for (let i = 0; i < ELF.maxCount; i++) {
        const home = elfHomePosition(i);
        const d = Math.hypot(x - home.x, z - home.z);
        expect(d).toBeGreaterThanOrEqual(minClearance);
      }
    }
  });

  it('the 3 plaza-corner spires sit inside their respective plaza footprint', () => {
    const plazas = wardLayout().plazas;
    const half = 12.6; // plaza is a 5-cell block, cellSize 5 -> half-extent 12.5 + slack
    for (let i = 0; i < 3; i++) {
      const s = SPIRES.list[i]!;
      const x = CASTLE.center.x + s.dx;
      const z = CASTLE.center.z + s.dz;
      const plaza = plazas[i]!;
      expect(Math.abs(x - plaza.center.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(z - plaza.center.z)).toBeLessThanOrEqual(half);
    }
  });
});

describe('spireObstacles', () => {
  it('is memoised and has 5 circles of r = SPIRES.obstacleR', () => {
    const a = spireObstacles();
    const b = spireObstacles();
    expect(a).toBe(b);
    expect(a).toHaveLength(5);
    for (const o of a) {
      expect(o.r).toBe(SPIRES.obstacleR);
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.z)).toBe(true);
    }
  });

  it('each obstacle tops out at padHeight + that spire\'s own height', () => {
    const obs = spireObstacles();
    obs.forEach((o, i) => {
      expect(o.yTop).toBeCloseTo(CASTLE.padHeight + SPIRES.list[i]!.h, 6);
    });
  });
});

describe('spireGrappleColliders', () => {
  it('is memoised and has 5 cylinders of r = SPIRES.grappleR spanning the full spire height', () => {
    const a = spireGrappleColliders();
    const b = spireGrappleColliders();
    expect(a).toBe(b);
    expect(a).toHaveLength(5);
    a.forEach((c, i) => {
      expect(c.r).toBe(SPIRES.grappleR);
      expect(c.yBase).toBeCloseTo(CASTLE.padHeight, 6);
      expect(c.yTop).toBeCloseTo(CASTLE.padHeight + SPIRES.list[i]!.h, 6);
      // Every spire's grapple top clears both existing gargoyle-perch heights.
      expect(c.yTop).toBeGreaterThan(CASTLE.padHeight + CASTLE.towerH);
      expect(c.yTop).toBeGreaterThan(CASTLE.padHeight + CASTLE.keepH);
    });
  });
});
