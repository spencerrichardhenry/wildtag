// Pure lifecycle transitions: reset, one guarded respawn, recovery, commit reconciliation, damage resolution, evolution.
import type { Actor, Admission, CombatRuntime, LegalityContext, Orientation, RecoveryResult, Vec3 } from './combat-types';
import { findRecoveryPose } from './motion';
import { supportHeight } from './world-queries';
import { defaultCatalogs, type Catalogs } from './registries';
import type { DesignDelta, PartEmitterSource } from './design-delta';
import type { Genome } from './genome';
import type { EcoEvent } from './ecosystem';
import { eligibleChildren, PLANS, type BodyPlan } from './plans';
import { evolveReady, faint, maxHealthOf, type Build, type Run } from './state';

export function resetRuntime(rt: CombatRuntime, orientation: Orientation = { yaw: rt.orientation.yaw, pitch: 0 }): void {
  rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
  rt.actions = []; rt.cooldowns.clear(); rt.permit = null; rt.arc = null; rt.breachReadyAt = 0; rt.invulnerableUntil = 0; rt.staggerUntil = 0; rt.guardProfileId = null;
  rt.targetable = rt.perceivable = rt.damageable = true; rt.groundOffset = 0; rt.orientation = { yaw: orientation.yaw, pitch: orientation.pitch };
}

/** Faints once. The caller saves at once, before the animation. */
export function beginRespawn(run: Run, rt: CombatRuntime): boolean {
  if (run.pendingRespawn) return false;
  faint(run); resetRuntime(rt); return true;
}

/** Completes a pending respawn with a pose checked for the actual growth. The caller installs `anchor.position` and saves. */
export function resolveRespawn(run: Run, rt: CombatRuntime, now: number, anchor: RecoveryResult): boolean {
  if (!run.pendingRespawn || !anchor.ok) return false;
  run.health = maxHealthOf(run); run.pendingRespawn = false;
  resetRuntime(rt, anchor.orientation); rt.invulnerableUntil = now + 3; return true;
}

/** Current orientation, then level, then the anchor revalidated with its own orientation. The caller installs position and orientation together. */
export function recoverPlayer(actor: Actor, position: Vec3, orientation: Orientation, ctx: LegalityContext & { time: number }, anchor: RecoveryResult, maxDistance: number): RecoveryResult {
  const tries: Orientation[] = [orientation, { yaw: orientation.yaw, pitch: 0 }];
  for (const o of tries) {
    const r = findRecoveryPose(actor, position, { ...ctx, orientation: o }, { maxDistance });
    if (r.ok) return r;
  }
  if (anchor.ok && ctx.queries.overlapHull(actor, anchor.position, anchor.orientation, { time: ctx.time, permit: null, bounds: ctx.bounds }).ok)
    return { ok: true, position: { ...anchor.position }, orientation: { ...anchor.orientation } };
  return { ok: false, reason: 'no legal pose' };
}

/** The largest lift, in body lengths, that a growth rescale may use to keep the motion, and its step. */
export const GROWTH_LIFT_MAX = .5, GROWTH_LIFT_STEP = .005;
/** Two refusal normals form a crease when the cosine of their angle is at most this in size (45° to 135° apart). */
export const CREASE_COS = .7;

/** After a growth rescale: a pose for the grown hull that keeps the motion. The position itself when the grown hull is admitted;
 *  else the smallest lift, in steps of GROWTH_LIFT_STEP × L up to GROWTH_LIFT_MAX × L, along the refusal's normal (the support
 *  normal on the seabed; +y when the refusal has no normal) that admits it, with the runtime's orientation and permit.
 *  The lift stops at the first step refused by a different rule or a different solid than the first refusal, so it never carries the
 *  body through a thin solid it meets on the way (owner playtest P4). In a crease (for example the seabed and a rock base), that second
 *  refusal is part of the same pinch: when the two normals are across each other (CREASE_COS), the lift is tried once more along their
 *  sum, and it stops at a third rule (final review M6).
 *  `rt` is only read: velocities, orientation, permit and arc stay as they are. null → the caller recovers instead. */
