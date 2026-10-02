// One pure player step (spec §3 "Motion", "Facing", permits; §9). It owns the controlled and external velocities,
// completes the wish, submits the desired orientation as a turn, dispatches Breach, keeps a grounded body on its
// support line, and ends the arc and the permit. It mutates only the runtime it is given and returns the result.
import type { Actor, BreachArc, CombatInput, CombatRuntime, Contact, MotionResult, MovementProfile, MutVec3, Orientation, TraversalPermit, Vec3, WorldQueries } from './combat-types';
import { EDGE_HINT, edgeCurrent } from './edge';
import { resolveMotion, projectVelocity } from './motion';
import type { BodyPlan } from './plans';
import { BREACH_RISE, breachPermit, type MovementCapabilities } from './profiles';
import { hullExtents, supportHeight } from './world-queries';

export const BREACH_SECONDS = 1.8, BREACH_COOLDOWN = 2.3, BREACH_END_DEPTH = 1.3, EXTERNAL_DECAY = 6, GROUND_SETTLE = 6;
/** A Rise tap is a Breach only when the body's origin is within this many body lengths under the surface; deeper, a tap (and a
 *  hold) is a normal Rise (owner ruling M9: a tap on the seabed must not throw the body into a 1.8 s arc). */
export const BREACH_REACH = 2;
/** The space between the hull top and the surface at the end of a Breach arc, in body lengths. */
export const BREACH_CLEARANCE = .02;
export const PITCH_LIMIT = 1.2;
const FACING_MIN = .05, BREACH_PITCH_STEP = .05;

/** The height a Breach arc ends at: BREACH_END_DEPTH × size under the surface, or deeper, so that the hull top at every pitch
 *  the body can turn to during the arc (|pitch| ≤ PITCH_LIMIT) is at least BREACH_CLEARANCE × L under the surface. Then the
 *  landing is admitted in the water without the permit, at every size and growth (owner playtest P3). The top is sampled
 *  every BREACH_PITCH_STEP; between samples it can grow by at most lip × step / 2, which is added. */
export function breachEndY(actor: Actor, surface: number, size: number): number {
  let top = -Infinity, lip = 0;
  for (const c of actor.hull) lip = Math.max(lip, Math.hypot(c.start.y, c.start.z) + (c.heave ?? 0) + (c.sway ?? 0), Math.hypot(c.end.y, c.end.z) + (c.heave ?? 0) + (c.sway ?? 0));
  const n = Math.ceil(2 * PITCH_LIMIT / BREACH_PITCH_STEP), step = 2 * PITCH_LIMIT / n;
  for (let i = 0; i <= n; i++) top = Math.max(top, hullExtents(actor, { yaw: 0, pitch: -PITCH_LIMIT + i * step }).top);
  return surface - Math.max(BREACH_END_DEPTH * size, top + lip * step / 2 + BREACH_CLEARANCE * actor.bodyLength);
}

export interface PlayerStepContext {
  plan: BodyPlan; profile: MovementProfile; caps: MovementCapabilities; actor: Actor; queries: WorldQueries; bounds: { half: number; maxY?: number };
  size: number; topSpeedLocal: number; now: number; dt: number;
  /** The camera-mapped move wish in world space, |wish| ≤ 1; y is the camera pitch part, used only when caps.pitch. */
  wish: Vec3; aim: Vec3 | null; actionLock: boolean;
}
/** `progress`: the applied displacement over the asked one (1 when nothing was asked). */
export interface PlayerStepResult { position: Vec3; status: MotionResult['status']; contacts: readonly Contact[]; progress: number; needsRecovery: boolean; breachStarted: boolean; arcEnded: boolean; permitEnded: boolean }

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

  // 1. Breach, near the surface only. A Breach tap that starts no arc is a Rise.
  let breachStarted = false;
  if (intent.traversal === 'breach' && caps.breach && rt.arc === null && now >= rt.breachReadyAt && t.surface - position.y <= BREACH_REACH * L) {
    rt.arc = { startedAt: now, duration: BREACH_SECONDS, fromY: position.y, endY: breachEndY(actor, t.surface, size) };
    rt.permit = breachPermit(now);
    rt.breachReadyAt = now + BREACH_COOLDOWN;
    breachStarted = true;
  }
  const arc = rt.arc;

  // 2. Complete wish, before acceleration.
  const w: MutVec3 = { x: ctx.wish.x, y: caps.pitch ? ctx.wish.y : 0, z: ctx.wish.z };
  if (caps.rise && arc === null) { if (intent.traversal === 'rise' || intent.traversal === 'breach') w.y += 1; else if (intent.traversal === 'dive') w.y -= 1; }
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
    const endY = arc.endY, lift = t.surface + BREACH_RISE * size - Math.max(arc.fromY, endY);
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
  if (arcDone) {
    rt.arc = null; arcEnded = true;
    // The landing: a pose admitted in the water ends the permit at once, so a held rise cannot lift the body out before it expires.
    if (rt.permit && queries.overlapHull(actor, result.position, rt.orientation, { time: end, bounds: ctx.bounds }).ok) { rt.permit = null; permitEnded = true; }
  }
  if (rt.permit && end >= rt.permit.expiresAt) {
    rt.permit = null; permitEnded = true;
    if (!queries.overlapHull(actor, result.position, rt.orientation, { time: end, bounds: ctx.bounds }).ok) needsRecovery = true;
  }
  // The move asked for: the displacement, or the wish at full speed when that is longer (a velocity that a wall projected away
  // each frame asks for little, but the player still pushes).
  const asked = Math.max(Math.hypot(d.x, d.y, d.z), Math.hypot(w.x, w.y, w.z) * k * dt), p = result.position;
  const progress = asked > 1e-12 ? Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) / asked : 1;
  return { position: result.position, status: result.status, contacts: result.contacts, progress, needsRecovery, breachStarted, arcEnded, permitEnded };
}

