// One pure player step (spec §3 "Motion", "Facing", permits; §9). It owns the controlled and external velocities,
// completes the wish, submits the desired orientation as a turn, dispatches Breach, keeps a grounded body on its
// support line, and ends the arc and the permit. It mutates only the runtime it is given and returns the result.
import type { Actor, CombatInput, CombatRuntime, Contact, MotionResult, MovementProfile, MutVec3, Orientation, Vec3, WorldQueries } from './combat-types';
import { EDGE_HINT, edgeCurrent } from './edge';
import { resolveMotion, projectVelocity } from './motion';
import type { BodyPlan } from './plans';
import { BREACH_RISE, breachPermit, type MovementCapabilities } from './profiles';
import { supportHeight } from './world-queries';

export const BREACH_SECONDS = 1.8, BREACH_COOLDOWN = 2.3, BREACH_END_DEPTH = 1.3, EXTERNAL_DECAY = 6, GROUND_SETTLE = 6;
const PITCH_LIMIT = 1.2, FACING_MIN = .05;

export interface PlayerStepContext {
  plan: BodyPlan; profile: MovementProfile; caps: MovementCapabilities; actor: Actor; queries: WorldQueries; bounds: { half: number; maxY?: number };
  size: number; topSpeedLocal: number; now: number; dt: number;
  /** The camera-mapped move wish in world space, |wish| ≤ 1; y is the camera pitch part, used only when caps.pitch. */
  wish: Vec3; aim: Vec3 | null; actionLock: boolean;
}
export interface PlayerStepResult { position: Vec3; status: MotionResult['status']; contacts: readonly Contact[]; needsRecovery: boolean; breachStarted: boolean; arcEnded: boolean; permitEnded: boolean }

/** The signed shortest arc from a to b, in (−π, π]. */
function shortestArc(a: number, b: number): number {
  const TAU = 2 * Math.PI;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU;
  return d;
}
const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));

