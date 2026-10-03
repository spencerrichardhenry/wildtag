// Creature behavior for every tier. Positions are physical units (stage 0 units).
// Active tiers (|tier − stage| ≤ 1) move through the motion resolver, perceive, pursue (spec §10) and emit contact hazards.
// Every entry path (construction, reset, respawn, becoming relevant) installs an entity on a legal pose.
import { makeBiomes, PLAYER_HALF, populate, seabedHeight, SIZES, SPAWN_HALF, spawnPoint, WORLD_HALF, random, type Biome } from './biomes';
import { EDGE_SOFT_START } from './edge';
import type { Actor, AdmissionContext, Capsule, ContactHazard, LegalityContext, MotionRequest, MovementMode, MutVec3, Orientation, PursuitPolicy, Vec3, WorldQueries } from './combat-types';
import { findRecoveryPose, projectVelocity, resolveMotion } from './motion';
import { playerActor, speciesActor } from './mount';
import { habitat, movement, pursuit } from './profiles';
import { HAZARDS } from './registries';
import { BEHAVIOURS } from './bestiary';
import { starterFor } from './genome';
import { PLANS } from './plans';
import type { Species } from './species';
import { stageSolids } from './reef';
import { stageWorldQueries, supportHeight } from './world-queries';
import type { MoveIntent } from './combat-ai';
import { terrainSegmentClear } from './combat-shapes';

export { speciesActor };

export type Mode = 'calm' | 'flee' | 'hunt' | 'angry' | 'return';
export interface Entity {
  id: number; spec: Species;
  x: number; y: number; z: number; hx: number; hy: number; hz: number;
  /** Height above the seabed, kept by grounded movers in the unchecked ambient motion of inactive tiers. */
  groundOffset: number;
  heading: number; phase: number; hp: number; eaten: boolean;
  /** Seconds until the creature comes back after it was eaten. */
  respawn: number; mode: Mode; modeTime: number;
  /** The last observed target point and shape (world space). A null hull is a point capsule of radius 0 at `lastKnown`. */
  lastKnown: Vec3 | null; lastKnownHull: Capsule[] | null; lastSeenAt: number;
  reachable: boolean; reachableSince: number | null; blockedSince: number | null;
  /** No acquisition before this time. */
  returnUntil: number; hazardReadyAt: number;
  /** The tier is relevant to the player's stage (|tier − stage| ≤ 1). */
  active: boolean;
  /** A combat species' motion this tick (spec §5.12, §11.2), set by the combat world's AI tick before the step; legacy species have none
   *  (and a combat species without it this tick moves by today's rules). */
  combat?: EntityMotion | null;
}
/** How a combat species moves this tick: its AI intent (ambient, toward, away, hold), a point to face while holding, a lunge's velocity, its
 *  external (knockback) velocity, a hit-stop freeze, a held body's displacement to the claw point, and `snap`: an emerge point to stand on
 *  at a target-origin wind-up start (review R4; admitted through findRecoveryPose, else no move). `moved` is filled by the step. */
export interface EntityMotion { intent: MoveIntent; face: Vec3 | null; lunge: Vec3 | null; external: MutVec3; frozen: boolean; held: Vec3 | null; snap?: Vec3 | null; moved: number;
  /** This tick's share of the body separation from the player (a displacement; sim.ts `separate`, T17 fix round 1). */
  separation?: MutVec3 }
export interface EcoContext {
  stage: number; dt: number; now: number;
  player: Vec3;
  /** The player's hull in world space, already oriented and translated. */
  playerHull: readonly Capsule[];
  /** False while the player can not be noticed (menu, evolving, fainted). */
  perceivable: boolean; stealthFactor: number;
  /** The run's unlocked parts: an alpha whose reward part is unlocked was defeated and is gone for the run (spec §10.4, D23). Required, so
   *  every caller decides (T17 fix round 1). */
  unlocked: readonly string[];
}
/** Damage acceptance is not decided here; the damage resolution accepts or rejects every event. */
export interface EcoEvent { type: 'hazard'; entity: Entity; hazard: ContactHazard; damage: number; point: Vec3; normal: Vec3; time: number }

export const RESPAWN_TIME = [14, 22] as const;
/** A species that hunts the player's current size respawns later after it is eaten or killed (D28; plan review R14(1): every other
 *  species keeps RESPAWN_TIME). */