export function growthPose(actor: Actor, position: Vec3, rt: Pick<CombatRuntime, 'orientation' | 'permit'>, ctx: LegalityContext & { time: number }): Vec3 | null {
  const o = rt.orientation, actx = { time: ctx.time, permit: rt.permit, bounds: ctx.bounds };
  const first = ctx.queries.overlapHull(actor, position, o, actx);
  if (first.ok) return { x: position.x, y: position.y, z: position.z };
  const step = GROWTH_LIFT_STEP * actor.bodyLength, steps = Math.round(GROWTH_LIFT_MAX / GROWTH_LIFT_STEP), UP = { x: 0, y: 1, z: 0 };
  const same = (a: Admission, b: Admission) => a.constraint === b.constraint && a.solidId === b.solidId;
  /** The lift along n: the first admitted step, or the refusal that stopped it (a rule not in `allowed`), or null when none is admitted. */
  const lift = (n: Vec3, allowed: readonly Admission[]): Vec3 | Admission | null => {
    for (let i = 1; i <= steps; i++) {
      const p = { x: position.x + n.x * step * i, y: position.y + n.y * step * i, z: position.z + n.z * step * i };
      const a = ctx.queries.overlapHull(actor, p, o, actx);
      if (a.ok) return p;
      if (!allowed.some(b => same(a, b))) return a;
    }
    return null;
  };
  const n1 = first.normal ?? UP, one = lift(n1, [first]);
  if (one === null || !('constraint' in one)) return one;
  // Only a crease: a second normal across the first (|n1 · n2| ≤ CREASE_COS). One that opposes the lift is a solid in its way; one
  // along it means the lift already reached past that solid's middle (an earlier rule hid it), so both give up.
  const n2 = one.normal ?? UP;
  if (Math.abs(n1.x * n2.x + n1.y * n2.y + n1.z * n2.z) > CREASE_COS) return null;
  const sx = n1.x + n2.x, sy = n1.y + n2.y, sz = n1.z + n2.z, len = Math.hypot(sx, sy, sz);
  const two = lift({ x: sx / len, y: sy / len, z: sz / len }, [first, one]);
  return two !== null && !('constraint' in two) ? two : null;
}

/** A trap (continuation of the final review; made rare in fix round 2): the player pushes in one direction, the body gains less than
 *  TRAP_MOVE body lengths along it for TRAP_SECONDS, and on at least WEDGED_SHARE of those frames it is really wedged (`wedged`). A
 *  push into one rock is not a trap, whatever the mesh's normals do. The body then glides to the nearest pose that lets it go on
 *  (`UnstickSearch`, its path swept by the hull). */
export const TRAP_SECONDS = .75, TRAP_MOVE = .05, TRAP_REACH = 1.5, WEDGE_ANGLE = Math.PI / 6, WEDGED_SHARE = .6, PINCH_ANGLE = 100 * Math.PI / 180;
export interface TrapWatch { x: number; y: number; z: number; dx: number; dz: number; time: number; frames: number; wedgedFrames: number; armed: boolean;
  /** Where and toward what a search last failed: no new search there until the body moves or the push turns. */
  failed: { x: number; z: number; dx: number; dz: number } | null;
  /** Where and when the last rescue started. */
  lastRescue: { x: number; z: number; time: number } | null }
export const newTrapWatch = (): TrapWatch => ({ x: 0, y: 0, z: 0, dx: 0, dz: 0, time: 0, frames: 0, wedgedFrames: 0, armed: false, failed: null, lastRescue: null });
/** A search from here found no pose (fix round 3): the watch stays quiet at this spot for this push. */
export function trapFailed(w: TrapWatch, at: Vec3, push: Vec3): void { const pl = Math.hypot(push.x, push.z) || 1; w.failed = { x: at.x, z: at.z, dx: push.x / pl, dz: push.z / pl }; }
/** A real wedge on this step: contacts with two different solids whose horizontal normals both oppose the push and lie on opposite
 *  sides of it, or two faces of one solid facing each other (the body is pinched between them), or a turn toward the push that was refused (by any rule) while the facing is more
 *  than WEDGE_ANGLE off it and a solid is touched. */
