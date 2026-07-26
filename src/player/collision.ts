import { MOVE } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure cylinder pushout collision (XZ plane only). Trees, rocks, castle walls
// and village buildings are modelled as vertical cylinders; the player is a
// cylinder of `radius`. If the player's centre lies within (radius +
// obstacle.r) of an obstacle centre it is pushed radially outward — by up to
// `MOVE.maxPushoutPerStep` per call (deep penetration of a large obstacle,
// e.g. the castle keep, resolves gradually over several frames instead of
// snapping straight to the rim in one teleport-feeling pop; shallow
// penetration, the common case, reaches the rim in a single call exactly as
// before since it's already under that distance).
// The terrain floor is handled separately by the movement core via
// GroundQuery, so `y` is passed straight through here.
//
// Obstacles are cylinders of FINITE height when `yTop` is given (absolute
// world Y of the obstacle's top): a player whose feet sit strictly above
// `yTop` glides over it and is skipped entirely for that obstacle, so a
// gliding/falling player can pass down through the top of a castle wall or a
// giant tree canopy instead of being shoved sideways by an invisible column
// stretching to infinity. `yTop` left undefined preserves the original
// infinite-cylinder behaviour (always blocks, regardless of pos.y).
//
// Imports MOVE for the pushout clamp (the project's tuning-constants-live-in-
// constants.ts convention) but stays otherwise pure: no `three`, no
// randomness — plain { x, y, z } math.
// ---------------------------------------------------------------------------

/** A vertical collision cylinder: centre (x, z), radius r (metres), and an
 *  optional absolute-world-Y top (`yTop`). Undefined `yTop` means the cylinder
 *  extends infinitely in Y (the original behaviour); when set, a position with
 *  `pos.y` strictly greater than `yTop` is treated as above the obstacle and
 *  is not pushed out by it. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  yTop?: number;
}

/**
 * Resolve XZ overlap of a `radius`-cylinder at `pos` against `obstacles`,
 * applied sequentially (each pushout feeds the next check). Pure: `pos` is not
 * mutated. A position sitting exactly on an obstacle centre is pushed along +X
 * as a deterministic fallback (the radial direction is otherwise undefined).
 * Obstacles whose `pos.y` sits strictly above their `yTop` are skipped (the
 * player's feet are above the obstacle's top, so it can't push them). Each
 * obstacle's pushout is capped at `MOVE.maxPushoutPerStep`: the player moves
 * along the same outward radial line either the full penetration depth or
 * the cap, whichever is smaller — so it always moves monotonically toward
 * the rim (never past it, never sideways off that line) and can only need
 * more than one call to fully resolve when penetrating a large obstacle deeply.
 */
export function resolveCollision(pos: Vec3, radius: number, obstacles: Obstacle[]): Vec3 {
  let x = pos.x;
  let z = pos.z;

  for (const ob of obstacles) {
    if (ob.yTop !== undefined && pos.y > ob.yTop) continue; // above the top — glide over
    const dx = x - ob.x;
    const dz = z - ob.z;
    const minDist = radius + ob.r;
    const dist = Math.hypot(dx, dz);
    if (dist >= minDist) continue; // outside (or exactly on the rim) — no push

    // Outward unit normal from the obstacle centre through the player
    // (deterministic +X fallback when sitting exactly on the centre).
    const nx = dist < 1e-9 ? 1 : dx / dist;
    const nz = dist < 1e-9 ? 0 : dz / dist;
    const penetration = minDist - dist;
    const step = Math.min(penetration, MOVE.maxPushoutPerStep);
    x += nx * step;
    z += nz * step;
  }

  return { x, y: pos.y, z };
}
