// Part mounts (shared with the renderer), the occupancy hull with its animation envelope, combat poses on the shared rig,
// mass, and the player and species actors (spec §8 "Rig, sockets and pose", "Hull and physics").
import * as T from 'three';
import { layout, partFrame, PART_SCALE, SPACING, surface, type Layout } from './body-geometry';
import { SIZES } from './biomes';
import type { Actor, Capsule, CombatPose, Emitter, Vec3 } from './combat-types';
import { emittersOf } from './design-delta';
import type { Genome, PlacedPart } from './genome';
import { part } from './parts';
import type { BodyPlan } from './plans';
import { habitat } from './profiles';
import { boneMatricesInto, CHOMP_PITCH, pivotToPart, restPivotToPart, SWIM_AMP_MAX, type RigPose } from './rig';
import type { Species } from './species';

/** `local`: the part root in its bone's space (the renderer decomposes it). `body`: the part root in body space at rest. */
export interface Mount { boneIndex: number; local: T.Matrix4; body: T.Matrix4; reflected: boolean }

/** Copy 1 negates the angle and roll and has scale.x = −1. The nearest bone carries the part. */
export function resolveMount(g: Genome, placed: PlacedPart, copy: 0 | 1, l: Layout = layout(g)): Mount {
  const reflected = copy === 1, angle = reflected ? -placed.angle : placed.angle;
  const { position, normal } = surface(g, l, placed.t, angle);
  const n = g.spine.length, boneIndex = Math.max(0, Math.min(n - 1, Math.round((l.z[0]! - position.z) / SPACING)));
  const boneRest = new T.Vector3(0, g.spine[boneIndex]!.lift, l.z[boneIndex]!), s = placed.scale * PART_SCALE;
  const q = partFrame(normal, reflected ? -placed.roll : placed.roll), scale = new T.Vector3(reflected ? -s : s, s, s);
  const local = new T.Matrix4().compose(position.clone().sub(boneRest), q, scale);
  const body = new T.Matrix4().compose(position, q, scale);
  return { boneIndex, local, body, reflected };
}

// ---- occupancy hull ----

/** Coefficients A0..A3 (value = Σ Ak f^k) of the Catmull-Rom cubic used by `profile()`. */
const catmullCoeffs = (a: number, b: number, c: number, d: number): [number, number, number, number] =>
  [b, .5 * (c - a), .5 * (2 * a - 5 * b + 4 * c - d), .5 * (3 * b - a - 3 * c + d)];
/** Exact min and max of A0 + A1 f + A2 f² + A3 f³ on [0, 1]: the endpoints and the real derivative roots inside. */
function cubicRange([a0, a1, a2, a3]: readonly number[]): { min: number; max: number } {
  const at = (f: number) => a0! + f * (a1! + f * (a2! + f * a3!));
  const fs = [0, 1];
  // Derivative: 3 a3 f² + 2 a2 f + a1.
  const A = 3 * a3!, B = 2 * a2!, C = a1!;
  if (Math.abs(A) < 1e-14) { if (Math.abs(B) > 1e-14) fs.push(-C / B); }
  else { const disc = B * B - 4 * A * C; if (disc >= 0) { const r = Math.sqrt(disc); fs.push((-B + r) / (2 * A), (-B - r) / (2 * A)); } }
  let min = Infinity, max = -Infinity;
  for (const f of fs) if (f >= 0 && f <= 1) { const v = at(f); min = Math.min(min, v); max = Math.max(max, v); }
  return { min, max };
}