export function wedged(contacts: readonly { normal: Vec3; constraint: string; solidId?: string }[], push: Vec3, turnRefused: boolean, yaw: number): boolean {
  const pl = Math.hypot(push.x, push.z);
  if (pl < 1e-9) return false;
  const px = push.x / pl, pz = push.z / pl;
  // Two different solids pinch the body (fix round 3: one rock's noisy mesh normals on both sides of a head-on push are not a wedge).
  // Pinched: between two different solids, or between two faces of one solid that face each other (an arch's legs; normals more than
  // PINCH_ANGLE apart). One rock's noisy normals on both sides of a head-on push are neither (fix round 3).
  type Side = { id: string; x: number; z: number };
  let left: Side | null = null, right: Side | null = null;
  for (const c of contacts) {
    if (c.constraint !== 'solid') continue;
    const n = c.normal, nl = Math.hypot(n.x, n.z);
    if (nl < 1e-9 || (n.x * px + n.z * pz) / nl >= -.05) continue;   // does not oppose the push
    const side = { id: c.solidId ?? '?', x: n.x / nl, z: n.z / nl };
    if (px * n.z - pz * n.x > 0) left ??= side; else right ??= side;
  }
  if (left && right && (left.id !== right.id || left.x * right.x + left.z * right.z < Math.cos(PINCH_ANGLE))) return true;
  return turnRefused && contacts.some(c => c.constraint === 'solid') && (Math.sin(yaw) * px + Math.cos(yaw) * pz) < Math.cos(WEDGE_ANGLE);
}
/** Call once per played frame with the body's position, the horizontal push (zero when the player asks for nothing) and whether the
 *  step was wedged. True on the frame the body counts as trapped (the watch then restarts). */
export function trapDue(w: TrapWatch, at: Vec3, push: Vec3, L: number, isWedged: boolean, dt: number): boolean {
  const pl = Math.hypot(push.x, push.z);
  if (pl < .05) { w.armed = false; return false; }
  const dx = push.x / pl, dz = push.z / pl, f = w.failed;
  if (f) {
    if (Math.hypot(at.x - f.x, at.z - f.z) < TRAP_MOVE * L && dx * f.dx + dz * f.dz > .9) { w.armed = false; return false; }
    w.failed = null;
  }
  if (!w.armed || dx * w.dx + dz * w.dz < .9 || (at.x - w.x) * dx + (at.z - w.z) * dz > TRAP_MOVE * L) {
    w.armed = true; w.x = at.x; w.y = at.y; w.z = at.z; w.dx = dx; w.dz = dz; w.time = 0; w.frames = 0; w.wedgedFrames = 0;
  }
  w.time += dt; w.frames++; if (isWedged) w.wedgedFrames++;
  if (w.time < TRAP_SECONDS || w.wedgedFrames < WEDGED_SHARE * w.frames) return false;
  w.armed = false;
  return true;
}
/** A rescue: the destination pose and the glide to it (every pose admitted when found). */
export type Rescue = { ok: true; position: Vec3; orientation: Orientation; path: { position: Vec3; orientation: Orientation }[] } | { ok: false; reason: string };
/** The search for the nearest admitted pose within TRAP_REACH body lengths, level, facing the push or (when that fits nowhere) 45° or
 *  90° off it or its own yaw: in place first (a turn the sweep refused), then on rings of UNSTICK_RING L nearest the push direction
 *  first, at the body's height and (ground plans) at the support height there. The body's own pose is not a result. A candidate is
 *  used only when the whole hull is admitted along the straight path to it, position and yaw together, in steps of at most
 *  RESCUE_STEP L and RESCUE_TURN radians: so the body never passes through a solid, and it glides along that path (main.ts).
 *  The search runs in slices (`step(budget)` tests at most `budget` candidates), so a frame never pays for all of it. */