export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInput, ctx: PlayerStepContext): PlayerStepResult {
  const { caps, profile, actor, queries, size, now, dt } = ctx, t = queries.terrain, L = actor.bodyLength, end = now + dt;

  // 1. Breach.
  let breachStarted = false;
  if (intent.traversal === 'breach' && caps.breach && rt.arc === null && now >= rt.breachReadyAt) {
    rt.arc = { startedAt: now, duration: BREACH_SECONDS, fromY: position.y };
    rt.permit = breachPermit(now);
    rt.breachReadyAt = now + BREACH_COOLDOWN;
    breachStarted = true;
  }
  const arc = rt.arc;

  // 2. Complete wish, before acceleration.
  const w: MutVec3 = { x: ctx.wish.x, y: caps.pitch ? ctx.wish.y : 0, z: ctx.wish.z };
  if (caps.rise && arc === null) { if (intent.traversal === 'rise') w.y += 1; else if (intent.traversal === 'dive') w.y -= 1; }
  if (caps.ground) w.y = 0;
  const wLen = Math.hypot(w.x, w.y, w.z);
  if (wLen > 1) { w.x /= wLen; w.y /= wLen; w.z /= wLen; }

  // 3. Controlled velocity (physical).
  const k = ctx.topSpeedLocal * profile.speedMultiplier * size;
  const target = { x: w.x * k, y: w.y * k, z: w.z * k }, cv = rt.controlledVelocity;
  const v: MutVec3 = { x: cv.x, y: cv.y, z: cv.z };
  const rate = (Math.hypot(target.x, target.y, target.z) > Math.hypot(v.x, v.y, v.z) ? profile.acceleration : profile.braking) * size;
  const gx = target.x - v.x, gy = target.y - v.y, gz = target.z - v.z, gap = Math.hypot(gx, gy, gz), maxStep = rate * dt;
  if (gap > 0) {
    if (gap <= maxStep) { v.x = target.x; v.y = target.y; v.z = target.z; }
    else { const f = maxStep / gap; v.x += gx * f; v.y += gy * f; v.z += gz * f; }
  }
  if (caps.ground || arc !== null) v.y = 0;

  // 4. Desired orientation (submitted as a turn; not committed here).
  const o = rt.orientation;
  let f: Vec3 | null = w;
  if (profile.facing === 'aim') f = ctx.aim ?? w;
  else if (profile.facing === 'lock-during-action' && ctx.actionLock) f = null;
  let yawTarget = o.yaw, pitchTarget = caps.pitch ? o.pitch : 0;
  if (f) {
    const fLen = Math.hypot(f.x, f.y, f.z);
    if (Math.hypot(f.x, f.z) > FACING_MIN) yawTarget = Math.atan2(f.x, f.z);
    if (caps.pitch && fLen > 0) pitchTarget = clampAbs(Math.asin(clampAbs(f.y / fLen, 1)), PITCH_LIMIT);
  }
  const desired: Orientation = {
    yaw: o.yaw + clampAbs(shortestArc(o.yaw, yawTarget), profile.maxYawRate * dt),
    pitch: o.pitch + clampAbs(pitchTarget - o.pitch, profile.maxPitchRate * dt),
  };

  // 5. Displacement. The vertical part has one owner; external motion accumulates. The edge current (edge.ts) is a
  //    pure function of the position: it is added here and stored in neither velocity owner.
  const ev = rt.externalVelocity, edge = edgeCurrent(position, ctx.bounds.half, size);
  const d: MutVec3 = { x: (v.x + ev.x + edge.x) * dt, y: (v.y + ev.y) * dt, z: (v.z + ev.z + edge.z) * dt };
  let arcDone = false;
  const grounded = caps.ground && arc === null && !t.space;
  if (arc !== null) {
    const endY = t.surface - BREACH_END_DEPTH * size, lift = t.surface + BREACH_RISE * size - Math.max(arc.fromY, endY);
    const u = (time: number) => Math.min(1, (time - arc.startedAt) / arc.duration);
    const arcY = (s: number) => arc.fromY + (endY - arc.fromY) * s + Math.sin(s * Math.PI) * lift;
    const uEnd = u(end);
    d.y = arcY(uEnd) - arcY(u(now)) + ev.y * dt;
    arcDone = uEnd >= 1;
  } else if (grounded) {
    const offset = Math.max(0, rt.groundOffset * Math.exp(-GROUND_SETTLE * dt) + ev.y * dt);
    d.y = supportHeight(actor, position.x + d.x, position.z + d.z, o, t) + .01 * L + offset - position.y;
  }

  // 6. Motion.
  const result = resolveMotion({ actorId: 'player', from: position, displacement: d, orientation: o, turn: desired, hull: actor.hull, habitatProfileId: actor.habitat.id,
    cause: 'locomotion', traversalPermit: rt.permit }, { queries, actor, bounds: ctx.bounds, interval: { start: now, end } });
  if (grounded) rt.groundOffset = Math.max(0, result.position.y - (supportHeight(actor, result.position.x, result.position.z, result.orientation, t) + .01 * L));

  // 7. Commit. The two velocity owners are projected separately; their sum is never stored.
  rt.orientation = { yaw: result.orientation.yaw, pitch: result.orientation.pitch };
  const pc = projectVelocity(v, result.contacts), pe = projectVelocity(ev, result.contacts), decay = Math.exp(-EXTERNAL_DECAY * dt);
  cv.x = pc.x; cv.y = pc.y; cv.z = pc.z;
  ev.x = pe.x * decay; ev.y = pe.y * decay; ev.z = pe.z * decay;

  // 8. Ends.
  let arcEnded = false, permitEnded = false, needsRecovery = result.status === 'invalid-start' || result.status === 'needs-recovery';
  if (arcDone) { rt.arc = null; arcEnded = true; }
  if (rt.permit && end >= rt.permit.expiresAt) {
    rt.permit = null; permitEnded = true;
    if (!queries.overlapHull(actor, result.position, rt.orientation, { time: end, bounds: ctx.bounds }).ok) needsRecovery = true;
  }
  return { position: result.position, status: result.status, contacts: result.contacts, needsRecovery, breachStarted, arcEnded, permitEnded };
}

/** A short player-facing reason for a blocked move, by the contact's constraint. */
export function blockHint(plan: BodyPlan, contact: Contact): string {
  const many = `${plan.name}s`;
  switch (contact.constraint) {
    case 'bounds-x': case 'bounds-z': return EDGE_HINT;
    case 'bounds-y': return "That's as high as you can go for now.";
    case 'ground': return 'Something solid is in the way.';
    case 'surface-top': return `${many} can't leave the water.`;
    case 'air': return `${many} can't fly.`;
    case 'land-band': return `${many} can't go on land.`;
    case 'floor-gap': return `${many} stay on the seabed.`;
    case 'depth': return `${many} stay in shallow water.`;
    default: return `${many} can't go there.`;
  }
}
