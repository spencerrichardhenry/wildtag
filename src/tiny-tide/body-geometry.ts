// Pure body maths for a genome: spine layout, surface points and part frames.
import * as T from 'three';
import type { Genome } from './genome';

const FORWARD = new T.Vector3(0, 0, 1), UP = new T.Vector3(0, 1, 0);

export const SPACING = .55;
/** Parts are authored for a body radius of 1. */
export const PART_SCALE = .62;

export interface Layout { z: number[]; front: number; rear: number }
export function layout(g: Genome): Layout {
  const n = g.spine.length, z = g.spine.map((_, i) => ((n - 1) / 2 - i) * SPACING);
  return { z, front: z[0]! + Math.max(.12, g.spine[0]!.radius * .95), rear: z[n - 1]! - Math.max(.12, g.spine[n - 1]!.radius * .95) };
}
const catmull = (a: number, b: number, c: number, d: number, f: number) => .5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
/** Cross-section half-width, half-height and lift at a body z. */
export function profile(g: Genome, l: Layout, z: number) {
  const s = g.spine, n = s.length;
  if (z >= l.z[0]!) { const k = Math.sqrt(Math.max(0, 1 - ((z - l.z[0]!) / (l.front - l.z[0]!)) ** 2)); return { r: s[0]!.radius * k, h: s[0]!.height * k, lift: s[0]!.lift }; }
  if (z <= l.z[n - 1]!) { const k = Math.sqrt(Math.max(0, 1 - ((l.z[n - 1]! - z) / (l.z[n - 1]! - l.rear)) ** 2)); return { r: s[n - 1]!.radius * k, h: s[n - 1]!.height * k, lift: s[n - 1]!.lift }; }
  const i = Math.min(n - 2, Math.floor((l.z[0]! - z) / SPACING)), f = (l.z[i]! - z) / SPACING;
  const at = (j: number) => s[Math.max(0, Math.min(n - 1, j))]!;
  const v = (key: 'radius' | 'height' | 'lift') => catmull(at(i - 1)[key], at(i)[key], at(i + 1)[key], at(i + 2)[key], f);
  return { r: Math.max(.05, v('radius')), h: Math.max(.05, v('height')), lift: v('lift') };
}
export const zAt = (l: Layout, t: number) => l.front - t * (l.front - l.rear);
export function point(g: Genome, l: Layout, t: number, angle: number, target = new T.Vector3()) {
  const z = zAt(l, t), p = profile(g, l, z);
  return target.set(Math.sin(angle) * p.r, p.lift + Math.cos(angle) * p.h, z);
}
/** Surface position and outward normal at (t, angle). */
export function surface(g: Genome, l: Layout, t: number, angle: number) {
  const position = point(g, l, t, angle);
  if (t < .004) return { position, normal: FORWARD.clone() };
  if (t > .996) return { position, normal: FORWARD.clone().negate() };
  const e = .004, a = point(g, l, Math.min(1, t + e), angle).sub(point(g, l, Math.max(0, t - e), angle));
  const b = point(g, l, t, angle + e).sub(point(g, l, t, angle - e));
  const normal = new T.Vector3().crossVectors(a, b).normalize();
  const axis = new T.Vector3(0, profile(g, l, position.z).lift, position.z);
  if (normal.dot(position.clone().sub(axis)) < 0) normal.negate();
  return { position, normal };
}
/** The part frame: +Y along the normal, +Z forward (or up at the tips). */
export function partFrame(normal: T.Vector3, roll = 0) {
  const ref = Math.abs(normal.z) > .92 ? UP : FORWARD;
  const z = ref.clone().addScaledVector(normal, -ref.dot(normal)).normalize(), x = new T.Vector3().crossVectors(normal, z);
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, normal, z));
  return q.multiply(new T.Quaternion().setFromAxisAngle(UP, roll));
}
/** Inverse of `point`: the closest (t, angle) for a point on or near the body. */
export function locate(g: Genome, l: Layout, p: T.Vector3) {
  const t = Math.min(1, Math.max(0, (l.front - p.z) / (l.front - l.rear)));
  const lift = profile(g, l, zAt(l, t)).lift, prof = profile(g, l, zAt(l, t));
  return { t, angle: Math.atan2(p.x / Math.max(prof.r, .01), (p.y - lift) / Math.max(prof.h, .01)) };
}