export class UnstickSearch {
  private ring = 0; private angle = 0; private yawIndex = 0; private done = false; private used = 0;
  private readonly yaws: number[];
  /** `free`: how far the push must be free from the rescue pose (RESCUE_FREE, or RESCUE_FREE_REPEAT at a repeated trap). */
  constructor(private readonly actor: Actor, readonly at: Vec3, private readonly yaw: number, private readonly current: Orientation,
    private readonly ctx: LegalityContext & { time: number; ground: boolean }, private readonly free = RESCUE_FREE) {
    this.yaws = [yaw, yaw + Math.PI / 4, yaw - Math.PI / 4, yaw + Math.PI / 2, yaw - Math.PI / 2, current.yaw];
  }
  /** A rescue, null while the search goes on, or a failure when every candidate is refused. One call spends about `budget`
   *  admissions (support heights count as one): candidates are not split, so a call can go over by one candidate's checks. */
  step(budget: number): Rescue | null {
    const rings = Math.floor(TRAP_REACH / UNSTICK_RING + 1e-9), until = this.used + budget;
    while (this.used < until && !this.done) {
      const r = this.ring * UNSTICK_RING * this.actor.bodyLength, a = this.yaw + (this.angle % 2 === 0 ? 1 : -1) * Math.ceil(this.angle / 2) * Math.PI / 8;
      const found = this.test(this.at.x + Math.sin(a) * r, this.at.z + Math.cos(a) * r, this.yaws[this.yawIndex]!, this.ring === 0);
      if (found) { this.done = true; return found; }
      // Next: yaw, then angle (one in place), then ring.
      if (++this.yawIndex < this.yaws.length) continue;
      this.yawIndex = 0;
      if (this.ring > 0 && ++this.angle < 16) continue;
      this.angle = 0;
      if (++this.ring > rings) this.done = true;
    }
    return this.done ? { ok: false, reason: 'no free pose near the trap' } : null;
  }
  private test(x: number, z: number, y0: number, inPlace: boolean): Rescue | null {
    const q = this.ctx.queries, L = this.actor.bodyLength, at = this.at, c = this.current;
    if (inPlace && Math.abs(Math.sin((y0 - c.yaw) / 2)) < 1e-6) return null;
    const o: Orientation = { yaw: y0, pitch: 0 }, actx = { time: this.ctx.time, permit: null, bounds: this.ctx.bounds };
    const ys = [at.y];
    if (this.ctx.ground && !q.terrain.space) { ys.unshift(supportHeight(this.actor, x, z, o, q.terrain) + .01 * L); this.used++; }
    for (const y of ys) {
      const p = { x, y, z };
      this.used++;
      if (!q.overlapHull(this.actor, p, o, actx).ok) continue;
      // The push must be free from there for `free` L (fix round 3): a rescue never leaves the body in the same pocket, to be
      // wedged and rescued again; when no such pose is near, there is no rescue (the body stays, admitted, against the walls).
      // Checked before the path (it is cheaper and rejects more).
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), steps = Math.ceil(this.free / (RESCUE_FREE / RESCUE_FREE_STEPS));
      let clear = true;
      for (let k = 1; k <= steps && clear; k++) {
        const d = this.free * L * k / steps, qx = x + fx * d, qz = z + fz * d;
        const qy = this.ctx.ground && !q.terrain.space ? Math.max(y, supportHeight(this.actor, qx, qz, o, q.terrain) + .01 * L) : y;
        this.used += 2;
        if (!q.overlapHull(this.actor, { x: qx, y: qy, z: qz }, o, actx).ok) clear = false;
      }
      if (!clear) continue;
      // The path: position and yaw (shortest arc) and pitch together, every step admitted.
      const turn = Math.atan2(Math.sin(y0 - c.yaw), Math.cos(y0 - c.yaw)), dist = Math.hypot(x - at.x, y - at.y, z - at.z);
      const n = Math.max(RESCUE_FRAMES, Math.ceil(dist / (RESCUE_STEP * L)), Math.ceil(Math.max(Math.abs(turn), Math.abs(c.pitch)) / RESCUE_TURN));
      const path: { position: Vec3; orientation: Orientation }[] = [];
      for (let k = 1; k <= n && clear; k++) {
        const f = k / n, pose = { position: { x: at.x + (x - at.x) * f, y: at.y + (y - at.y) * f, z: at.z + (z - at.z) * f }, orientation: { yaw: k === n ? y0 : c.yaw + turn * f, pitch: c.pitch * (1 - f) } };
        this.used++;
        if (!q.overlapHull(this.actor, pose.position, pose.orientation, actx).ok) clear = false; else path.push(pose);
      }
      if (clear) return { ok: true, position: p, orientation: o, path };
    }
    return null;
  }
}
/** The whole search at once (tests). */
export const unstickPose = (actor: Actor, at: Vec3, yaw: number, current: Orientation, ctx: LegalityContext & { time: number; ground: boolean }): Rescue =>
  new UnstickSearch(actor, at, yaw, current, ctx).step(Infinity)!;
/** Admissions a frame's slice of the search may spend (support heights count as one), and the ring spacing in body lengths. */
export const UNSTICK_BUDGET = 40, UNSTICK_RING = .25;
/** The glide: at least RESCUE_FRAMES frames (about .15 s at 60 Hz), at most RESCUE_STEP L and RESCUE_TURN radians a step. */
export const RESCUE_FRAMES = 9, RESCUE_STEP = .1, RESCUE_TURN = .2;
/** From a rescue pose the push is free for RESCUE_FREE body lengths (in steps of RESCUE_FREE / RESCUE_FREE_STEPS). A trap within
 *  REPEAT_REACH L of the last rescue's start and REPEAT_SECONDS of it (the player pushes into the same pocket again) needs
 *  RESCUE_FREE_REPEAT L instead: the next rescue gets the body past the pocket, or there is none. */
