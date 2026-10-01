// Creature behavior for every tier. Positions are physical units (stage 0 units).
// Active tiers (|tier − stage| ≤ 1) move through the motion resolver, perceive, pursue (spec §10) and emit contact hazards.
// Every entry path (construction, reset, respawn, becoming relevant) installs an entity on a legal pose.
import { makeBiomes, populate, seabedHeight, SIZES, spawnPoint, WORLD_HALF, random, type Biome } from './biomes';
import type { Actor, AdmissionContext, Capsule, ContactHazard, LegalityContext, MotionRequest, MovementMode, MutVec3, Orientation, PursuitPolicy, Vec3, WorldQueries } from './combat-types';
import { findRecoveryPose, resolveMotion } from './motion';
import { speciesActor } from './mount';
import { habitat, movement, pursuit } from './profiles';
import { HAZARDS } from './registries';
import type { Species } from './species';
import { makeTerrain, makeWorldQueries, supportHeight } from './world-queries';

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
}
export interface EcoContext {
  stage: number; dt: number; now: number;
  player: Vec3;
  /** The player's hull in world space, already oriented and translated. */
  playerHull: readonly Capsule[];
  /** False while the player can not be noticed (menu, evolving, fainted). */
  perceivable: boolean; stealthFactor: number;
}
/** Damage acceptance is not decided here; the damage resolution accepts or rejects every event. */
export interface EcoEvent { type: 'hazard'; entity: Entity; hazard: ContactHazard; damage: number; point: Vec3; normal: Vec3; time: number }

export const RESPAWN_TIME = [14, 22] as const;
/** Seconds of continuous reachability that clear the blocked timer. */
export const BLOCK_CLEAR_SECONDS = 1;
/** Seconds before an entity that could not be installed tries again. */
const INSTALL_RETRY = 2;

const pursuitState = () => ({ lastKnown: null, lastKnownHull: null, lastSeenAt: 0, reachable: false, reachableSince: null, blockedSince: null, returnUntil: 0, hazardReadyAt: 0 });

