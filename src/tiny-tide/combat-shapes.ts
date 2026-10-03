// World shapes of attacks (spec §5.10–§5.11): the aim frame, cones and capsules in attacker body lengths, hit tests against hurtboxes,
// crossing and obstruction, lunge truncation and telegraph descriptors. One `worldShape` serves the telegraph and the hit test. Pure.
import type { AttackShape, Capsule, Vec3, WorldQueries, WorldShape } from './combat-types';

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : fallback; };
export const vec = { sub, add, mul, dot, len, cross, unit };

/** z = aim; y = world up made orthogonal to z (the body forward when |aim.y| > .98); x = y × z. */
export interface AimFrame { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 }
export function aimFrame(origin: Vec3, aim: Vec3, bodyForward: Vec3): AimFrame {
  const z = unit(aim), ref = Math.abs(z.y) > .98 ? unit(bodyForward) : { x: 0, y: 1, z: 0 };
  let y = sub(ref, mul(z, dot(ref, z)));
  if (len(y) < 1e-9) y = sub({ x: 1, y: 0, z: 0 }, mul(z, z.x));
  y = unit(y);
  return { origin, x: cross(y, z), y, z };
}
/** The world shape of an attack shape in the frame; local numbers × L (the attacker's body length). */
export function worldShape(shape: AttackShape, f: AimFrame, L: number): WorldShape {
  if (shape.kind === 'cone') return { kind: 'cone', apex: f.origin, axis: f.z, range: shape.range * L, halfAngle: shape.halfAngle };
  const at = (p: Vec3) => add(f.origin, mul(add(add(mul(f.x, p.x), mul(f.y, p.y)), mul(f.z, p.z)), L));
  return { kind: 'capsule', start: at(shape.start), end: at(shape.end), radius: shape.radius * L };
}
/** The shapes of one action: one per emitter origin (a mirrored pair's union has two), the same aim. */
export const actionShapes = (shape: AttackShape, origins: readonly Vec3[], aim: Vec3, bodyForward: Vec3, L: number): WorldShape[] =>
  origins.map(o => worldShape(shape, aimFrame(o, aim, bodyForward), L));

/** How far a shape reaches forward of its origin along the aim, in L (contract V21, review R2): a cone's range; a capsule's far end + its
 *  radius (a lunge capsule is the full committed capsule). */
export const forwardReach = (shape: AttackShape): number => shape.kind === 'cone' ? shape.range : Math.max(shape.start.z, shape.end.z) + shape.radius;
/** The closest point to c on the segment ab. */
export function closestOnSegment(c: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a), l2 = dot(ab, ab);
  return l2 > 0 ? add(a, mul(ab, Math.max(0, Math.min(1, dot(sub(c, a), ab) / l2)))) : a;
}
/** The closest points p on a0a1 and q on b0b1. */
export function closestBetweenSegments(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { p: Vec3; q: Vec3 } {
  const d1 = sub(a1, a0), d2 = sub(b1, b0), r = sub(a0, b0), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return { p: a0, q: b0 };
  if (a <= 1e-12) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return { p: add(a0, mul(d1, s)), q: add(b0, mul(d2, t)) };
}
/** Sphere versus shape (spec §5.11). Cone: |c − apex| ≤ range + r and the angle to the axis ≤ halfAngle + asin(min(1, r / |c − apex|));
 *  a sphere that contains the apex is a hit. Capsule: the distance to the segment ≤ radius + r. */
export function sphereHitsShape(c: Vec3, r: number, s: WorldShape): boolean {
  if (s.kind === 'capsule') return len(sub(c, closestOnSegment(c, s.start, s.end))) <= s.radius + r;
  const d = sub(c, s.apex), dist = len(d);
  if (dist <= r) return true;
  if (dist > s.range + r) return false;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(d, s.axis) / dist)));
  return angle <= s.halfAngle + Math.asin(Math.min(1, r / dist));
}
/** A point inside a shape (tests and the telegraph subset rule). */
export const pointInShape = (p: Vec3, s: WorldShape): boolean => sphereHitsShape(p, 0, s);
/** A capsule hurtbox as spheres at most radius / 2 apart on its axis. */
export function hurtboxSpheres(h: Capsule): Vec3[] {
  const axis = sub(h.end, h.start), n = Math.max(1, Math.ceil(len(axis) / Math.max(1e-9, h.radius / 2)));
  return Array.from({ length: n + 1 }, (_, k) => add(h.start, mul(axis, k / n)));
}
const shapeAxis = (s: WorldShape): [Vec3, Vec3] => s.kind === 'cone' ? [s.apex, add(s.apex, mul(s.axis, s.range))] : [s.start, s.end];
/** The hit point of a hurtbox in a union of shapes, or null: the point of the hurtbox axis nearest the axis of the first shape it meets. */
export function hurtboxHit(h: Capsule, shapes: readonly WorldShape[]): Vec3 | null {
  for (const s of shapes) {
    if (!hurtboxSpheres(h).some(c => sphereHitsShape(c, h.radius, s))) continue;
    const [a, b] = shapeAxis(s);
    return closestBetweenSegments(h.start, h.end, a, b).p;
  }
  return null;
}
/** The first hurtbox hit and its point. */
export function hurtboxesHit(hurtboxes: readonly Capsule[], shapes: readonly WorldShape[]): Vec3 | null {
  for (const h of hurtboxes) { const p = hurtboxHit(h, shapes); if (p) return p; }
  return null;
}
/** A lunge's hit volume (spec §5.10): the committed capsule from its start, as far as the attacker has come. The capsule is `capsuleBodyLengths`
 *  long and the lunge `lungeBodyLengths`: the reach is the capsule's length minus the part of the lunge not yet moved. */