export const HUNTER_RESPAWN_TIME = [30, 40] as const;
/** The decay of a combat species' external (knockback) velocity, per second (the player's EXTERNAL_DECAY). */
export const ENTITY_EXTERNAL_DECAY = 6;
/** Seconds of continuous reachability that clear the blocked timer. */
export const BLOCK_CLEAR_SECONDS = 1;
/** Seconds before an entity that could not be installed tries again. */
const INSTALL_RETRY = 2;
/** Hunters (species that hunt or fight back) roam inside SPAWN_HALF + HUNTER_MARGIN tier-local units, and they do not chase into the
 *  player's edge push zone (owner ruling M11): a target past EDGE_SOFT_START × the player's bound is given up and not acquired, so the
 *  edge current never holds a fleeing player for a hunter. */
export const HUNTER_MARGIN = 2;
const isHunter = (spec: Species) => spec.hunts.length > 0 || spec.fights;
/** True when the point is in the push zone of a player of this stage. */
const pastSoftEdge = (p: Vec3, stage: number) => Math.max(Math.abs(p.x), Math.abs(p.z)) > EDGE_SOFT_START * PLAYER_HALF * SIZES[Math.min(stage, SIZES.length - 1)]!;

const pursuitState = () => ({ lastKnown: null, lastKnownHull: null, lastSeenAt: 0, reachable: false, reachableSince: null, blockedSince: null, returnUntil: 0, hazardReadyAt: 0 });

/** A spawn point inside a reef solid of its tier, grown by the body radius (owner playtest P4), is rejected. */
const inReef = (seed: number) => (tier: number, x: number, y: number, z: number) => stageSolids(tier, seed).solidAt(x, y, z, .7 * SIZES[tier]!) !== null;

/** The longest player at a size (plan review R15): the fully grown (× 1.38) starter of each plan of that size. */
const longestPlayer = new Map<number, number>();
function longestPlayerAt(size: number): number {
  let L = longestPlayer.get(size);
  if (L === undefined) { L = Math.max(...PLANS.filter(p => p.size === size).map(p => playerActor(p, starterFor(p), size, 1.38).bodyLength)); longestPlayer.set(size, L); }
  return L;
}
/** An alpha's lair centre (spec §11.2, plan review R15; physical units, on the seabed). The spec's point (radius (22 + 8 × rand) × S around the
 *  world centre) could put the start anchor inside the lair, so the lair is pushed away from the anchor (found next to the world centre): its
 *  centre is resetOutsideFactor × the lair radius + 5 longest player body lengths + (1 + rand) × S from the centre, near a diagonal
 *  (angle π/4 + k π/2 ± .05) so that the whole lair stays inside the spawn square. Installation then finds the nearest admitted pose (≤ 4 L). */
export function lairOf(seed: number, e: { id: number; spec: Species }): Vec3 {
  const a = e.spec.alpha!, S = SIZES[a.size]!, lair = BEHAVIOURS[e.spec.behaviourId!]!.lair!, radius = lair.radiusBodyLengths * speciesActor(e).bodyLength;
  const rand = random(seed * 131 + e.id * 7 + 3), angle = Math.PI / 4 + Math.floor(4 * rand()) * Math.PI / 2 + (rand() - .5) * .1;
  const d = lair.resetOutsideFactor * radius + 5 * longestPlayerAt(a.size) + (1 + rand()) * S, x = Math.sin(angle) * d, z = Math.cos(angle) * d;
  return { x, y: seabedHeight(x, z) + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1), z };
}
export function makeEntities(seed: number): Entity[] {
  return populate(seed, inReef(seed)).map(spawn => spawn.spec.alpha ? { ...spawn, ...lairOf(seed, spawn) } : spawn).map(spawn => ({
    id: spawn.id, spec: spawn.spec, x: spawn.x, y: spawn.y, z: spawn.z, hx: spawn.x, hy: spawn.y, hz: spawn.z,
    groundOffset: spawn.y - seabedHeight(spawn.x, spawn.z), heading: spawn.phase, phase: spawn.phase,
    hp: spawn.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, active: false, ...pursuitState(),
  }));
}
/** Physical body radius of an entity, for contact checks. */
export const entityRadius = (e: Entity) => SIZES[e.spec.tier]! * (e.spec.kind === 'planet' ? 1.6 : .7);
const follows = (e: Entity) => ['graze', 'skittish'].includes(e.spec.behavior) && e.spec.tier <= 2 && !['copepod', 'shrimp'].includes(e.spec.kind);

/** Does this entity want to hunt a player of this stage, if it notices one? */
export const isThreat = (e: Entity, stage: number) => !e.eaten && (e.spec.hunts.includes(stage) || e.mode === 'angry');
export function noticeRadius(e: Entity, stage: number, stealthFactor: number) {
  return (e.spec.tier > stage ? 2.5 : 8) * SIZES[e.spec.tier]! * stealthFactor;
}

// ---- touch ----

