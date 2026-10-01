// Avoidance acceptance (spec §3): real encounters with the real hunter rules and the real player step.
// The encounter search (fixture construction) is separate from the escape evaluation. Both start from fresh ecosystems.
import { PLAYER_HALF, SIZES } from './biomes';
import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRuntime, type Orientation, type PursuitPolicy, type Vec3, type WorldQueries } from './combat-types';
import { Ecosystem, entityRadius, noticeRadius, touches, type EcoEvent, type Entity } from './ecosystem';
import { derive, effectiveStats, starterFor } from './genome';
import { RELEASED } from './input';
import { recoverPlayer } from './lifecycle';
import { findRecoveryPose, startAnchor } from './motion';
import { playerActor } from './mount';
import { orientHull } from './orientation';
import { plan as planById, type BodyPlan } from './plans';
import { movement, movementCapabilities } from './profiles';
import { stepPlayer } from './player-motion';
import { STAGES } from './state';
import { makeTerrain, makeWorldQueries, supportHeight } from './world-queries';

export interface Encounter { seed: number; entityId: number; hunterKey: string; planId: string; start: Vec3; hunterStart: Vec3; separation: number }
export interface EscapeResult { ok: boolean; reason: 'gave-up' | 'no-hit' | 'hit' | 'not-acquired' | 'stuck'; seconds: number }

const DT = 1 / 60, ESCAPE_SECONDS = 8;
const DEFAULT_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

interface Legality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
const legalities = new Map<number, Legality>();
/** The player's world queries and bounds for a stage, as in the game (main.ts `legality`). */
function legality(stage: number): Legality {
  let l = legalities.get(stage);
  if (!l) {
    const size = SIZES[stage]!;
    l = { queries: makeWorldQueries(makeTerrain(stage)), bounds: { half: PLAYER_HALF * size, maxY: stage >= 3 ? 30 * size : undefined } };
    legalities.set(stage, l);
  }
  return l;
}

/** The starter of a plan as the game builds it: genome, actor at growth 1, derived stats. */
interface Player { plan: BodyPlan; actor: Actor; stealth: number; topSpeedLocal: number }
function playerFor(planId: string): Player {
  const p = planById(planId);
  if (!p) throw new Error(`avoidance: unknown plan ${planId}`);
  const genome = starterFor(p), derived = derive(effectiveStats(genome, p));
  return { plan: p, actor: playerActor(p, genome, p.size, 1), stealth: derived.stealthFactor, topSpeedLocal: STAGES[p.size]!.speed * derived.speedFactor };
}

/** The player faces away from the hunter. */
const awayYaw = (from: Vec3, hunter: Vec3): Orientation => ({ yaw: Math.atan2(from.x - hunter.x, from.z - hunter.z), pitch: 0 });
const worldHull = (actor: Actor, at: Vec3, o: Orientation): Capsule[] =>
  orientHull(actor.hull, o).map(c => ({ ...c, start: { x: c.start.x + at.x, y: c.start.y + at.y, z: c.start.z + at.z }, end: { x: c.end.x + at.x, y: c.end.y + at.y, z: c.end.z + at.z } }));
const hunterEvent = (events: readonly EcoEvent[], hunter: Entity) => events.find(ev => ev.entity === hunter);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The acquiring step at now 0: the player stands still at `start`. True when the hunter hunts with no hazard event from it. */
function acquires(eco: Ecosystem, hunter: Entity, pl: Player, start: Vec3, o: Orientation): boolean {
  const events = eco.step({ stage: pl.plan.size, dt: DT, now: 0, player: start, playerHull: worldHull(pl.actor, start, o), perceivable: true, stealthFactor: pl.stealth });
  return hunter.mode === 'hunt' && !hunterEvent(events, hunter);
}