export function truncateCapsule(s: Extract<WorldShape, { kind: 'capsule' }>, capsuleBodyLengths: number, lungeBodyLengths: number, lungeDone: number): WorldShape {
  if (capsuleBodyLengths <= 0) return s;
  const f = Math.max(0, Math.min(1, (capsuleBodyLengths - lungeBodyLengths + lungeDone) / capsuleBodyLengths));
  return { kind: 'capsule', start: s.start, end: add(s.start, mul(sub(s.end, s.start), f)), radius: s.radius };
}
/** Crossing (spec §5.11). `water-surface` also allows water ↔ air when both points are within L of the surface. */
export function crossingOk(mode: 'same-medium' | 'water-surface' | 'any-medium', q: WorldQueries, origin: Vec3, point: Vec3, L: number): boolean {
  if (mode === 'any-medium') return true;
  const a = q.sampleEnvironment(origin).medium, b = q.sampleEnvironment(point).medium;
  if (a === b) return true;
  if (mode !== 'water-surface') return false;
  const s = q.terrain.surface, pair = (a === 'water' && b === 'air') || (a === 'air' && b === 'water');
  return pair && Math.abs(origin.y - s) <= L && Math.abs(point.y - s) <= L;
}
/** The terrain-only segment test: samples at most `step` apart; a sample under the ground blocks. */
export function terrainSegmentClear(q: WorldQueries, a: Vec3, b: Vec3, step: number): boolean {
  if (q.terrain.space) return true;
  const d = sub(b, a), n = Math.max(1, Math.ceil(len(d) / Math.max(1e-9, step)));
  for (let k = 0; k <= n; k++) { const p = add(a, mul(d, k / n)); if (p.y < q.terrain.groundAt(p.x, p.z)) return false; }
  return true;
}
/** Obstruction (`terrain-and-cover`): the segment from the shape origin to the hit point is clear, sampled at .25 L. */
export const obstructionClear = (q: WorldQueries, origin: Vec3, point: Vec3, L: number): boolean =>
  q.segmentClear ? q.segmentClear(origin, point, .25 * L) : terrainSegmentClear(q, origin, point, .25 * L);
/** The nearest targets first (by distance from the apex, then by actor id), at most `max`. */
export function nearestTargets<T extends { id: string; distance: number }>(candidates: readonly T[], max: number): T[] {
  return [...candidates].sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, max);
}
/** The shape's centroid for the depth ring: the middle of its axis. */
export function shapeCentroid(s: WorldShape): Vec3 { const [a, b] = shapeAxis(s); return mul(add(a, b), .5); }
/** The largest horizontal distance from the centroid to the shape (the depth ring's radius), from its axis ends and rim. */
export function horizontalExtent(s: WorldShape): number {
  const c = shapeCentroid(s), h = (p: Vec3) => Math.hypot(p.x - c.x, p.z - c.z);
  if (s.kind === 'capsule') return Math.max(h(s.start), h(s.end)) + s.radius;
  const f = aimFrame(s.apex, s.axis, { x: 0, y: 0, z: 1 }), half = Math.min(s.halfAngle, Math.PI / 2);
  let most = h(s.apex);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 2 * Math.PI, dir = add(mul(f.z, Math.cos(half)), mul(add(mul(f.x, Math.cos(a)), mul(f.y, Math.sin(a))), Math.sin(half)));
    most = Math.max(most, h(add(s.apex, mul(dir, s.range))));
  }
  return Math.max(most, h(add(s.apex, mul(s.axis, s.range))));
}
/** What the telegraph view draws (spec §9.1): the shapes the hit test uses, the fill, and the depth ring. */
export interface TelegraphDescriptor { shapes: WorldShape[]; fill: number; centroid: Vec3; ringRadius: number; groundY: number; color: 'amber' | 'red'; pattern: 'solid' | 'stripes'; locked: boolean }
export function telegraphDescriptor(shapes: WorldShape[], fill: number, color: 'amber' | 'red', pattern: 'solid' | 'stripes', locked: boolean, groundAt: (x: number, z: number) => number): TelegraphDescriptor {
  const first = shapes[0]!, centroid = shapeCentroid(first);
  return { shapes, fill: Math.max(0, Math.min(1, fill)), centroid, ringRadius: horizontalExtent(first), groundY: groundAt(centroid.x, centroid.z), color, pattern, locked };
}