const closest: MutVec3 = { x: 0, y: 0, z: 0 };
/** Distance from c to the segment ab; the closest point is left in `closest`. */
function segmentDistance(c: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, len2 = abx * abx + aby * aby + abz * abz;
  const f = len2 > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2)) : 0;
  closest.x = a.x + abx * f; closest.y = a.y + aby * f; closest.z = a.z + abz * f;
  return Math.hypot(c.x - closest.x, c.y - closest.y, c.z - closest.z);
}
/** Does a sphere of radius R at c touch some capsule of the hull? (distance to the axis ≤ R + radius) */
export function touches(c: Vec3, R: number, hull: readonly Capsule[]): boolean {
  for (const k of hull) if (segmentDistance(c, k.start, k.end) <= R + k.radius) return true;
  return false;
}

// ---- memory ----

type MutCapsule = { start: MutVec3; end: MutVec3; radius: number };
/** Records the observed target: point, time and a copy of the hull in the entity's reusable buffers (no hull: null). */
function remember(e: Entity, player: Vec3, now: number, hull: readonly Capsule[] | null | undefined) {
  const known = e.lastKnown as MutVec3 | null;
  if (known) { known.x = player.x; known.y = player.y; known.z = player.z; } else e.lastKnown = { x: player.x, y: player.y, z: player.z };
  e.lastSeenAt = now;
  if (!hull || hull.length === 0) { e.lastKnownHull = null; return; }   // no snapshot: a point capsule at lastKnown
  const buf = (e.lastKnownHull as MutCapsule[] | null) ?? [];
  for (let k = 0; k < hull.length; k++) {
    const src = hull[k]!, dst = buf[k] ?? (buf[k] = { start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0 });
    dst.start.x = src.start.x; dst.start.y = src.start.y; dst.start.z = src.start.z;
    dst.end.x = src.end.x; dst.end.y = src.end.y; dst.end.z = src.end.z; dst.radius = src.radius;
  }
  buf.length = hull.length;
  e.lastKnownHull = buf;
}

/** A new pursuit starts with no reachability history. */
function clearBlocked(e: Entity) { e.reachable = false; e.reachableSince = null; e.blockedSince = null; }

const owners = new WeakMap<Entity, Ecosystem>();
/** A combat species that struck from ambush hunts the player (T16 carry 4: an eel whose pursuit stayed calm would retreat at once). Unlike
 *  `provoke` it needs no `fights` flag and keeps an angry entity angry. */
export function engage(e: Entity, player: Vec3, now: number, hull?: readonly Capsule[]) {
  if (e.eaten || e.mode === 'hunt' || e.mode === 'angry') return;
  clearBlocked(e); e.mode = 'hunt'; e.modeTime = 0;
  remember(e, player, now, hull);
  owners.get(e)?.updateReachability(e, now);
}
/** The player provokes a fighter by biting it; `hull` is the biter's world hull at the bite. */
export function provoke(e: Entity, player: Vec3, now: number, hull?: readonly Capsule[]) {
  if (!e.spec.fights || e.eaten) return;
  if (e.mode !== 'hunt' && e.mode !== 'angry') clearBlocked(e);
  e.mode = 'angry'; e.modeTime = 0;
  remember(e, player, now, hull);
  owners.get(e)?.updateReachability(e, now);
}

const O0: Orientation = Object.freeze({ yaw: 0, pitch: 0 });
const isStatic = (e: Entity) => !!habitat(e.spec.habitatProfileId).isStaticProp;

export class Ecosystem {
  readonly entities: Entity[];
  readonly biomes: Biome[][];
  /** Entities that found no legal pose on some entry path (each one retries at its next respawn). */
  installFailures = 0;
  private rand: () => number;
  private readonly queries: WorldQueries[];
  private readonly bounds: { half: number }[];
  private readonly hunterBounds: { half: number }[];
  private readonly actors = new Map<Entity, Actor>();
  /** Test seam: a pursuit policy per entity; undefined falls back to the registry. */
  private readonly pursuitFor: ((e: Entity) => PursuitPolicy | undefined) | undefined;
  // Scratch objects reused on the hot path.
  private readonly from: MutVec3 = { x: 0, y: 0, z: 0 };
  private readonly disp: MutVec3 = { x: 0, y: 0, z: 0 };
  private readonly pose: MutVec3 = { x: 0, y: 0, z: 0 };
  private readonly actx: AdmissionContext = { time: 0 };
  private readonly req: MotionRequest = { actorId: '', from: this.from, displacement: this.disp, orientation: O0, hull: [], habitatProfileId: '', cause: 'locomotion' };
  private readonly motion: LegalityContext & { actor: Actor; interval: { start: number; end: number } } = { queries: null!, actor: null!, interval: { start: 0, end: 0 } };

