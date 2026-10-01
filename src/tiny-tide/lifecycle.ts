// Pure lifecycle transitions: reset, one guarded respawn, recovery, commit reconciliation, damage resolution, evolution.
import type { Actor, CombatRuntime, LegalityContext, Orientation, RecoveryResult, Vec3 } from './combat-types';
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
