// Soft body separation between the player and a combat species (T17 fix round 1, controller ruling): two hulls that overlap are pushed
// apart along the line between their hull centres (horizontal for a ground species). The push is shared by mass (a species' share is
// cut by its knockback resistance, so a big alpha barely moves), removes the overlap within about .1 s, and ignores an
// overlap up to the slop, so bodies at rest in contact do not jitter. Pure: the caller moves both bodies through their motion paths.
import type { Capsule, MutVec3, Vec3 } from './combat-types';

/** The overlap past the slop is removed at this rate: a fraction min(1, dt / SEPARATION_SECONDS) of it per tick (about 99 % in .1 s). */
export const SEPARATION_SECONDS = .025;
/** Overlap below this share of the player's body length is left alone (no jitter at rest). */
export const SEPARATION_SLOP = .02;

const sub = (a: Vec3, b: Vec3): MutVec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The closest points of the segments p0p1 and q0q1. */
export function closestBetweenSegments(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): { p: Vec3; q: Vec3 } {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return { p: { x: p0.x + d1.x * s, y: p0.y + d1.y * s, z: p0.z + d1.z * s }, q: { x: q0.x + d2.x * t, y: q0.y + d2.y * t, z: q0.z + d2.z * t } };
}
/** The deepest overlap between two hulls (the sum of radii minus the axis distance; ≤ 0: no overlap) and its contact normal (from b to a;
 *  null where the axes meet). */
export function deepestOverlap(a: readonly Capsule[], b: readonly Capsule[]): { depth: number; normal: Vec3 | null } {
  let depth = -Infinity, normal: Vec3 | null = null;
  for (const ca of a) for (const cb of b) {
    const { p, q } = closestBetweenSegments(ca.start, ca.end, cb.start, cb.end), d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), o = ca.radius + cb.radius - d;
    if (o > depth) { depth = o; normal = d > 1e-9 ? { x: (p.x - q.x) / d, y: (p.y - q.y) / d, z: (p.z - q.z) / d } : null; }
  }
  return { depth, normal };
}
export const hullOverlap = (a: readonly Capsule[], b: readonly Capsule[]): number => deepestOverlap(a, b).depth;
const centreOf = (h: readonly Capsule[]): Vec3 => {
  let x = 0, y = 0, z = 0;
  for (const c of h) { x += c.start.x + c.end.x; y += c.start.y + c.end.y; z += c.start.z + c.end.z; }
  const n = 2 * Math.max(1, h.length); return { x: x / n, y: y / n, z: z / n };
};
export interface SeparationInput {
  player: readonly Capsule[]; species: readonly Capsule[];
  playerMass: number; speciesMass: number; speciesResistance: number;
  /** A ground species pushes sideways only (the line between the centres, horizontal). */
  horizontal: boolean;
  /** Where to push the player when the centres coincide (the species' front: its attacks reach there). */
  speciesForward: Vec3;
  playerL: number; dt: number;
}
/** This tick's push for each body (displacements, physical units), or null when the overlap is within the slop. */
export function separationPush(i: SeparationInput): { player: Vec3; species: Vec3 } | null {
  const o = deepestOverlap(i.player, i.species), depth = o.depth - SEPARATION_SLOP * i.playerL;
  if (!(depth > 0)) return null;
  const pc = centreOf(i.player), sc = centreOf(i.species), n = sub(pc, sc);
  if (i.horizontal) n.y = 0;
  let len = Math.hypot(n.x, n.y, n.z);
  if (len < 1e-6) { n.x = i.speciesForward.x; n.y = i.horizontal ? 0 : i.speciesForward.y; n.z = i.speciesForward.z; len = Math.hypot(n.x, n.y, n.z) || 1; }
  // The distance along n that clears the overlap down to the slop (bisection: the overlap falls along a push away from the species centre);
  // a fraction of it is removed this tick.
  const ux = n.x / len, uy = n.y / len, uz = n.z / len, slop = SEPARATION_SLOP * i.playerL;
  const shifted = (t: number) => i.player.map(c => ({ radius: c.radius, start: { x: c.start.x + ux * t, y: c.start.y + uy * t, z: c.start.z + uz * t }, end: { x: c.end.x + ux * t, y: c.end.y + uy * t, z: c.end.z + uz * t } }));
  let lo = 0, hi = Math.max(o.depth, 1e-6);
  for (let k = 0; k < 8 && deepestOverlap(shifted(hi), i.species).depth > slop; k++) hi *= 2;
  for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (deepestOverlap(shifted(mid), i.species).depth > slop) lo = mid; else hi = mid; }
  const amount = hi * Math.min(1, i.dt / SEPARATION_SECONDS);
  const speciesShare = i.playerMass / Math.max(1e-9, i.playerMass + i.speciesMass) * (1 - Math.max(0, Math.min(1, i.speciesResistance))), playerShare = 1 - speciesShare;
  return { player: { x: ux * amount * playerShare, y: uy * amount * playerShare, z: uz * amount * playerShare }, species: { x: -ux * amount * speciesShare, y: -uy * amount * speciesShare, z: -uz * amount * speciesShare } };
}