/** Rest hull capsules with their bone sets, before the envelope. */
function restCapsules(g: Genome, l: Layout): { c: { start: Vec3; end: Vec3; radius: number }; bones: number[] }[] {
  const s = g.spine, n = s.length, at = (j: number) => s[Math.max(0, Math.min(n - 1, j))]!, out: { c: { start: Vec3; end: Vec3; radius: number }; bones: number[] }[] = [];
  const o = (i: number): Vec3 => ({ x: 0, y: s[i]!.lift, z: l.z[i]! });
  out.push({ c: { start: o(0), end: { x: 0, y: s[0]!.lift, z: l.front }, radius: Math.max(s[0]!.radius, s[0]!.height) }, bones: [0] });
  for (let k = 0; k < n - 1; k++) {
    const cubic = (key: 'radius' | 'height' | 'lift') => catmullCoeffs(at(k - 1)[key], at(k)[key], at(k + 1)[key], at(k + 2)[key]);
    const lift = cubic('lift'), b = s[k]!.lift, c = s[k + 1]!.lift;
    const dev = cubicRange([lift[0] - b, lift[1] - (c - b), lift[2], lift[3]]);
    const radius = Math.max(.05, cubicRange(cubic('radius')).max, cubicRange(cubic('height')).max) + Math.max(Math.abs(dev.min), Math.abs(dev.max));
    out.push({ c: { start: o(k), end: o(k + 1), radius }, bones: [k, k + 1] });
  }
  out.push({ c: { start: o(n - 1), end: { x: 0, y: s[n - 1]!.lift, z: l.rear }, radius: Math.max(s[n - 1]!.radius, s[n - 1]!.height) }, bones: [n - 1] });
  return out;
}