  constructor(readonly seed: number, opts: { queries?: (tier: number) => WorldQueries; pursuitFor?: (e: Entity) => PursuitPolicy | undefined } = {}) {
    this.pursuitFor = opts.pursuitFor;
    this.entities = makeEntities(seed);
    this.biomes = SIZES.map((_, tier) => makeBiomes(seed, tier));
    this.rand = random(seed ^ 0x51ed);
    if (opts.queries) this.queries = SIZES.map((_, tier) => opts.queries!(tier));
    else this.queries = SIZES.map((_, tier) => stageWorldQueries(tier, seed));
    this.bounds = SIZES.map(size => ({ half: WORLD_HALF * size }));
    this.hunterBounds = SIZES.map(size => ({ half: (SPAWN_HALF + HUNTER_MARGIN) * size }));
    for (const e of this.entities) { this.actors.set(e, speciesActor(e)); owners.set(e, this); this.install(e); }
  }
  /** Restores a run: planets already eaten stay eaten, everything else is fresh. */
  reset(eatenPlanets: readonly number[]) {
    const fresh = makeEntities(this.seed); this.giveUpUntil = -Infinity;
    this.entities.forEach((e, i) => Object.assign(e, fresh[i]!));
    // Eaten planets stay eaten and are not installed; a failed install also stays eaten.
    let planet = 0;
    for (const e of this.entities) if (e.spec.kind === 'planet') { e.eaten = eatenPlanets.includes(planet); planet++; }
    for (const e of this.entities) if (!e.eaten) this.install(e);
  }
  /** The planet index (0–11) of a planet entity. */
  planetIndex(e: Entity) { return this.entities.filter(other => other.spec.kind === 'planet').indexOf(e); }
  /** The player's size at the last step (the respawn time of a hunter of that size). */
  private stage = 0;
  consume(e: Entity) {
    e.eaten = true; e.mode = 'calm'; e.modeTime = 0; e.combat = null;
    const [lo, hi] = e.spec.hunts.includes(this.stage) ? HUNTER_RESPAWN_TIME : RESPAWN_TIME;
    // Planets and alphas never come back (an alpha's defeat unlocks its part: it is gone for the run).
    e.respawn = e.spec.kind === 'planet' || e.spec.alpha ? -1 : lo + this.rand() * (hi - lo);
  }

  /** The end of the faint give-up window (D27); world time. */
  giveUpUntil = -Infinity;
  /** After a faint (spec §10.3, D27): every creature hunting the player gives up (`return`), and no creature acquires the player for
   *  `seconds` (a calm hunter near the wake-up point waits too). */
  giveUpAll(now: number, seconds: number): void {
    this.giveUpUntil = now + seconds;
    for (const e of this.entities) if (e.mode === 'hunt' || e.mode === 'angry') this.setMode(e, 'return');
    for (const e of this.entities) e.returnUntil = Math.max(e.returnUntil, this.giveUpUntil);
  }
  /** True inside the faint give-up window (D27). The combat AI reads it as `hostile: false` for alphas (T16 wires it into aiTick). */
  givingUp(now: number): boolean { return now < this.giveUpUntil; }
  /** The roaming bound of an entity's tier: tighter for hunters. */
  private boundsOf(e: Entity) { return (isHunter(e.spec) ? this.hunterBounds : this.bounds)[e.spec.tier]!; }
  /** Moves the entity (and its home) to the nearest legal pose within 4 body lengths, or removes it until a retry. */
  private install(e: Entity): boolean {
    if (isStatic(e)) return true;
    const actor = this.actors.get(e)!, tier = e.spec.tier;
    e.lastKnownHull = null;
    const found = findRecoveryPose(actor, { x: e.x, y: e.y, z: e.z }, { queries: this.queries[tier]!, bounds: this.boundsOf(e), orientation: O0, time: 0 }, { maxDistance: 4 * actor.bodyLength });
    if (!found.ok) { e.eaten = true; e.respawn = INSTALL_RETRY; e.mode = 'calm'; e.modeTime = 0; this.installFailures++; return false; }
    e.x = e.hx = found.position.x; e.y = e.hy = found.position.y; e.z = e.hz = found.position.z;
    e.groundOffset = e.y - seabedHeight(e.x, e.z);
    return true;
  }

