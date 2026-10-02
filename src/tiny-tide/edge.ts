// The soft world edge (owner playtest P2). Near the hard bound a current pushes the creature back to the centre, so
// the admission bound is a safety net that normal play does not reach. The push zone is measured per axis (the square
// of the hard bound): each horizontal axis past EDGE_SOFT_START × half gets its own inward part, and in a corner both
// parts act. The current is a pure function of the position; the player step adds it to the displacement and stores
// it nowhere, so it is not a velocity owner: when the input is released, the creature drifts back inward.
import type { MutVec3, Vec3 } from './combat-types';

/** The push zone starts at this fraction of the hard bound's half size, on each horizontal axis. */
export const EDGE_SOFT_START = .8;
/** The current at the hard bound, in stage-local units/s (× size for physical). The fastest reachable top speed is
 *  8 (Cosmic) × 1.65 (speed factor cap) × 1.15 (Darter) ≈ 15.2, so every creature settles where the smoothstep is ≤ .51,
 *  about 4.9 local units (1.5 grown body lengths) inside the bound. */
export const EDGE_CURRENT_MAX = 30;
/** Food and creatures roam inside this fraction of the hard bound (Chebyshev, centres), and food past it is not
 *  approachable. Every creature can bite there: the slowest possible top speed (5.8 × .7 × .8 ≈ 3.2 local/s) settles at
 *  about 42.0 local units, and the smallest bite radius (1.7 + .5) reaches 44.2 ≥ .88 × 50 = 44. */
export const EDGE_REACH = .88;
/** The toast for the edge (push zone and hard bound). */
export const EDGE_HINT = "That's the edge of the world for now.";

const smooth = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
/** 0 inside the soft start, rising smoothly to 1 at the hard bound (and past it), for one coordinate. */
export function edgeDepth(c: number, half: number): number {
  const s = EDGE_SOFT_START * half;
  return smooth((Math.abs(c) - s) / (half - s));
}
/** The inward horizontal current (physical units/s) at a position, for a hard bound of `half` physical units. */
export function edgeCurrent(pos: Vec3, half: number, size: number, out: MutVec3 = { x: 0, y: 0, z: 0 }): MutVec3 {
  const m = EDGE_CURRENT_MAX * size;
  out.x = -Math.sign(pos.x) * m * edgeDepth(pos.x, half) || 0;
  out.y = 0;
  out.z = -Math.sign(pos.z) * m * edgeDepth(pos.z, half) || 0;
  return out;
}
/** True when the position is in the push zone on some horizontal axis. */
export const inEdgeZone = (pos: Vec3, half: number) => Math.max(Math.abs(pos.x), Math.abs(pos.z)) > EDGE_SOFT_START * half;
