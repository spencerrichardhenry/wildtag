import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure cylinder pushout collision (XZ plane only). Trees and rocks are modelled
// as vertical cylinders; the player is a cylinder of `radius`. If the player's
// centre lies within (radius + obstacle.r) of an obstacle centre it is pushed
// radially outward to the rim. The terrain floor is handled separately by the
// movement core via GroundQuery, so `y` is passed straight through here.
//
// No `three` import, no randomness — plain { x, y, z } math.
// ---------------------------------------------------------------------------

/** A vertical collision cylinder: centre (x, z) and radius r (metres). */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Resolve XZ overlap of a `radius`-cylinder at `pos` against `obstacles`,
 * applied sequentially (each pushout feeds the next check). Pure: `pos` is not
 * mutated. A position sitting exactly on an obstacle centre is pushed along +X
 * as a deterministic fallback (the radial direction is otherwise undefined).
 */
export function resolveCollision(pos: Vec3, radius: number, obstacles: Obstacle[]): Vec3 {
  let x = pos.x;
  let z = pos.z;

  for (const ob of obstacles) {
    const dx = x - ob.x;
    const dz = z - ob.z;
    const minDist = radius + ob.r;
    const dist = Math.hypot(dx, dz);
    if (dist >= minDist) continue; // outside (or exactly on the rim) — no push

    if (dist < 1e-9) {
      // Exactly on the centre: radial direction undefined, push along +X.
      x = ob.x + minDist;
      z = ob.z;
    } else {
      const scale = minDist / dist;
      x = ob.x + dx * scale;
      z = ob.z + dz * scale;
    }
  }

  return { x, y: pos.y, z };
}