  step(ctx: EcoContext): EcoEvent[] {
    const events: EcoEvent[] = []; this.stage = ctx.stage;
    for (const e of this.entities) {
      // An alpha is present only while the player's size is its own and its reward part is locked (spec §10.4); back at its lair, fresh.
      if (e.spec.alpha) {
        const present = ctx.stage === e.spec.alpha.size && !ctx.unlocked.includes(e.spec.alpha.rewardPartId);
        if (!present) { if (!e.eaten) { e.eaten = true; e.combat = null; this.setMode(e, 'calm'); } e.respawn = -1; e.active = false; continue; }
        if (e.eaten) {
          const lair = lairOf(this.seed, e);
          Object.assign(e, lair, { hx: lair.x, hy: lair.y, hz: lair.z, groundOffset: lair.y - seabedHeight(lair.x, lair.z), hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm' as Mode, modeTime: 0, combat: null, ...pursuitState() });
          if (!this.install(e)) continue;
        }
      }
      const relevant = Math.abs(e.spec.tier - ctx.stage) <= 1;
      if (e.eaten) { e.active = relevant; this.tickRespawn(e, ctx); continue; }
      e.modeTime += ctx.dt;
      if (!relevant) {
        // Far tiers keep their ambient motion only, with no checks; they never notice or touch the player.
        e.active = false;
        if (e.mode !== 'calm') this.setMode(e, 'calm');
        this.ambient(e, ctx, this.disp);
        e.x += this.disp.x; e.y += this.disp.y; e.z += this.disp.z;
        if (movement(e.spec.movementProfileId).mode === 'ground' && e.spec.tier < 4) e.y = seabedHeight(e.x, e.z) + e.groundOffset;
        const half = this.boundsOf(e).half; e.x = Math.max(-half, Math.min(half, e.x)); e.z = Math.max(-half, Math.min(half, e.z));
        continue;
      }
      if (!e.active) { e.active = true; if (!this.install(e)) continue; }
      const perceived = this.think(e, ctx);
      this.move(e, ctx, perceived);
      if (!e.eaten) this.hazard(e, ctx, events);
    }
    return events;
  }

  private perceives(e: Entity, ctx: EcoContext, distance: number): boolean {
    return ctx.perceivable && distance <= noticeRadius(e, ctx.stage, ctx.stealthFactor) && this.lineOfSight(e, ctx.player);
  }
  private readonly eye: MutVec3 = { x: 0, y: 0, z: 0 };
  /** Line of sight (spec §11.2, review I9) from the entity's hull centre to a point: the visibility query and a clear segment (terrain and
   *  reef solids of its tier, sampled every half tier unit). Perception (acquisition) and the combat AI (an eel's den) use it. */
  lineOfSight(e: Entity, p: Vec3): boolean {
    const q = this.queries[e.spec.tier]!, c = this.actors.get(e)!.hull[0]!.start, eye = this.eye;
    eye.x = e.x + c.x; eye.y = e.y + c.y; eye.z = e.z + c.z;
    return q.visibility(eye, p) > 0 && (q.segmentClear ? q.segmentClear(eye, p, .5 * SIZES[e.spec.tier]!) : terrainSegmentClear(q, eye, p, .5 * SIZES[e.spec.tier]!));
  }

  /** Mode changes (spec §10 pursuit, today's prey flee). Returns whether the entity perceives the player. */
  private think(e: Entity, ctx: EcoContext): boolean {
    const spec = e.spec, now = ctx.now, p = ctx.player;
    const distance = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z), perceived = this.perceives(e, ctx, distance);
    // An alpha has no pursuit (T14/T16 carry): its lair is its leash and its AI decides (the combat world mirrors the AI state into `mode`).
    // So no acquisition, no give-up, and no full heal on a return to calm (it heals by the lair reset, D37).
    if (spec.alpha) return perceived;
    if (e.mode === 'hunt' || e.mode === 'angry') {
      if (perceived) remember(e, p, now, ctx.playerHull);
      this.updateReachability(e, now);
      const policy = this.pursuitFor?.(e) ?? pursuit(spec.pursuitId), L = this.actors.get(e)!.bodyLength;
      const giveUp = Math.hypot(e.x - e.hx, e.y - e.hy, e.z - e.hz) > policy.leashBodyLengths * L
        || distance > policy.giveUpBodyLengths * L
        || (!perceived && now - e.lastSeenAt > policy.memorySeconds)
        || (perceived && !e.reachable && e.blockedSince !== null && now - e.blockedSince > policy.blockedWaitSeconds + policy.memorySeconds)
        || pastSoftEdge(p, ctx.stage);
      if (giveUp) { this.setMode(e, 'return'); e.returnUntil = now + policy.reacquireSeconds; }
      return perceived;
    }
    if (e.mode === 'flee') { if (e.modeTime > 2.5) this.setMode(e, 'calm'); return perceived; }
    if (e.mode === 'return' && (Math.hypot(e.x - e.hx, e.z - e.hz) <= this.actors.get(e)!.bodyLength || now >= e.returnUntil + 6)) {
      this.setMode(e, 'calm');
      if (spec.behaviourId) e.hp = spec.hp;   // a combat species back to calm gets its full HP (spec §11.2, D37)
    }
    // Acquire, from calm or return, once the reacquire window has passed.
    if (now >= e.returnUntil && perceived && spec.hunts.includes(ctx.stage) && !pastSoftEdge(p, ctx.stage)) {
      this.setMode(e, 'hunt'); clearBlocked(e); remember(e, p, now, ctx.playerHull); this.updateReachability(e, now); return perceived;
    }
    if (e.mode !== 'calm' || !ctx.perceivable) return perceived;
    // Prey runs from a player that can eat it, but tires quickly so it can be caught.
    // Combat species flee by their AI (combat-ai.ts), not by today's prey rule.
    const size = SIZES[spec.tier]!, prey = !spec.behaviourId && spec.tier <= ctx.stage && ['skittish', 'school'].includes(spec.behavior);
    if (prey && e.modeTime > 1.5 && distance < 7 * Math.max(size, SIZES[ctx.stage]!) * ctx.stealthFactor) this.setMode(e, 'flee');
    return perceived;
  }

  /** Can the entity touch the remembered target from a pose its movement can hold? Updates the blocked timer. */
  updateReachability(e: Entity, now: number) {
    const known = e.lastKnown;
    if (!known) return;
    const actor = this.actors.get(e)!, q = this.queries[e.spec.tier]!, t = q.terrain, mode = movement(e.spec.movementProfileId).mode, pose = this.pose;
    pose.x = known.x; pose.y = known.y; pose.z = known.z;
    if ((mode === 'ground' || mode === 'burrow' || e.spec.behavior === 'still') && !t.space) pose.y = supportHeight(actor, known.x, known.z, O0, t) + .01 * actor.bodyLength;
    else if (mode === 'surface') pose.y = e.hy;
    const actx = this.actx; actx.time = now; actx.bounds = this.boundsOf(e);
    const R = entityRadius(e), hull = e.lastKnownHull;
    const touch = hull ? touches(pose, R, hull) : Math.hypot(pose.x - known.x, pose.y - known.y, pose.z - known.z) <= R;
    e.reachable = touch && q.overlapHull(actor, pose, O0, actx).ok;
    if (!e.reachable) { e.blockedSince ??= now; e.reachableSince = null; return; }
    e.reachableSince ??= now;
    if (now - e.reachableSince >= BLOCK_CLEAR_SECONDS) e.blockedSince = null;
  }

  private setMode(e: Entity, mode: Mode) { e.mode = mode; e.modeTime = 0; }

  /** Desired displacement toward a point; ground and surface movers steer horizontally. */
  private toward(e: Entity, x: number, y: number, z: number, speed: number, dt: number, mode: MovementMode, out: MutVec3) {
    const dx = x - e.x, dy = mode === 'ground' || mode === 'surface' ? 0 : y - e.y, dz = z - e.z, length = Math.hypot(dx, dy, dz);
    out.x = 0; out.y = 0; out.z = 0;
    if (length < 1e-4) return;
    const step = Math.min(length, speed * dt);
    out.x = dx / length * step; out.y = dy / length * step; out.z = dz / length * step;
    if (Math.hypot(dx, dz) > 1e-4) e.heading = Math.atan2(dx, dz);
  }

  /** A combat species moves by its AI intent, its lunge and its knockback through resolveMotion (spec §5.12); a held one goes to the claw
   *  point; a snap (an emerge) stands it on an admitted pose near the point. A refused motion keeps the last pose. */
  private combatMove(e: Entity, ctx: EcoContext, m: EntityMotion) {
    const spec = e.spec, size = SIZES[spec.tier]!, mode = movement(spec.movementProfileId).mode, d = this.disp, dt = ctx.dt, actor = this.actors.get(e)!, q = this.queries[spec.tier]!;
    d.x = 0; d.y = 0; d.z = 0; m.moved = 0;
    if (m.snap) {
      const ground = mode === 'ground' && !q.terrain.space, at = { x: m.snap.x, y: ground ? supportHeight(actor, m.snap.x, m.snap.z, O0, q.terrain) + .01 * actor.bodyLength : m.snap.y, z: m.snap.z };
      const found = findRecoveryPose(actor, at, { queries: q, bounds: this.boundsOf(e), orientation: O0, time: ctx.now }, { maxDistance: actor.bodyLength });
      if (found.ok) { m.moved = Math.hypot(found.position.x - e.x, found.position.y - e.y, found.position.z - e.z); e.x = found.position.x; e.y = found.position.y; e.z = found.position.z; }
      return;
    }
    if (m.held) { d.x = m.held.x; d.y = m.held.y; d.z = m.held.z; }
    else if (!m.frozen) {
      const it = m.intent, speed = spec.speed * size;
      // A hunter that gave up (`return`) walks home at .7 × its speed, as the legacy return does (T16a review I1); else today's ambient motion.
      if (it.kind === 'ambient' && e.mode === 'return') this.toward(e, e.hx, e.hy, e.hz, speed * .7, dt, mode, d);
      else if (it.kind === 'ambient') { this.ambient(e, ctx, d); d.x *= it.speedFactor; d.y *= it.speedFactor; d.z *= it.speedFactor; }
      else if (it.kind === 'toward') this.toward(e, it.point.x, it.point.y, it.point.z, speed * it.speedFactor, dt, mode, d);
      else if (it.kind === 'away') this.toward(e, 2 * e.x - it.point.x, 2 * e.y - it.point.y, 2 * e.z - it.point.z, speed * it.speedFactor, dt, mode, d);
      else if (m.face) { const fx = m.face.x - e.x, fz = m.face.z - e.z; if (Math.hypot(fx, fz) > 1e-4) e.heading = Math.atan2(fx, fz); }
      if (m.lunge) { d.x += m.lunge.x * dt; d.y += (mode === 'ground' ? 0 : m.lunge.y) * dt; d.z += m.lunge.z * dt; }
      d.x += m.external.x * dt; d.y += m.external.y * dt; d.z += m.external.z * dt;
    }
    if (m.separation && !m.held) { d.x += m.separation.x; d.y += m.separation.y; d.z += m.separation.z; }
    if (mode === 'ground' && !q.terrain.space) d.y = supportHeight(actor, e.x + d.x, e.z + d.z, O0, q.terrain) + .01 * actor.bodyLength - e.y;
    else if (mode === 'surface') d.y = e.hy - e.y;
    const req = this.req, from = this.from;
    from.x = e.x; from.y = e.y; from.z = e.z;
    req.actorId = actor.id; req.hull = actor.hull; req.habitatProfileId = actor.habitat.id; req.cause = m.held ? 'grab' : m.lunge ? 'lunge' : m.external.x || m.external.y || m.external.z ? 'knockback' : 'locomotion';
    const mo = this.motion; mo.queries = q; mo.bounds = this.boundsOf(e); mo.actor = actor; mo.interval.start = ctx.now; mo.interval.end = ctx.now + dt;
    const result = resolveMotion(req, mo); req.cause = 'locomotion';
    if (result.status === 'invalid-start' || result.status === 'needs-recovery') { this.install(e); return; }
    m.moved = Math.hypot(result.position.x - e.x, result.position.y - e.y, result.position.z - e.z);
    e.x = result.position.x; e.y = result.position.y; e.z = result.position.z;
    if (!m.frozen) {
      const pe = projectVelocity(m.external, result.contacts), decay = Math.exp(-ENTITY_EXTERNAL_DECAY * dt);
      m.external.x = pe.x * decay; m.external.y = pe.y * decay; m.external.z = pe.z * decay;
    }
  }

  private move(e: Entity, ctx: EcoContext, perceived: boolean) {
    const spec = e.spec;
    if (spec.behavior === 'still' || isStatic(e)) return;
    if (e.combat) { this.combatMove(e, ctx, e.combat); return; }
    const size = SIZES[spec.tier]!, mode = movement(spec.movementProfileId).mode, d = this.disp, p = ctx.player, dt = ctx.dt;
    switch (e.mode) {
      case 'hunt': case 'angry': {
        const target = perceived || !e.lastKnown ? p : e.lastKnown;
        this.toward(e, target.x, target.y, target.z, spec.speed * size * (e.mode === 'angry' ? 1.15 : 1), dt, mode, d); break;
      }
      case 'flee': {
        const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
        this.toward(e, e.x - dx, e.y - (follows(e) ? 0 : dy * .3), e.z - dz, spec.speed * size * 1.25, dt, mode, d); break;
      }
      case 'return': this.toward(e, e.hx, e.hy, e.hz, spec.speed * size * .7, dt, mode, d); break;
      default: this.ambient(e, ctx, d);
    }
    const actor = this.actors.get(e)!, q = this.queries[spec.tier]!;
    if (mode === 'ground' && !q.terrain.space) d.y = supportHeight(actor, e.x + d.x, e.z + d.z, O0, q.terrain) + .01 * actor.bodyLength - e.y;
    else if (mode === 'surface') d.y = e.hy - e.y;
    const req = this.req, from = this.from;
    from.x = e.x; from.y = e.y; from.z = e.z;
    req.actorId = actor.id; req.hull = actor.hull; req.habitatProfileId = actor.habitat.id;
    const m = this.motion; m.queries = q; m.bounds = this.boundsOf(e); m.actor = actor; m.interval.start = ctx.now; m.interval.end = ctx.now + dt;
    const result = resolveMotion(req, m);
    if (result.status === 'invalid-start' || result.status === 'needs-recovery') { this.install(e); return; }
    e.x = result.position.x; e.y = result.position.y; e.z = result.position.z;
  }

  /** Today's ambient motion, as a displacement. */
  private ambient(e: Entity, ctx: EcoContext, out: MutVec3) {
    const size = SIZES[e.spec.tier]!, kind = e.spec.kind, now = ctx.now;
    out.x = 0; out.y = 0; out.z = 0;
    switch (e.spec.behavior) {
      case 'drift': case 'school': case 'flyer': {
        const rate = kind === 'plane' ? .18 : .22, t = now * rate + e.phase;
        const tx = e.hx + Math.sin(t) * size * (e.spec.behavior === 'flyer' ? 1.6 : .75), tz = e.hz + Math.cos(t) * size * (e.spec.behavior === 'flyer' ? 1.2 : .55);
        const ty = e.hy + Math.sin(now * .6 + e.phase) * size * .12;
        // Ease back onto the loop after a chase instead of jumping.
        const k = 1 - Math.exp(-ctx.dt * 2.5);
        out.x = (tx - e.x) * k; out.y = (ty - e.y) * k; out.z = (tz - e.z) * k;
        e.heading = Math.atan2(Math.cos(t), -Math.sin(t) * .73); break;
      }
      case 'graze': case 'skittish': {
        e.heading += Math.sin(now * .7 + e.phase * 3) * ctx.dt * 1.2;
        const away = Math.hypot(e.x - e.hx, e.z - e.hz);
        if (away > size * 5) e.heading = Math.atan2(e.hx - e.x, e.hz - e.z);
        const speed = e.spec.speed * size * .35;
        out.x = Math.sin(e.heading) * speed * ctx.dt; out.z = Math.cos(e.heading) * speed * ctx.dt;
        if (!follows(e)) out.y = (e.hy + Math.sin(now * .8 + e.phase) * size * .3 - e.y) * (1 - Math.exp(-ctx.dt));
        break;
      }
      default: break;
    }
  }

  /** Contact hazards with cadence, from the shared touch rule. */
  private hazard(e: Entity, ctx: EcoContext, events: EcoEvent[]) {
    const id = e.spec.contactHazardId;
    if (!id) return;
    const engaged = e.mode === 'hunt' || e.mode === 'angry';
    if ((!engaged && !e.spec.stingsStages.includes(ctx.stage)) || ctx.now < e.hazardReadyAt) return;
    const R = entityRadius(e);
    let best = Infinity, px = 0, py = 0, pz = 0;
    for (const c of ctx.playerHull) {
      const slack = segmentDistance(e, c.start, c.end) - (R + c.radius);
      if (slack <= 0 && slack < best) { best = slack; px = closest.x; py = closest.y; pz = closest.z; }
    }
    if (best === Infinity) return;
    const hazard = HAZARDS[id]!;
    e.hazardReadyAt = ctx.now + hazard.cadenceSeconds;
    const nx = px - e.x, ny = py - e.y, nz = pz - e.z, nl = Math.hypot(nx, ny, nz);
    const normal = nl < 1e-6 ? { x: 0, y: 1, z: 0 } : { x: nx / nl, y: ny / nl, z: nz / nl };
    // The engaged bonus is in half-hearts too: 2 × max(0, tier − stage) (spec §4.2).
    events.push({ type: 'hazard', entity: e, hazard, damage: hazard.damage + (engaged ? 2 * Math.max(0, e.spec.tier - ctx.stage) : 0), point: { x: px, y: py, z: pz }, normal, time: ctx.now });
  }

  private tickRespawn(e: Entity, ctx: EcoContext) {
    if (e.respawn < 0 || e.spec.tier > 3) return;
    e.respawn -= ctx.dt; if (e.respawn > 0) return;
    // New food arrives out of sight, so the world never visibly pops.
    // Plants, palms and lighthouses grow back where they were.
    const size = SIZES[e.spec.tier]!, away = 16 * size, fresh = { hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm' as Mode, modeTime: 0, combat: null, ...pursuitState() };
    if (e.spec.behavior === 'still') {
      if (Math.hypot(e.hx - ctx.player.x, e.hz - ctx.player.z) < away) { e.respawn = 0; return; }
      Object.assign(e, { x: e.hx, y: e.hy, z: e.hz }, fresh); this.install(e); return;
    }
    const tier = e.spec.tier, point = spawnPoint(e.spec, this.biomes[tier]!, this.rand, { x: ctx.player.x, z: ctx.player.z, radius: away }, (x, y, z) => inReef(this.seed)(tier, x, y, z));
    Object.assign(e, { x: point.x, y: point.y, z: point.z, hx: point.x, hy: point.y, hz: point.z, groundOffset: point.y - seabedHeight(point.x, point.z) }, fresh);
    this.install(e);
  }
}