export const RESCUE_FREE = .5, RESCUE_FREE_STEPS = 5, RESCUE_FREE_REPEAT = 2, REPEAT_REACH = 1, REPEAT_SECONDS = 10;
/** Records a rescue that started at `at` at time `now`. */
export function trapRescued(w: TrapWatch, at: Vec3, now: number): void { w.lastRescue = { x: at.x, z: at.z, time: now }; }
/** The free run a rescue from `at` at time `now` needs (see RESCUE_FREE_REPEAT). */
export function rescueFreeRun(w: TrapWatch, at: Vec3, now: number, L: number): number {
  const r = w.lastRescue;
  return r && now - r.time < REPEAT_SECONDS && Math.hypot(at.x - r.x, at.z - r.z) < REPEAT_REACH * L ? RESCUE_FREE_REPEAT : RESCUE_FREE;
}

const sameEmitter = (a: PartEmitterSource, b: { partUid: string; copy: number; socketId: string }) => a.partUid === b.partUid && a.copy === b.copy && a.socketId === b.socketId;

export function reconcileAfterCommit(rt: CombatRuntime, delta: DesignDelta, genome: Genome, actorId: string, now: number, catalogs: Pick<Catalogs, 'parts' | 'attacks' | 'abilities'> = defaultCatalogs()): void {
  const gone = [...delta.removedEmitters, ...delta.changedEmitters];
  const hasGrant = (uid: string, grantId: string): boolean => {
    const part = genome.parts.find(p => p.uid === uid); if (!part) return false;
    const spec = catalogs.parts.find(s => s.id === part.id); if (!spec) return false;
    return spec.basicAttacks.some(g => g.id === grantId) || spec.activeGrants.some(g => g.id === grantId);
  };
  const kept = [];
  for (const a of rt.actions) {
    const s = a.source;
    if (s.kind === 'part' && gone.some(e => sameEmitter(e, s))) {
      if (hasGrant(s.partUid, a.grantId)) {
        const cd = (catalogs.attacks[a.definitionId] ?? catalogs.abilities[a.definitionId])?.cooldownSeconds;
        if (cd !== undefined) { const key = `${actorId}:${s.partUid}:${a.grantId}`; rt.cooldowns.set(key, Math.max(rt.cooldowns.get(key) ?? 0, now + cd)); }
      }
    } else kept.push(a);
  }
  rt.actions = kept;
  const prefix = `${actorId}:`;
  for (const key of [...rt.cooldowns.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length), i = rest.lastIndexOf(':');
    if (i < 0 || !hasGrant(rest.slice(0, i), rest.slice(i + 1))) rt.cooldowns.delete(key);
  }
}

/** Accepts one hit per invulnerability window, in (time, entity id) order, only while playing and damageable. */
export function resolveHazards(events: readonly EcoEvent[], ctx: { mode: string; pendingRespawn: boolean; rt: CombatRuntime; now: number; mass: number; resistance: number }): EcoEvent[] {
  const out: EcoEvent[] = [], { rt } = ctx;
  const sorted = [...events].sort((a, b) => a.time - b.time || (a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0));
  for (const e of sorted) {
    if (ctx.mode !== 'playing' || ctx.pendingRespawn || !rt.damageable || ctx.now < rt.invulnerableUntil) continue;
    rt.invulnerableUntil = ctx.now + e.hazard.invulnerabilitySeconds;
    const k = e.hazard.impulse / ctx.mass * (1 - ctx.resistance);
    rt.externalVelocity.x += e.normal.x * k; rt.externalVelocity.y += e.normal.y * k; rt.externalVelocity.z += e.normal.z * k;
    out.push(e);
  }
  return out;
}

export function evolutionDestination(actor: Actor, here: Vec3, ctx: LegalityContext & { orientation: Orientation; time: number }, anchor: Vec3): RecoveryResult {
  return findRecoveryPose(actor, here, ctx, { maxDistance: 30 * actor.bodyLength, anchor });
}

export function canChooseNextPlan(run: Run, build: Pick<Build, 'coast'>, plans: readonly BodyPlan[] = PLANS): boolean {
  return evolveReady(run) && eligibleChildren(run.plans, build, plans).length > 0;
}
