import { describe, expect, it } from 'vitest';
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
