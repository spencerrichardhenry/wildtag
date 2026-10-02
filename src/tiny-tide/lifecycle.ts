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

/** A trap (continuation of the final review: a long Crawler wedged between small rocks, whose turn and every slide the solids
 *  refuse): the player pushes in one direction, but for TRAP_SECONDS the body gains less than TRAP_MOVE body lengths along it, and on
 *  some frame of that time it is wedged: two contacts whose normals differ by more than WEDGE_ANGLE, or a facing more than WEDGE_ANGLE
 *  off the push (its turn is refused). A push into one flat wall, facing it, is not a trap. The body then moves to the nearest admitted
 *  pose that lets it go on (`unstickPose`). */
export const TRAP_SECONDS = .75, TRAP_MOVE = .05, TRAP_REACH = 1.5, WEDGE_ANGLE = Math.PI / 6;
export interface TrapWatch { x: number; y: number; z: number; dx: number; dz: number; time: number; wedged: boolean; armed: boolean }
export const newTrapWatch = (): TrapWatch => ({ x: 0, y: 0, z: 0, dx: 0, dz: 0, time: 0, wedged: false, armed: false });
/** Is this step wedged? (see TrapWatch) */
export function wedged(contacts: readonly { normal: Vec3 }[], yaw: number, push: Vec3): boolean {
  const c = Math.cos(WEDGE_ANGLE);
  for (let i = 0; i < contacts.length; i++) for (let j = i + 1; j < contacts.length; j++) {
    const a = contacts[i]!.normal, b = contacts[j]!.normal;
    if (a.x * b.x + a.y * b.y + a.z * b.z < c) return true;
  }
  const pl = Math.hypot(push.x, push.z);
  return contacts.length > 0 && pl > 1e-9 && (Math.sin(yaw) * push.x + Math.cos(yaw) * push.z) / pl < c;
}
/** Call once per played frame with the body's position, the horizontal push (zero when the player asks for nothing) and whether the
 *  step was wedged. True on the frame the body counts as trapped (the watch then restarts). */
export function trapDue(w: TrapWatch, at: Vec3, push: Vec3, L: number, isWedged: boolean, dt: number): boolean {
  const pl = Math.hypot(push.x, push.z);
  if (pl < .05) { w.armed = false; return false; }
  const dx = push.x / pl, dz = push.z / pl;
  if (!w.armed || dx * w.dx + dz * w.dz < .9 || (at.x - w.x) * dx + (at.z - w.z) * dz > TRAP_MOVE * L) {
    w.armed = true; w.x = at.x; w.y = at.y; w.z = at.z; w.dx = dx; w.dz = dz; w.time = 0; w.wedged = false;
  }
  w.time += dt; w.wedged ||= isWedged;
  if (w.time < TRAP_SECONDS || !w.wedged) return false;
  w.armed = false;
  return true;
}
/** The nearest admitted pose within TRAP_REACH body lengths, level, facing the push or (when that fits nowhere) another of 8 yaws, in
 *  place first (a turn the sweep refused), then on rings of .125 L nearest the push direction first, at the body's height and (ground
 *  plans) at the support height there. The body's own pose (in place, its own yaw) is not a result. A pose whose centre line from the
 *  body's centre passes through a solid is skipped, so the body never jumps through a rock or an arch leg. */
export function unstickPose(actor: Actor, at: Vec3, yaw: number, current: Orientation, ctx: LegalityContext & { time: number; ground: boolean }): RecoveryResult {
  const q = ctx.queries, L = actor.bodyLength, actx = { time: ctx.time, permit: null, bounds: ctx.bounds };
  const probe: Actor = { id: actor.id, hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 1e-3 * L }], habitat: actor.habitat, bodyLength: L };
  const clear = (p: Vec3) => {
    for (let k = 1; k <= 8; k++) {
      const c = { x: at.x + (p.x - at.x) * k / 8, y: at.y + (p.y - at.y) * k / 8, z: at.z + (p.z - at.z) * k / 8 };
      if (q.overlapHull(probe, c, current, { time: ctx.time }).constraint === 'solid') return false;
    }
    return true;
  };
  const yaws = [yaw, ...[1, 2, 3].flatMap(k => [yaw + k * Math.PI / 4, yaw - k * Math.PI / 4]), yaw + Math.PI];
  const tryAt = (x: number, z: number, inPlace: boolean): RecoveryResult | null => {
    for (const y0 of yaws) {
      const o: Orientation = { yaw: y0, pitch: 0 };
      if (inPlace && Math.abs(Math.sin((y0 - current.yaw) / 2)) < 1e-6) continue;
      const ys = [at.y];
      if (ctx.ground && !q.terrain.space) ys.unshift(supportHeight(actor, x, z, o, q.terrain) + .01 * L);
      for (const y of ys) { const p = { x, y, z }; if (q.overlapHull(actor, p, o, actx).ok && clear(p)) return { ok: true, position: p, orientation: o }; }
    }
    return null;
  };
  const here = tryAt(at.x, at.z, true);
  if (here) return here;
  for (let k = 1; k * .125 <= TRAP_REACH + 1e-9; k++) {
    const r = k * .125 * L;
    for (let j = 0; j < 16; j++) {
      const a = yaw + (j % 2 === 0 ? 1 : -1) * Math.ceil(j / 2) * Math.PI / 8, p = tryAt(at.x + Math.sin(a) * r, at.z + Math.cos(a) * r, false);
      if (p) return p;
    }
  }
  return { ok: false, reason: 'no free pose near the trap' };
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