export function makeEntities(seed: number): Entity[] {
  return populate(seed).map(spawn => ({
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
    else { const sea = makeWorldQueries(makeTerrain(0)), space = makeWorldQueries(makeTerrain(4)); this.queries = SIZES.map((_, tier) => tier === 4 ? space : sea); }
    this.bounds = SIZES.map(size => ({ half: WORLD_HALF * size }));
    for (const e of this.entities) { this.actors.set(e, speciesActor(e)); owners.set(e, this); this.install(e); }
  }
  /** Restores a run: planets already eaten stay eaten, everything else is fresh. */
  reset(eatenPlanets: readonly number[]) {
    const fresh = makeEntities(this.seed);
    this.entities.forEach((e, i) => Object.assign(e, fresh[i]!));
    // Eaten planets stay eaten and are not installed; a failed install also stays eaten.
    let planet = 0;
    for (const e of this.entities) if (e.spec.kind === 'planet') { e.eaten = eatenPlanets.includes(planet); planet++; }
    for (const e of this.entities) if (!e.eaten) this.install(e);
  }
  /** The planet index (0–11) of a planet entity. */
  planetIndex(e: Entity) { return this.entities.filter(other => other.spec.kind === 'planet').indexOf(e); }
  consume(e: Entity) {
    e.eaten = true; e.mode = 'calm'; e.modeTime = 0;
    e.respawn = e.spec.kind === 'planet' ? -1 : RESPAWN_TIME[0] + this.rand() * (RESPAWN_TIME[1] - RESPAWN_TIME[0]);
  }

  /** Moves the entity (and its home) to the nearest legal pose within 4 body lengths, or removes it until a retry. */
  private install(e: Entity): boolean {
    if (isStatic(e)) return true;
    const actor = this.actors.get(e)!, tier = e.spec.tier;
    e.lastKnownHull = null;
    const found = findRecoveryPose(actor, { x: e.x, y: e.y, z: e.z }, { queries: this.queries[tier]!, bounds: this.bounds[tier]!, orientation: O0, time: 0 }, { maxDistance: 4 * actor.bodyLength });
    if (!found.ok) { e.eaten = true; e.respawn = INSTALL_RETRY; e.mode = 'calm'; e.modeTime = 0; this.installFailures++; return false; }
    e.x = e.hx = found.position.x; e.y = e.hy = found.position.y; e.z = e.hz = found.position.z;
    e.groundOffset = e.y - seabedHeight(e.x, e.z);
    return true;
  }

  step(ctx: EcoContext): EcoEvent[] {
    const events: EcoEvent[] = [];
    for (const e of this.entities) {
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
        const half = WORLD_HALF * SIZES[e.spec.tier]!; e.x = Math.max(-half, Math.min(half, e.x)); e.z = Math.max(-half, Math.min(half, e.z));
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
    return ctx.perceivable && distance <= noticeRadius(e, ctx.stage, ctx.stealthFactor) && this.queries[e.spec.tier]!.visibility(e, ctx.player) > 0;
  }

  /** Mode changes (spec §10 pursuit, today's prey flee). Returns whether the entity perceives the player. */
  private think(e: Entity, ctx: EcoContext): boolean {
    const spec = e.spec, now = ctx.now, p = ctx.player;
    const distance = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z), perceived = this.perceives(e, ctx, distance);
    if (e.mode === 'hunt' || e.mode === 'angry') {
      if (perceived) remember(e, p, now, ctx.playerHull);
      this.updateReachability(e, now);
      const policy = this.pursuitFor?.(e) ?? pursuit(spec.pursuitId), L = this.actors.get(e)!.bodyLength;
      const giveUp = Math.hypot(e.x - e.hx, e.y - e.hy, e.z - e.hz) > policy.leashBodyLengths * L
        || distance > policy.giveUpBodyLengths * L
        || (!perceived && now - e.lastSeenAt > policy.memorySeconds)
        || (perceived && !e.reachable && e.blockedSince !== null && now - e.blockedSince > policy.blockedWaitSeconds + policy.memorySeconds);
      if (giveUp) { this.setMode(e, 'return'); e.returnUntil = now + policy.reacquireSeconds; }
      return perceived;
    }
    if (e.mode === 'flee') { if (e.modeTime > 2.5) this.setMode(e, 'calm'); return perceived; }
    if (e.mode === 'return' && (Math.hypot(e.x - e.hx, e.z - e.hz) <= this.actors.get(e)!.bodyLength || now >= e.returnUntil + 6)) this.setMode(e, 'calm');
    // Acquire, from calm or return, once the reacquire window has passed.
    if (now >= e.returnUntil && perceived && spec.hunts.includes(ctx.stage)) {
      this.setMode(e, 'hunt'); clearBlocked(e); remember(e, p, now, ctx.playerHull); this.updateReachability(e, now); return perceived;
    }
    if (e.mode !== 'calm' || !ctx.perceivable) return perceived;
    // Prey runs from a player that can eat it, but tires quickly so it can be caught.
    const size = SIZES[spec.tier]!, prey = spec.tier <= ctx.stage && ['skittish', 'school'].includes(spec.behavior);
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
    const actx = this.actx; actx.time = now; actx.bounds = this.bounds[e.spec.tier];
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

  private move(e: Entity, ctx: EcoContext, perceived: boolean) {
    const spec = e.spec;
    if (spec.behavior === 'still' || isStatic(e)) return;
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
    const m = this.motion; m.queries = q; m.bounds = this.bounds[spec.tier]; m.actor = actor; m.interval.start = ctx.now; m.interval.end = ctx.now + dt;
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
    events.push({ type: 'hazard', entity: e, hazard, damage: hazard.damage + (engaged ? Math.max(0, e.spec.tier - ctx.stage) : 0), point: { x: px, y: py, z: pz }, normal, time: ctx.now });
  }

  private tickRespawn(e: Entity, ctx: EcoContext) {
    if (e.respawn < 0 || e.spec.tier > 3) return;
    e.respawn -= ctx.dt; if (e.respawn > 0) return;
    // New food arrives out of sight, so the world never visibly pops.
    // Plants, palms and lighthouses grow back where they were.
    const size = SIZES[e.spec.tier]!, away = 16 * size, fresh = { hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm' as Mode, modeTime: 0, ...pursuitState() };
    if (e.spec.behavior === 'still') {
      if (Math.hypot(e.hx - ctx.player.x, e.hz - ctx.player.z) < away) { e.respawn = 0; return; }
      Object.assign(e, { x: e.hx, y: e.hy, z: e.hz }, fresh); this.install(e); return;
    }
    const point = spawnPoint(e.spec, this.biomes[e.spec.tier]!, this.rand, { x: ctx.player.x, z: ctx.player.z, radius: away });
    Object.assign(e, { x: point.x, y: point.y, z: point.z, hx: point.x, hy: point.y, hz: point.z, groundOffset: point.y - seabedHeight(point.x, point.z) }, fresh);
    this.install(e);
  }
}
