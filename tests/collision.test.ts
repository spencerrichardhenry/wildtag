import { describe, expect, it } from 'vitest';
import { MOVE } from '../src/core/constants.ts';
import type { Vec3 } from '../src/core/types.ts';
import { resolveCollision, type Obstacle } from '../src/player/collision.ts';

// Cylinder pushout works purely in the XZ plane; y is carried through untouched.

describe('resolveCollision', () => {
  it('leaves a position outside every obstacle unchanged', () => {
    const pos: Vec3 = { x: 10, y: 5, z: 0 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1 }];
    const out = resolveCollision(pos, 0.4, obstacles);
    expect(out).toEqual({ x: 10, y: 5, z: 0 });
  });

  it('leaves the input untouched exactly on the combined-radius boundary', () => {
    // Player radius 0.4 + obstacle 1 = 1.4; sitting exactly on the rim is "outside".
    const pos: Vec3 = { x: 1.4, y: 0, z: 0 };
    const out = resolveCollision(pos, 0.4, [{ x: 0, z: 0, r: 1 }]);
    expect(out.x).toBeCloseTo(1.4, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it('pushes a position inside an obstacle out to the rim along the radial', () => {
    // Player at (0.5, 0.5) from obstacle centre; combined radius 1.4.
    const pos: Vec3 = { x: 0.5, y: 3, z: 0.5 };
    const out = resolveCollision(pos, 0.4, [{ x: 0, z: 0, r: 1 }]);
    const dist = Math.hypot(out.x, out.z);
    expect(dist).toBeCloseTo(1.4, 10);
    // Pushed along the same radial direction (45°), y preserved.
    expect(out.x).toBeCloseTo(out.z, 10);
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBe(3);
  });

  it('pushes deterministically along +X when exactly on the obstacle centre', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const out = resolveCollision(pos, 0.4, [{ x: 0, z: 0, r: 1 }]);
    expect(out.x).toBeCloseTo(1.4, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it('resolves multiple obstacles sequentially', () => {
    // First obstacle at origin pushes the player to +X rim (1.4, 0); that lands
    // inside the second obstacle at (2, 0, r=1), which then pushes further out.
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const obstacles: Obstacle[] = [
      { x: 0, z: 0, r: 1 },
      { x: 2, z: 0, r: 1 },
    ];
    const out = resolveCollision(pos, 0.4, obstacles);
    // After the first pushout to (1.4, 0), distance to (2,0) is 0.6 < 1.4,
    // so the second pushes it back along −X to the rim at 2 - 1.4 = 0.6.
    expect(out.x).toBeCloseTo(0.6, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it('does not mutate the input position', () => {
    const pos: Vec3 = { x: 0.5, y: 0, z: 0.5 };
    resolveCollision(pos, 0.4, [{ x: 0, z: 0, r: 1 }]);
    expect(pos).toEqual({ x: 0.5, y: 0, z: 0.5 });
  });

  it('returns the position unchanged with no obstacles', () => {
    const pos: Vec3 = { x: 3, y: 1, z: -2 };
    expect(resolveCollision(pos, 0.4, [])).toEqual({ x: 3, y: 1, z: -2 });
  });
});

// Vertical extent: `yTop` gives an obstacle a finite height so a player
// gliding above it passes over instead of being blocked by an infinite column.
describe('resolveCollision vertical extent (yTop)', () => {
  it('skips pushout when the player is strictly above the obstacle top', () => {
    // Deep inside the XZ footprint, but feet well above yTop.
    const pos: Vec3 = { x: 0.5, y: 6, z: 0.5 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1, yTop: 5 }];
    expect(resolveCollision(pos, 0.4, obstacles)).toEqual({ x: 0.5, y: 6, z: 0.5 });
  });

  it('still pushes out when the player is below the obstacle top', () => {
    const pos: Vec3 = { x: 0.5, y: 2, z: 0.5 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1, yTop: 5 }];
    const out = resolveCollision(pos, 0.4, obstacles);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.4, 10);
  });

  it('always pushes when yTop is undefined, regardless of how high pos.y is', () => {
    const pos: Vec3 = { x: 0.5, y: 1000, z: 0.5 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1 }];
    const out = resolveCollision(pos, 0.4, obstacles);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.4, 10);
  });

  it('still pushes exactly on the yTop boundary (only strictly above skips)', () => {
    const pos: Vec3 = { x: 0.5, y: 5, z: 0.5 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1, yTop: 5 }];
    const out = resolveCollision(pos, 0.4, obstacles);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.4, 10);
  });
});

// Pushout clamping: a single call never moves the player more than
// MOVE.maxPushoutPerStep out of any one obstacle, so deeply penetrating a
// large-radius obstacle (e.g. the castle keep, r ≈ 14.14) resolves gradually
// over several frames instead of snapping straight to the rim in one pop.
describe('resolveCollision pushout clamping', () => {
  it('shallow penetration (within the clamp) still resolves fully to the rim in one call', () => {
    // Combined radius 1.4 < MOVE.maxPushoutPerStep (1.5) — same as the
    // unclamped behaviour tested above, just asserted against the constant.
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 1 }];
    const out = resolveCollision(pos, 0.4, obstacles);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.4, 10);
    expect(1.4).toBeLessThan(MOVE.maxPushoutPerStep);
  });

  it('deep penetration of a large obstacle (keep-sized) is capped at maxPushoutPerStep per call', () => {
    // Keep-sized obstacle: r ~= 14.14 (keepHalf * sqrt(2), see castle/layout.ts).
    const keep: Obstacle = { x: 0, z: 0, r: 14.14 };
    const pos: Vec3 = { x: 0, y: 0, z: 0 }; // dead centre: full penetration = minDist
    const out = resolveCollision(pos, 0.4, [keep]);
    const moved = Math.hypot(out.x - pos.x, out.z - pos.z);
    expect(moved).toBeCloseTo(MOVE.maxPushoutPerStep, 10);
    // Still well inside the obstacle — resolving fully takes further calls.
    const distFromCentre = Math.hypot(out.x, out.z);
    expect(distFromCentre).toBeLessThan(0.4 + keep.r);
  });

  it('resolves a deep-penetration keep-sized obstacle monotonically over repeated calls, never overshooting the rim', () => {
    const keep: Obstacle = { x: 5, z: -3, r: 14.14 };
    const minDist = 0.4 + keep.r;
    let pos: Vec3 = { x: keep.x, y: 0, z: keep.z }; // start dead centre
    let prevDist = 0;
    // Stop once within float noise of the rim rather than requiring strict
    // "<" (once fully resolved, a further call is a no-op re-push at the same
    // distance, not a regression — the property under test is "never regress
    // and never overshoot", not "every single call must strictly progress").
    for (let i = 0; i < 20 && minDist - Math.hypot(pos.x - keep.x, pos.z - keep.z) > 1e-9; i++) {
      const out = resolveCollision(pos, 0.4, [keep]);
      const dist = Math.hypot(out.x - keep.x, out.z - keep.z);
      expect(dist).toBeGreaterThanOrEqual(prevDist - 1e-9); // never regresses
      expect(dist).toBeLessThanOrEqual(minDist + 1e-9); // never overshoots past the rim
      expect(dist - prevDist).toBeLessThanOrEqual(MOVE.maxPushoutPerStep + 1e-9); // clamped per call
      prevDist = dist;
      pos = out;
    }
    // Fully resolved onto the rim within a bounded number of steps.
    expect(Math.hypot(pos.x - keep.x, pos.z - keep.z)).toBeCloseTo(minDist, 6);
  });
});