/** A block hint is for a real block only (final review I1): the move is `blocked` and less than BLOCK_HINT_PROGRESS of it was
 *  applied, frame after frame for BLOCK_HINT_SECONDS. A slide along a border is not a block. */
export const BLOCK_HINT_PROGRESS = .25, BLOCK_HINT_SECONDS = .3;
export interface BlockHintGate { blockedFor: number; shown: boolean }
export const newBlockHintGate = (): BlockHintGate => ({ blockedFor: 0, shown: false });
/** True on the one frame of a block when its hint may show. `canShow` is false while another toast is on screen (or the hints'
 *  rate limit runs), so a one-shot message is never replaced; the hint then waits. One hint per block: a new one needs a free frame. */
export function blockHintDue(gate: BlockHintGate, step: Pick<PlayerStepResult, 'status' | 'progress'>, dt: number, canShow: boolean): boolean {
  if (step.status !== 'blocked' || step.progress >= BLOCK_HINT_PROGRESS) { gate.blockedFor = 0; gate.shown = false; return false; }
  gate.blockedFor += dt;
  if (gate.shown || gate.blockedFor < BLOCK_HINT_SECONDS - 1e-9 || !canShow) return false;
  gate.shown = true;
  return true;
}

/** A tap-to-walk target is dropped after TAP_STALL_SECONDS without TAP_PROGRESS stage-local units of new progress toward it (owner
 *  ruling M12: rocks stay walls for ground plans, so a target behind one would otherwise hold the body against the rock). */
export const TAP_STALL_SECONDS = 1, TAP_PROGRESS = .05;
export interface TapWatch { best: number; stalled: number }
export const newTapWatch = (): TapWatch => ({ best: Infinity, stalled: 0 });
/** Call once per frame with the horizontal distance to the target (stage-local units). True when the target should be dropped. A new
 *  target needs a reset watch (`best` = Infinity). */
export function tapTargetStalled(w: TapWatch, distance: number, dt: number): boolean {
  if (distance < w.best - TAP_PROGRESS) { w.best = distance; w.stalled = 0; return false; }
  w.stalled += dt;
  return w.stalled >= TAP_STALL_SECONDS;
}

/** What a step changes that the kept pose depends on: the orientation, the permit and the arc (final review M10). The caller takes a
 *  snapshot before the step; when the step needs recovery and none is found, `restoreStep` puts them back, so the kept (last
 *  installed) pose is admitted again while stuck. One snapshot object is reused every frame. */
export interface StepSnapshot { yaw: number; pitch: number; permit: TraversalPermit | null; arc: BreachArc | null }
export const newStepSnapshot = (): StepSnapshot => ({ yaw: 0, pitch: 0, permit: null, arc: null });
export function snapshotStep(rt: CombatRuntime, out: StepSnapshot): void { out.yaw = rt.orientation.yaw; out.pitch = rt.orientation.pitch; out.permit = rt.permit; out.arc = rt.arc; }
export function restoreStep(rt: CombatRuntime, s: StepSnapshot): void { rt.orientation = { yaw: s.yaw, pitch: s.pitch }; rt.permit = s.permit; rt.arc = s.arc; }

/** A short player-facing reason for a blocked move, by the contact's constraint. */
export function blockHint(plan: BodyPlan, contact: Contact): string {
  const many = `${plan.name}s`;
  switch (contact.constraint) {
    case 'bounds-x': case 'bounds-z': return EDGE_HINT;
    case 'bounds-y': return "That's as high as you can go for now.";
    case 'ground': return 'Something solid is in the way.';
    case 'solid': return 'A rock is in the way.';
    case 'surface-top': return `${many} can't leave the water.`;
    case 'air': return `${many} can't fly.`;
    case 'land-band': return `${many} can't go on land.`;
    case 'floor-gap': return `${many} stay on the seabed.`;
    case 'depth': return `${many} stay in shallow water.`;
    default: return `${many} can't go there.`;
  }
}
