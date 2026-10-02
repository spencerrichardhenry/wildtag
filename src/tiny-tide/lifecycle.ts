// Pure lifecycle transitions: reset, one guarded respawn, recovery, commit reconciliation, damage resolution, evolution.
import type { Actor, Admission, CombatRuntime, LegalityContext, Orientation, RecoveryResult, Vec3 } from './combat-types';
import { findRecoveryPose } from './motion';
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