/** The occupancy hull in body space at unit scale: front cap, one capsule per segment, rear cap; each with sway and heave. */
export function bodyHull(g: Genome): Capsule[] {
  const l = layout(g), s = g.spine, n = s.length;
  const o = (i: number) => ({ x: 0, y: s[i]!.lift, z: l.z[i]! });
  const theta = (i: number) => i >= 1 && n > 1 ? SWIM_AMP_MAX * i / (n - 1) : 0;
  return restCapsules(g, l).map(({ c, bones }) => {
    const horiz = (i: number) => { const p = o(i); return Math.max(Math.hypot(c.start.x - p.x, c.start.z - p.z), Math.hypot(c.end.x - p.x, c.end.z - p.z)) + c.radius; };
    const yaw = (j: number) => { let disp = 0; for (let i = j; i >= 1; i--) disp += theta(i) * (horiz(i) + disp); return disp; };
    const chomp = (j: number) => {
      if (j >= 1) { const a = o(0), b = o(1); return CHOMP_PITCH * Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
      const a = o(0);
      return CHOMP_PITCH * (Math.max(Math.hypot(c.start.x - a.x, c.start.y - a.y, c.start.z - a.z), Math.hypot(c.end.x - a.x, c.end.y - a.y, c.end.z - a.z)) + c.radius);
    };
    let sway = 0, heave = 0;
    for (const j of bones) { const cj = chomp(j); sway = Math.max(sway, yaw(j) + cj); heave = Math.max(heave, cj); }
    return { start: c.start, end: c.end, radius: c.radius, sway, heave };
  });
}

const scaled = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
/** The hull at a physical scale: positions, radii, sway and heave multiplied by `scale`. */
export const hullOffsets = (g: Genome, scale: number): Capsule[] =>
  bodyHull(g).map(c => ({ start: scaled(c.start, scale), end: scaled(c.end, scale), radius: c.radius * scale, sway: (c.sway ?? 0) * scale, heave: (c.heave ?? 0) * scale }));
export const bodyLengthOf = (g: Genome): number => { const l = layout(g); return l.front - l.rear; };
export const massFor = (plan: BodyPlan, _g: Genome, physicalLength: number): number => plan.physics.massPerBodyLength * physicalLength;

// ---- actors ----

export function playerActor(plan: BodyPlan, genome: Genome, stage: number, growth: number): Actor {
  const scale = SIZES[stage]! * growth;
  return { id: 'player', hull: hullOffsets(genome, scale), habitat: habitat(plan.habitat), bodyLength: bodyLengthOf(genome) * scale };
}
/** One sphere standing on the origin (food models stand on their origin). */
export function speciesActor(e: { id: number; spec: Pick<Species, 'tier' | 'habitatProfileId'> }): Actor {
  const size = SIZES[e.spec.tier]!, ro = .35 * size, centre = { x: 0, y: ro, z: 0 };
  return { id: `e${e.id}`, hull: [{ start: centre, end: centre, radius: ro, sway: 0, heave: 0 }], habitat: habitat(e.spec.habitatProfileId), bodyLength: size * 1.4 };
}

// ---- combat poses ----

export interface PoseInput { actorId: string; genome: Genome; plan: BodyPlan; world: T.Matrix4; rig: RigPose; physicalLength: number }

const vec = (v: T.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
export function sampleCombatPose(input: PoseInput): CombatPose {
  const { genome: g, world, rig } = input, l = layout(g), n = g.spine.length, k = world.getMaxScaleOnAxis();
  const bones = boneMatricesInto(g.spine.map(() => new T.Matrix4()), g, rig).map(m => new T.Matrix4().multiplyMatrices(world, m));
  const at = (p: Vec3, m: T.Matrix4) => vec(new T.Vector3(p.x, p.y, p.z).applyMatrix4(m));
  const hull = bodyHull(g).map(c => ({ start: at(c.start, world), end: at(c.end, world), radius: c.radius * k, sway: (c.sway ?? 0) * k, heave: (c.heave ?? 0) * k }));
  // Hurtboxes: hull radii without the envelope, between posed bone origins and posed tips.
  const origin = (i: number) => at({ x: 0, y: 0, z: 0 }, bones[i]!);
  const hurtboxes: Capsule[] = hull.map((c, i) => {
    if (i === 0) return { start: origin(0), end: at({ x: 0, y: 0, z: l.front - l.z[0]! }, bones[0]!), radius: c.radius };
    if (i === hull.length - 1) return { start: origin(n - 1), end: at({ x: 0, y: 0, z: l.rear - l.z[n - 1]! }, bones[n - 1]!), radius: c.radius };
    return { start: origin(i - 1), end: origin(i), radius: c.radius };
  });
  const emitters: Emitter[] = [], mounts = new Map<string, Mount>(), posed = new T.Matrix4(), M = new T.Matrix4(), linear = new T.Matrix3();
  for (const source of emittersOf(g)) {
    const placed = g.parts.find(p => p.uid === source.partUid)!, socket = part(placed.id)!.sockets.find(s => s.id === source.socketId)!;
    const mk = `${placed.uid}:${source.copy}`;
    let mount = mounts.get(mk); if (!mount) { mount = resolveMount(g, placed, source.copy, l); mounts.set(mk, mount); }
    M.multiplyMatrices(bones[mount.boneIndex]!, mount.local);
    if (socket.pivot) {
      const key = `${socket.pivot.kind}:${socket.pivot.index}`;
      pivotToPart(placed.id, key, k2 => rig.pivots.get(`${placed.uid}:${source.copy}:${k2}`), posed);
      M.multiply(posed).multiply(restPivotToPart(placed.id, key).clone().invert());
    }
    linear.setFromMatrix4(M);
    const forward = new T.Vector3(socket.forward.x, socket.forward.y, socket.forward.z).applyMatrix3(linear).normalize();
    emitters.push({ source, origin: at(socket.origin, M), forward: vec(forward), localToWorld: [...M.elements] });
  }
  const forward = new T.Vector3(0, 0, 1).applyMatrix3(linear.setFromMatrix4(world)).normalize();
  return { actorId: input.actorId, position: vec(new T.Vector3().setFromMatrixPosition(world)), forward: vec(forward), bodyLength: input.physicalLength,
    mass: massFor(input.plan, g, input.physicalLength), knockbackResistance: input.plan.physics.knockbackResistance, hull, hurtboxes, emitters };
}

/** One hull sphere at the entity, hurtboxes = hull, one root emitter facing the heading; mass = body length. */
export function speciesCombatPose(e: { id: number; spec: Species; x: number; y: number; z: number; heading: number }, _now: number): CombatPose {
  const actor = speciesActor(e), at = (p: Vec3): Vec3 => ({ x: p.x + e.x, y: p.y + e.y, z: p.z + e.z });
  const hull = actor.hull.map(c => ({ ...c, start: at(c.start), end: at(c.end) })), position = { x: e.x, y: e.y, z: e.z };
  const forward = { x: Math.sin(e.heading), y: 0, z: Math.cos(e.heading) };
  const localToWorld = [...new T.Matrix4().makeRotationY(e.heading).setPosition(e.x, e.y, e.z).elements];
  return { actorId: actor.id, position, forward, bodyLength: actor.bodyLength, mass: actor.bodyLength, knockbackResistance: 0, hull, hurtboxes: hull,
    emitters: [{ source: { kind: 'actor', actorId: actor.id, mountId: 'root', socketId: 'root' }, origin: { ...position }, forward: { ...forward }, localToWorld }] };
}