/** Fixture construction (G4-3, R4-08): encounters where a fresh hunter of `hunterKey` acquires a fresh starter of `planId`. */
export function findEncounters(planId: string, hunterKey: string, count: number, seeds: readonly number[] = DEFAULT_SEEDS): Encounter[] {
  const pl = playerFor(planId), stage = pl.plan.size, legal = legality(stage), L = pl.actor.bodyLength, out: Encounter[] = [];
  for (const seed of seeds) {
    // A fresh, never stepped ecosystem: its hunters stand where every fresh ecosystem of this seed has them.
    const layout = new Ecosystem(seed);
    for (const h of layout.entities) {
      if (h.spec.key !== hunterKey || h.eaten) continue;
      const n = noticeRadius(h, stage, pl.stealth), hunter: Vec3 = { x: h.x, y: h.y, z: h.z };
      const base = Math.atan2(-h.x, -h.z);   // hunter to origin, as a yaw (sin, cos)
      for (let k = 0; k < 8; k++) {
        const a = base + k * Math.PI / 4;
        const near: Vec3 = { x: h.x + Math.sin(a) * .95 * n, y: h.y, z: h.z + Math.cos(a) * .95 * n };
        const o = awayYaw(near, hunter);
        const rec = findRecoveryPose(pl.actor, near, { ...legal, orientation: o, time: 0 }, { maxDistance: 2 * L });
        if (!rec.ok) continue;
        const start = rec.position, ro = rec.orientation;
        if (distance(start, hunter) > n) continue;
        if (touches(hunter, entityRadius(h), worldHull(pl.actor, start, ro))) continue;
        // Each candidate is judged on its own fresh ecosystem.
        const eco = new Ecosystem(seed), fresh = eco.entities.find(e => e.id === h.id)!;
        if (!acquires(eco, fresh, pl, start, ro)) continue;
        out.push({ seed, entityId: h.id, hunterKey, planId, start: { ...start }, hunterStart: hunter, separation: distance(start, hunter) });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

/** Runs straight away from the hunter for eight seconds with the real player step and the real hunter rules. */
export function simulateEscape(e: Encounter, hunter: { speedScale?: number; policy?: PursuitPolicy } = {}): EscapeResult {
  const pl = playerFor(e.planId), p = pl.plan, stage = p.size, size = SIZES[stage]!, legal = legality(stage), actor = pl.actor;
  const caps = movementCapabilities(p), profile = movement(p.movement), t = legal.queries.terrain, L = actor.bodyLength;
  const policy = hunter.policy;
  const eco = new Ecosystem(e.seed, policy ? { pursuitFor: x => x.id === e.entityId ? policy : undefined } : {});
  const h = eco.entities.find(x => x.id === e.entityId);
  if (!h) throw new Error(`avoidance: no entity ${e.entityId} in seed ${e.seed}`);
  if (hunter.speedScale !== undefined) h.spec = { ...h.spec, speed: h.spec.speed * hunter.speedScale };

  // Place the player at the start, as installPose does: level, away from the hunter, settled on its support.
  let position: Vec3 = { ...e.start };
  const rt: CombatRuntime = newRuntime(awayYaw(e.start, e.hunterStart));
  const settle = () => { rt.groundOffset = caps.ground && !t.space ? Math.max(0, position.y - (supportHeight(actor, position.x, position.z, rt.orientation, t) + .01 * L)) : 0; };
  settle();
  if (!acquires(eco, h, pl, position, rt.orientation)) return { ok: false, reason: 'not-acquired', seconds: 0 };

  const intent: CombatInput = caps.rise ? { ...RELEASED, traversal: 'rise' } : RELEASED;
  const anchor = startAnchor(actor, stage, legal);
  const steps = Math.round(ESCAPE_SECONDS / DT);
  for (let i = 1; i <= steps; i++) {
    const now = i * DT;
    const dx = position.x - h.x, dz = position.z - h.z, len = Math.hypot(dx, dz);
    const wish: Vec3 = len > 1e-9 ? { x: dx / len, y: 0, z: dz / len } : { x: 0, y: 0, z: 0 };
    const r = stepPlayer(position, rt, intent, { plan: p, profile, caps, actor, ...legal, size, topSpeedLocal: pl.topSpeedLocal, now, dt: DT, wish, aim: null, actionLock: false });
    position = r.position;
    if (r.needsRecovery) {
      const rec = recoverPlayer(actor, position, rt.orientation, { ...legal, time: now + DT }, anchor, 20 * L);
      if (!rec.ok) return { ok: false, reason: 'stuck', seconds: now };
      position = { ...rec.position }; rt.orientation = { ...rec.orientation };
      rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
      settle();
    }
    const events = eco.step({ stage, dt: DT, now, player: position, playerHull: worldHull(actor, position, rt.orientation), perceivable: true, stealthFactor: pl.stealth });
    const hit = hunterEvent(events, h);
    if (hit) return { ok: false, reason: 'hit', seconds: hit.time };
    if (h.mode === 'return') return { ok: true, reason: 'gave-up', seconds: now };
  }
  return { ok: true, reason: 'no-hit', seconds: ESCAPE_SECONDS };
}
