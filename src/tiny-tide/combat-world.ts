// The combat world (spec §3.1): it owns the combat state of entities and runs one combat tick — the player's moves from the intent, the
// action clocks, the action engine, world shapes, hit requests, the resolver, holds and kills. Pure: positions are read from the bodies it
// is given; it never moves a body (combat motion goes to the player step and the ecosystem as requests).
import * as T from 'three';
import { advanceClock, bufferedPress, bufferPress, canStart, dashSpeed, endHold, endNow, holdingAction, liveActions, lungeSpeed, newPoise, startAction, sweepEnded, tickAction, windupLength, type PoiseMeter, type StartRefusal } from './action-engine';
import { BEHAVIOURS, hostileSizes, SPECIES_ATTACKS, type SpeciesBehaviour } from './bestiary';
import { SIZES } from './biomes';
import { aiLandedHit, aiRefused, aiStarted, aiStep, newAiState, ROAR_SECONDS, schoolFlee, type AiInput, type AiState } from './combat-ai';
import { actionShapes, aimFrame, crossingOk, hurtboxesHit, nearestTargets, obstructionClear, shapeCentroid, telegraphDescriptor, truncateCapsule, worldShape, type TelegraphDescriptor } from './combat-shapes';
import { newRuntime, type ActionPhase, type TelegraphProfile, type ActionState, type ActiveSlot, type ActorId, type AttackShape, type AttackSpec, type CombatInput, type CombatPose, type CombatRuntime, type EmitterSource, type MovementMode, type MutVec3, type ResolvedMove, type Vec3, type WorldQueries, type WorldShape } from './combat-types';
import { engage, provoke, type Entity, type EntityMotion } from './ecosystem';
import { biteDispatch } from './feeding';
import { addBreakProgress, armCounters, isFlick, releaseHold, resolveAll, squeezesDue, type CombatEvent, type Fighter, type HitRequestIn } from './hit-resolver';
import { basicRequested } from './input';
import { speciesActor, speciesCombatPose, speciesHullSphereInto } from './mount';
import { speciesMove, type GrantedMove, type MoveSet, type SlotAssignment } from './moves';
import { forwardOf, orientationMatrix } from './orientation';
import type { Diet } from './parts';
import type { CombatMotion } from './player-motion';
import { EFFECTS, TELEGRAPHS } from './combat-profiles';
import { damageAfterArmor } from './state';
import { Director, MAX_EXTENSION, RETRY_SECONDS, spacedExtension } from './director';

export const PLAYER_ID: ActorId = 'player';
export const entityActorId = (e: { id: number }): ActorId => `e${e.id}`;
/** Speed factors (spec §5.12): holding a grab, staggered. The claw point is the shape origin plus CLAW_REACH × L_t along the aim. */
export const HOLDING_SPEED = .6, STAGGERED_SPEED = .5, CLAW_REACH = .5;
/** How many hit outcomes the diagnostics keep. */
export const EVENT_LOG = 20;
/** Review R3 (amends spec §5.4): a species aim never pitches more than this (radians), ground species included. */
export const AIM_PITCH_LIMIT = .6;
/** Review R17: a species that made contact with the player (any outcome) in the last ENGAGED_SECONDS (world time) is engaged with it. */
export const ENGAGED_SECONDS = 3;

/** `lastAttackedPlayerAt`: world time of the last event in which this species made contact with the player, any outcome (hit, blocked,
 *  evaded, countered…; review R17 engagement). `tokenRetryAt`: world time before which a new wind-up at the player is refused (a refused
 *  token or a wind-up the director ended; spec §9.4: ask again after RETRY_SECONDS). `ai`: its state machine (combat-ai.ts), created at
 *  its first AI tick. `immuneUntil`: no stagger before this world time (an alpha's roar, ROAR_SECONDS). */
export interface EntityCombat { id: ActorId; entity: Entity; rt: CombatRuntime; poise: PoiseMeter; behaviour: SpeciesBehaviour; maxHp: number; lastDamagedAt: number; lastAttackedPlayerAt: number; tokenRetryAt: number;
  ai: AiState | null; immuneUntil: number }
/** What the AI tick reads (spec §11.2). `hitBy`: entity ids the player damaged this tick (provocation, the AI's `hit`). `isOnScreen`: a physical
 *  point is on screen (the director's off-screen rule; main.ts tests it against the camera each frame, headless callers pass a fixed answer).
 *  `lineOfSight`: the ecosystem's perception test (review I9: visibility and a clear segment). `givingUp`: inside the faint give-up window
 *  (D27): no species is hostile (prey fighters and alphas included) and engaged hunters get the give-up pursuit. */
export interface AiTickContext {
  now: number; dt: number; stage: number; runSeed: number; entities: readonly Entity[]; player: PlayerBody; playing: boolean; stealthFactor: number;
  hitBy: ReadonlySet<number>; isOnScreen(p: Vec3): boolean; lineOfSight(e: Entity, p: Vec3): boolean; givingUp: boolean;
}
/** Engagements that ended with the player alive (the survivor bonus check), roars (a ring flash and a hint) and hunters that noticed the
 *  player (the "!" marker). */
export interface AiTickResult { engagements: { entity: Entity; seconds: number; windups: number }[]; roars: Entity[]; markers: Entity[] }
/** A species start's options. `targetAt`: the target's hurtbox centre (see startSpecies). `onScreen`: the shape's centroid is on screen;
 *  `playerHeld`: the player is in a hold (spec §9.4). `playing`: start rule 1. `tick`: the combat tick length (plan review R6: the action's
 *  clock starts on the next tick, so the director's estimate adds one). `onScreen`, `playerHeld` and `tick` are required for an attack on
 *  the player (else 'no-context'). */
export interface SpeciesStartOptions { targetAt?: Vec3 | null; onScreen?: boolean; playerHeld?: boolean; playing?: boolean; tick?: number }
/** The player's body this tick (physical units). `health` is in hearts; the combat world writes it back to the run. */
export interface PlayerBody {
  rt: CombatRuntime; position: Vec3; centre: Vec3; L: number; mass: number; knockbackResistance: number; armor: number;
  ground: boolean; mode: MovementMode; inBreachArc: boolean; health: number; pose: CombatPose;
}
/** What `playerMotion` reads of the body (no combat pose: the sim samples that once per frame, after the step, for the tick). */
export type MotionBody = Pick<PlayerBody, 'rt' | 'centre' | 'L'>;
export interface CombatContext {
  now: number; dt: number;
  /** The game mode is `playing` (start rule 1 for the player). */
  playing: boolean;
  intent: CombatInput;
  /** The camera-mapped move wish (Dash direction) and the previous tick's stick (break-free flicks). */
  wish: Vec3; previousMove: Vec3;
  player: PlayerBody; moves: MoveSet; slots: SlotAssignment;
  entities: readonly Entity[];
  /** The player's stage, its diet (the herbivore dispatch rule, review R17) and the stage queries (crossing and obstruction). */
  stage: number; diet: Diet; queries: WorldQueries;
}
export interface CombatTick {
  events: CombatEvent[];
  /** The basic input fell back to today's chomp (no combat species in the Bite cone; spec §8.3). */
  chomp: boolean;
  /** Species at 0 HP this tick (the sim rewards and consumes them). */
  killed: Entity[];
  /** The player broke free of a hold this tick. */
  brokeFree: boolean;
  /** Moves the player started this tick (sounds, hints). */
  started: ResolvedMove['kind'][];
}
/** The player's world matrix: T(position) · Ry(yaw) · Rx(−pitch) · S(scale), the renderer's convention (orientation.ts). */
export function playerMatrix(position: Vec3, o: { yaw: number; pitch: number }, scale: number): T.Matrix4 {
  return orientationMatrix(o, new T.Matrix4()).scale(new T.Vector3(scale, scale, scale)).setPosition(position.x, position.y, position.z);
}
interface SchoolMember { entity: Entity; state: AiState; position: Vec3; L: number }
/** The centroid of the school members within `reach` of `at` (the member itself included). */
function schoolCentre(members: readonly SchoolMember[], at: Vec3, reach: number): Vec3 | undefined {
  const near = members.filter(m => Math.hypot(m.position.x - at.x, m.position.y - at.y, m.position.z - at.z) <= reach); if (!near.length) return undefined;
  return near.reduce((a, m) => ({ x: a.x + m.position.x / near.length, y: a.y + m.position.y / near.length, z: a.z + m.position.z / near.length }), { x: 0, y: 0, z: 0 });
}
const horizontal = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.z); return l > 1e-9 ? { x: v.x / l, y: 0, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
const NO_MOVE: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
/** Review R16: the Brace facing of a player with no aim (source `none`): the horizontal move wish, when the stick is pushed past .3 (the
 *  dash's own threshold); else null (the aim or the body forward). */
const braceFacing = (intent: CombatInput, wish: Vec3): Vec3 | null =>
  intent.aimSource === 'none' && Math.hypot(wish.x, wish.z) > .3 ? horizontal(wish) : null;
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
/** Review R3: the unit direction of `v` with its pitch clamped to ±AIM_PITCH_LIMIT. A vertical or zero `v` keeps the heading of `forward`. */
export function clampAimPitch(v: Vec3, forward: Vec3): Vec3 {
  const h = Math.hypot(v.x, v.z), l = Math.hypot(v.x, v.y, v.z);
  if (l < 1e-9) return horizontal(forward);
  const pitch = Math.atan2(v.y, h);
  if (Math.abs(pitch) <= AIM_PITCH_LIMIT) return { x: v.x / l, y: v.y / l, z: v.z / l };
  const heading = h > 1e-9 ? { x: v.x / h, z: v.z / h } : horizontal(forward), p = Math.sign(pitch) * AIM_PITCH_LIMIT, c = Math.cos(p);
  return { x: heading.x * c, y: Math.sin(p), z: heading.z * c };
}
/** A species start refusal: the engine's, 'no-target' (an attack on the player or a target-origin attack without the target point), or
 *  'no-context' (an attack on the player without `onScreen`, `playerHeld` and `tick`; T11 fix round 1: the caller must give real values). */
export type SpeciesRefusal = StartRefusal | 'no-target' | 'no-context';
/** What the telegraph view draws for one species action in windup or active (spec §9.1). `edgeArrow`: the profile shows an edge arrow
 *  (main.ts remembers which telegraphs went off-screen in the windup: EdgeArrowMemory). `targetsPlayer`: the action targets the player
 *  (only those play the wind-up tone). `flash`: the attacker flashes (WINDUP_FLASH at the windup start, and
 *  the profile's flash lead before active). `activeIn`: action-clock seconds to the active start (0 in active). */
export interface TelegraphView extends TelegraphDescriptor {
  actionId: string; attackerId: ActorId; entityId: number; attackId: string; phase: ActionPhase; onScreen: boolean; edgeArrow: boolean; targetsPlayer: boolean; flash: boolean;
  cue: TelegraphProfile['poseCue']; activeIn: number;
}
/** The attacker's colour flash lasts this long at the windup start (spec §9.1 item 5). */
export const WINDUP_FLASH = .1;
const statusOf = (id: string) => { const s = EFFECTS[id]?.status; return s ? { seconds: s.seconds, speedFactor: s.speedFactor } : null; };

/** The AI's light view of a species body (final review I3): its hull centre and radius, body length and forward (speciesCombatPose's). */
interface AiBody { centre: MutVec3; r: number; L: number; forward: MutVec3 }
const HULL_SPHERE = { x: 0, y: 0, z: 0, r: 0, L: 0 };
/** Writes the AI body of `e` into `b` (no allocation). */
function aiBodyInto(e: Entity, b: AiBody): AiBody {
  const s = speciesHullSphereInto(e, HULL_SPHERE);
  b.centre.x = s.x; b.centre.y = s.y; b.centre.z = s.z; b.r = s.r; b.L = s.L; b.forward.x = Math.sin(e.heading); b.forward.y = 0; b.forward.z = Math.cos(e.heading);
  return b;
}
/** Final review I3: one AI body and one AI input per combat entity, rewritten each tick (the AI copies what it keeps: `{ ...i.self.position }`,
 *  and its outputs never point at these containers). `ctx`, `e` and `p` are this tick's, for the lazy line of sight. */
interface AiScratch { body: AiBody; input: AiInput; ctx: AiTickContext | null; e: Entity | null; p: PlayerBody | null }
/** The distance from a point to a segment with no allocation: the same arithmetic as closestOnSegment and Math.hypot (bit for bit). */
function segmentDistance(c: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
  let qx = a.x, qy = a.y, qz = a.z;
  if (l2 > 0) { const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2)); qx = a.x + dx * t; qy = a.y + dy * t; qz = a.z + dz * t; }
  return Math.hypot(qx - c.x, qy - c.y, qz - c.z);
}
type ConeShape = Extract<AttackShape, { kind: 'cone' }>;
/** A player cone attack (Bite, Grab's pinch; final review I2): the apex is the player's hull centre and the range adds the centre-to-socket
 *  distance, so a creature pressed against the player (beside or under the mouth) is inside it. The half angle is the shape's. One helper for
 *  the dispatch (biteCone) and the hit test (playerShapes). */
function playerCone(p: PlayerBody, shape: ConeShape, socket: Vec3, aim: Vec3, anyDirection = false): WorldShape {
  const forward = forwardOf(p.rt.orientation);
  // Fix round 3 (re-review Important 1): the centre apex only for an aim in front of the body (its yaw within the half angle + 10° of the
  // body's, or a nearly vertical aim); else the mouth apex and the plain range, so a target behind the body is hit only after it turns.
  // The dispatch (`anyDirection`) keeps the centre apex in every direction: a press toward the rear starts a Bite that turns the body.
  const h = Math.hypot(aim.x, aim.z), off = h < .2 ? 0 : Math.abs(Math.atan2(Math.sin(Math.atan2(aim.x, aim.z) - p.rt.orientation.yaw), Math.cos(Math.atan2(aim.x, aim.z) - p.rt.orientation.yaw)));
  if (!anyDirection && off > shape.halfAngle + CENTRE_APEX_MARGIN) return worldShape(shape, aimFrame(socket, aim, forward), p.L);
  const m = Math.hypot(socket.x - p.centre.x, socket.y - p.centre.y, socket.z - p.centre.z) / p.L;
  return worldShape({ ...shape, range: shape.range + m }, aimFrame(p.centre, aim, forward), p.L);
}
/** Fix round 3: the hull-centre apex of a player cone needs the aim within its half angle plus this margin of the body's yaw. */
export const CENTRE_APEX_MARGIN = 10 * Math.PI / 180;
export class CombatWorld {
  readonly entities = new Map<number, EntityCombat>();
  /** The last EVENT_LOG hit outcomes (diagnostics). */
  readonly log: CombatEvent[] = [];
  /** Species poses sampled so far (diagnostics, review R18: at most one per live entity per tick). */
  poseSamples = 0;
  /** Attack tokens for wind-ups at the player (spec §9.4). */
  readonly director = new Director();
  private serial = 0;
  /** Review R18, final review I3: one species pose per entity while it stays put. The pose depends only on the entity's place and heading, so
   *  the cache is keyed by entity id and checked against the entity object, its position and heading: the combat tick, the AI tick, body
   *  separation and the telegraphs share one sample per entity per frame (a body the ecosystem moved is sampled again). */
  private readonly poses = new Map<number, { entity: Entity; x: number; y: number; z: number; heading: number; pose: CombatPose }>();
  constructor(private readonly behaviours: Record<string, SpeciesBehaviour> = BEHAVIOURS, private readonly attacks: Record<string, AttackSpec> = SPECIES_ATTACKS) {}
  /** A fresh state for a new run or a load (spec §13). */
  reset(): void { this.entities.clear(); this.log.length = 0; this.poses.clear(); this.director.releaseAll(); }
  /** Faint and evolve (spec §10.3, §13): every species action at the player ends, its token returns, and holds on the player end. */
  cancelAttacksOnPlayer(playerRt: CombatRuntime): void {
    for (const c of this.entities.values()) for (const a of c.rt.actions) if (a.targetId === PLAYER_ID && a.phase !== 'interrupted') { if (a.heldTarget === PLAYER_ID) endHold(c.rt, a); endNow(c.rt, a, 0); }
    this.director.releaseAll(); playerRt.heldBy = null; playerRt.breakProgress = 0;
  }
  /** The combat state of a combat species (created on first use), or null for a legacy species. */
  stateOf(e: Entity): EntityCombat | null {
    let c = this.entities.get(e.id);
    if (c && c.entity === e) return c;
    const b = e.spec.behaviourId ? this.behaviours[e.spec.behaviourId] : undefined; if (!b) return null;
    c = { id: entityActorId(e), entity: e, rt: newRuntime({ yaw: e.heading, pitch: 0 }), poise: newPoise(), behaviour: b, maxHp: e.spec.hp, lastDamagedAt: -Infinity, lastAttackedPlayerAt: -Infinity, tokenRetryAt: -Infinity,
      ai: null, immuneUntil: -Infinity };
    this.entities.set(e.id, c); return c;
  }
  /** A combat entity that respawned or was consumed starts over (its actions, clock and holds). */
  forget(e: Entity): void {
    const c = this.entities.get(e.id);
    if (c) for (const a of c.rt.actions) if (this.director.holds(a.instanceId)) { endNow(c.rt, a, 0); this.director.release(a.instanceId); }
    this.entities.delete(e.id); this.poses.delete(e.id);
  }
  /** Forgets every combat entity that was eaten on any path (T11 fix round 1); the sim calls it at the end of each frame. */
  forgetEaten(): void { for (const c of [...this.entities.values()]) if (c.entity.eaten) this.forget(c.entity); }
  private nextId(actor: ActorId) { return `${actor}#${++this.serial}`; }
  /** A species pose (review R18, final review I3): the cached one while the entity has not moved or turned, else a fresh sample (counted in
   *  `poseSamples` unless `count` is false). Callers never mutate a pose. */
  speciesPose(e: Entity, now: number, count = true): CombatPose {
    const hit = this.poses.get(e.id);
    if (hit && hit.entity === e && hit.x === e.x && hit.y === e.y && hit.z === e.z && hit.heading === e.heading) return hit.pose;
    const pose = speciesCombatPose(e, now); if (count) this.poseSamples++;
    if (hit) { hit.entity = e; hit.x = e.x; hit.y = e.y; hit.z = e.z; hit.heading = e.heading; hit.pose = pose; }
    else this.poses.set(e.id, { entity: e, x: e.x, y: e.y, z: e.z, heading: e.heading, pose });
    return pose;
  }
  private poseOf(e: Entity, now: number): CombatPose { return this.speciesPose(e, now); }
  private readonly aiScratch = new WeakMap<EntityCombat, AiScratch>();
  private aiScratchOf(c: EntityCombat): AiScratch {
    let sc = this.aiScratch.get(c); if (sc) return sc;
    const v = (): MutVec3 => ({ x: 0, y: 0, z: 0 }), cooldownPrefix = `${c.id}:root:`;
    const scratch: AiScratch = { body: { centre: v(), r: 0, L: 0, forward: v() }, ctx: null, e: null, p: null, input: {
      now: 0, self: { position: v(), L: 0, forward: v(), hp: 0, maxHp: 0, staggered: false, held: false, busy: false, speed: 0 },
      player: { position: v(), d: 0, get visible() { return scratch.ctx!.lineOfSight(scratch.e!, scratch.p!.centre); }, targetable: false, ground: false },
      hostile: false, pursuit: 'calm', hit: false, fleeDistance: 0, ready: id => (c.rt.cooldowns.get(cooldownPrefix + id) ?? -Infinity) <= c.rt.actionClock + 1e-9 } };
    this.aiScratch.set(c, scratch); return scratch;
  }
  /** Review R17: engaged with the player — hunting or angry, an action that targets the player, or a contact with it (any outcome) in the
   *  last ENGAGED_SECONDS. */
  engaged(c: EntityCombat, now: number): boolean {
    const e = c.entity;
    return e.mode === 'hunt' || e.mode === 'angry' || c.rt.actions.some(a => a.phase !== 'interrupted' && a.targetId === PLAYER_ID) || now - c.lastAttackedPlayerAt <= ENGAGED_SECONDS + 1e-9;
  }

  // ---- the player's moves ----
  private sourceOf(m: GrantedMove, socketId: string | undefined): EmitterSource { return { kind: 'part', partUid: m.partUid, copy: 0, socketId: socketId ?? 'none' }; }
  private tryStart(ctx: CombatContext, m: GrantedMove, aim: Vec3, held: boolean): StartRefusal | 'started' {
    const p = ctx.player, rt = p.rt, key = `${PLAYER_ID}:${m.partUid}:${m.grantId}`, kind = m.resolved.kind;
    const d = canStart(rt, { playing: ctx.playing, isPlayer: true, kind, cooldownKey: key, mode: p.mode, allowedModes: m.resolved.allowedMotionModes, inBreachArc: p.inBreachArc, token: true, worldNow: ctx.now });
    if (!d.ok) return d.reason;
    if (d.replaces) { if (d.replaces.phase === 'hold') this.releasePlayerHold(d.replaces, rt, ctx.now); endNow(rt, d.replaces); }
    let dir = aim;
    if (m.resolved.evasion) {
      const w = ctx.wish, wl = Math.hypot(w.x, w.y, w.z), facing = forwardOf(rt.orientation);
      dir = wl > .3 ? w : ctx.intent.aim ?? facing;
      dir = m.resolved.evasion.plane === 'horizontal' ? horizontal(dir) : unit(dir);
    }
    const sockets = m.resolved.attack ? (m.kind === 'bite' ? 'bite' : m.kind === 'grab' ? 'pinch' : m.kind === 'sweep' ? 'slap' : undefined) : m.kind === 'counter' ? 'spike' : undefined;
    const a = startAction(rt, { instanceId: this.nextId(PLAYER_ID), definitionId: m.resolved.attack?.id ?? m.resolved.abilityId ?? kind, grantId: m.grantId, source: this.sourceOf(m, sockets),
      resolved: m.resolved, aim: dir, targetId: null, cooldownKey: key, worldNow: ctx.now });
    if (m.resolved.guard?.kind === 'brace' && !held) a.released = true;
    if (a.aimLocked) a.lockedShapes = this.playerShapes(ctx.player, a);
    return 'started';
  }
  /** The world shapes of a player action: one per emitter of its part and socket (a mirrored pair has two). */
  private playerShapes(p: PlayerBody, a: ActionState): WorldShape[] {
    const attack = a.resolved.attack; if (!attack || a.source.kind !== 'part') return [];
    const src = a.source, origins = p.pose.emitters.filter(e => e.source.kind === 'part' && e.source.partUid === src.partUid && e.source.socketId === src.socketId).map(e => e.origin);
    if (attack.shape.kind === 'cone') return (origins.length ? origins : [p.centre]).map(o => playerCone(p, attack.shape as ConeShape, o, a.aim));
    return actionShapes(attack.shape, origins.length ? origins : [p.centre], a.aim, forwardOf(p.rt.orientation), p.L);
  }
  /** The Bite cone of the dispatch rule: the resolved Bite shape with the current aim and its range × 1.25 (spec §8.3), from the hull
   *  centre (playerCone). */
  biteCone(p: PlayerBody, moves: MoveSet, aim: Vec3): WorldShape | null {
    const b = moves.basic, attack = b?.resolved.attack; if (!b || !attack || attack.shape.kind !== 'cone') return null;
    const origin = p.pose.emitters.find(e => e.source.kind === 'part' && e.source.partUid === b.partUid && e.source.socketId === 'bite')?.origin ?? p.centre;
    return playerCone(p, { ...attack.shape, range: attack.shape.range * 1.25 }, origin, aim, true);
  }
  private releasePlayerHold(a: ActionState, rt: CombatRuntime, now: number) {
    const held = a.heldTarget === null ? undefined : [...this.entities.values()].find(c => c.id === a.heldTarget);
    if (held) releaseHold(rt, a, held.rt, now, false);
  }

  /** One combat tick (spec §6.1, §5): clocks, the player's starts, actions, hits, holds and kills.
   *  The tick never moves a body (the pose cache checks each entity's place anyway, final review I3). Combat motion leaves as requests
   *  (playerMotion, lunges) and is applied outside the tick. */
  tick(ctx: CombatContext): CombatTick { return this.tickInner(ctx); }
  private tickInner(ctx: CombatContext): CombatTick {
    const out: CombatTick = { events: [], chomp: false, killed: [], brokeFree: false, started: [] };
    const p = ctx.player, rt = p.rt, intent = ctx.intent, now = ctx.now;
    const dPlayer = advanceClock(rt, now, ctx.dt);
    const live: EntityCombat[] = [];
    for (const e of ctx.entities) { if (!e.active || e.eaten) continue; const c = this.stateOf(e); if (c) live.push(c); }
    const dEntity = live.map(c => advanceClock(c.rt, now, ctx.dt));
    const aim = intent.aim ?? forwardOf(rt.orientation);
    // Starts (spec §5.3, §5.7): a held player first tries to break free; then the buffered press, the slot presses and the basic input.
    if (ctx.playing) {
      const dashSlot = ctx.slots.slots.indexOf('dash');
      if (rt.heldBy !== null) {
        const flick = isFlick(ctx.previousMove, intent.move), dashPressed = dashSlot >= 0 && intent.activePressed[dashSlot]!;
        const counterSlot = ctx.slots.slots.indexOf('counter'), counterPressed = counterSlot >= 0 && intent.activePressed[counterSlot]!;
        const escape = live.find(c => c.id === rt.heldBy)?.behaviour.traits?.grabEscape;   // spec §11.8: the squid's hold
        if (addBreakProgress(rt, { basicPressed: intent.basicPressed, dashPressed, counterPressed, flick }, escape)) {
          const grabber = live.find(c => c.id === rt.heldBy), g = grabber && holdingAction(grabber.rt, PLAYER_ID);
          if (grabber && g) releaseHold(grabber.rt, g, rt, now, true); else { rt.heldBy = null; rt.breakProgress = 0; }
          out.brokeFree = true;
        }
      }
      const press = (input: 'basic' | ActiveSlot): 'started' | 'buffered' | null => {
        const m = input === 'basic' ? ctx.moves.basic : (() => { const k = ctx.slots.slots[input]; return k ? ctx.moves.byKind[k] ?? null : null; })();
        if (!m) return null;
        const held = input === 'basic' ? intent.basicHeld : intent.activeHeld[input] && !intent.activeCanceled[input];
        const r = this.tryStart(ctx, m, aim, held);
        if (r === 'started') { out.started.push(m.resolved.kind); return 'started'; }
        if ((r === 'busy' || r === 'hit-stop') && bufferPress(rt, input, now)) return 'buffered';
        return null;
      };
      const buffered = bufferedPress(rt);
      if (buffered !== null) { if (press(buffered) === 'started') rt.buffered = null; }   // a held player's buffered Bite starts too (canStart allows it)
      // T7 carry: only an accepted slot press (the move started, or it was buffered behind a busy action) suppresses this tick's basic input.
      // An empty, inactive, cooling or refused slot does not swallow a same-tick Bite or chomp.
      let slotAccepted = false;
      for (let i = 0; i < 4; i++) if (intent.activePressed[i] && press(i as ActiveSlot) !== null) slotAccepted = true;
      // The basic dispatch rule (spec §8.3): Bite when a combat species is in the Bite cone, else today's chomp. A held input repeats Bite.
      // A herbivore Bites only a species engaged with it (review R17); otherwise its basic input eats.
      if (basicRequested(intent, slotAccepted)) {
        const cone = this.biteCone(p, ctx.moves, aim), herbivore = ctx.diet === 'herbivore';
        const isCombat = (e: Entity) => { const c = this.stateOf(e); return c !== null && (!herbivore || this.engaged(c, now)); };
        if (cone && biteDispatch(cone, ctx.entities, ctx.stage, isCombat, e => this.stateOf(e)?.rt.targetable === false ? [] : this.poseOf(e, now).hurtboxes)) {
          if (intent.basicPressed) press('basic');
          else if (this.tryStart(ctx, ctx.moves.basic!, aim, true) === 'started') out.started.push('bite');
        } else out.chomp = true;
      }
    }
    // Actions (spec §5.2, §5.4): the player, then each entity.
    const activeNow: { fighter: 'player' | EntityCombat; a: ActionState }[] = [], entered: { fighter: 'player' | EntityCombat; a: ActionState }[] = [];
    const braceHeld = (() => { const i = ctx.slots.slots.indexOf('brace'); return i >= 0 && intent.activeHeld[i]! && !intent.activeCanceled[i]!; })();
    for (const a of rt.actions) {
      const wasDash = a.phase === 'active' && !!a.resolved.evasion;
      const r = tickAction(rt, a, dPlayer, { wantedAim: aim, held: braceHeld, bodyForward: horizontal(forwardOf(rt.orientation)) });
      if (r.locked) a.lockedShapes = this.playerShapes(p, a);
      if (wasDash && a.phase !== 'active' && a.resolved.evasion) {   // the end of a dash keeps endSpeedCarry of its speed
        const s = dashSpeed(a, p.L) * a.resolved.evasion.endSpeedCarry; rt.controlledVelocity = { x: a.aim.x * s, y: a.aim.y * s, z: a.aim.z * s };
      }
      if (r.releasedTarget) { const h = live.find(c => c.id === r.releasedTarget); if (h) { h.rt.heldBy = null; h.rt.breakProgress = 0; } }
      if (r.enteredActive) entered.push({ fighter: 'player', a });
      if (r.wasActive && a.resolved.attack) activeNow.push({ fighter: 'player', a });
    }
    live.forEach((c, i) => {
      if (!c.rt.actions.length) return;   // final review I3: no pose for an entity with no action
      const pose = this.poseOf(c.entity, now), centre = pose.hull[0]!.start;
      for (const a of c.rt.actions) {
        // Review R3: toward the player's hurtbox centre, pitch clamped (ground species too). From the hull centre: once the aim points
        // at the target, the hull front lies on the same line, so the direction from the front is the same.
        const toPlayer = a.targetId === PLAYER_ID ? clampAimPitch({ x: p.centre.x - centre.x, y: p.centre.y - centre.y, z: p.centre.z - centre.z }, pose.forward) : null;
        const r = tickAction(c.rt, a, dEntity[i]!, { wantedAim: toPlayer, held: false, bodyForward: pose.forward });
        if (r.locked) a.lockedShapes = this.speciesShapes(c, a, now);
        if (r.releasedTarget === PLAYER_ID) { rt.heldBy = null; rt.breakProgress = 0; }
        if (r.enteredActive) entered.push({ fighter: c, a });
        if (r.wasActive && a.resolved.attack) activeNow.push({ fighter: c, a });
      }
    });
    // Review R5: a Counter open when a parryable action enters active is armed against it (before this tick's contacts).
    for (const { fighter, a } of entered) { if (fighter === 'player') for (const c of live) armCounters(a, c.rt); else armCounters(a, rt); }
    // Hits (spec §6.1): every active action's requests, resolved in the contract order.
    const playerFighter: Fighter = { id: PLAYER_ID, isPlayer: true, rt, centre: p.centre, forward: forwardOf(rt.orientation), L: p.L, mass: p.mass, knockbackResistance: p.knockbackResistance,
      armor: p.armor, ground: p.ground, grabbable: true, poise: null, poiseMax: 0, staggerResist: 0, health: p.health };
    // Final review I3: a species fighter only for an attacker or a hit target of this tick.
    const fighters = new Map<EntityCombat, Fighter>(), requests: HitRequestIn[] = [];
    const fighterFor = (c: EntityCombat): Fighter => { let f = fighters.get(c); if (!f) { f = this.fighterOf(c, now); fighters.set(c, f); } return f; };
    for (const { fighter, a } of activeNow) {
      const attack = a.resolved.attack as AttackSpec, shapes = this.hitShapes(fighter === 'player' ? null : fighter, a, p, now);
      if (!shapes.length) continue;
      const attacker = fighter === 'player' ? playerFighter : fighterFor(fighter);
      const candidates = fighter === 'player'
        ? live.map(c => ({ id: c.id, c, hurt: this.poseOf(c.entity, now).hurtboxes }))   // the resolver skips an untargetable body (an alpha under the sand)
        : [{ id: PLAYER_ID, c: null, hurt: p.pose.hurtboxes }];
      const hits = candidates.flatMap(t => { const point = hurtboxesHit(t.hurt, shapes); if (!point) return []; const s = shapes[0]!, origin = s.kind === 'cone' ? s.apex : s.start;
        return [{ ...t, point, origin, distance: Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) }]; });
      for (const t of nearestTargets(hits, attack.maxTargets)) {
        const target = t.c ? fighterFor(t.c) : playerFighter;
        const geometryOk = crossingOk(attack.crossing, ctx.queries, t.origin, t.point, attacker.L) && obstructionClear(ctx.queries, t.origin, t.point, attacker.L);
        requests.push({ attacker, target, action: a, attack, hitGroupId: a.grantId, origin: t.origin, point: t.point, geometryOk });
      }
    }
    for (const e of resolveAll(requests, now, statusOf)) {
      out.events.push(e);
      if (e.killed && e.killed !== PLAYER_ID) { const c = live.find(x => x.id === e.killed); if (c && !out.killed.includes(c.entity)) out.killed.push(c.entity); }
      const hurt = live.find(x => x.id === e.targetId); if (hurt && e.amount > 0) { hurt.lastDamagedAt = now; hurt.entity.damagedAt = now; }   // the ecosystem's D37 quiet heal reads it
      if (e.targetId === PLAYER_ID) {
        const by = live.find(x => x.id === e.attackerId); if (by) by.lastAttackedPlayerAt = now;
        if (by?.ai && (e.outcome === 'hit' || e.outcome === 'grabbed' || e.outcome === 'guard-broken')) aiLandedHit(by.behaviour, by.ai, now);   // an eel stays out longer
      }
    }
    p.health = playerFighter.health;
    for (const [c, f] of fighters) c.entity.hp = f.health;
    // Holds (spec §6.6): squeezes on the grabber's clock; a hold whose grabber is gone or no longer holds releases its target.
    for (const c of live) for (const a of c.rt.actions) {
      if (a.phase !== 'hold' || a.heldTarget !== PLAYER_ID) continue;
      const n = squeezesDue(a, c.rt.actionClock), h = a.resolved.attack?.hold;
      for (let i = 0; i < n && h; i++) {
        const hh = damageAfterArmor(h.squeezeHalfHearts, p.armor); p.health -= hh / 2; rt.lastDamageAt = now;
        out.events.push({ outcome: 'hit', attackerId: c.id, targetId: PLAYER_ID, attackId: a.resolved.attack!.id, actionInstanceId: a.instanceId, point: p.centre, amount: hh, unit: 'half-heart', reflect: 0,
          hitStop: 0, impulse: { x: 0, y: 0, z: 0 }, status: null, caught: false, held: true, killed: null, time: now, trait: null });
      }
    }
    for (const k of out.killed) { const c = live.find(x => x.entity === k); if (c) this.releaseAllOf(c, rt); }
    this.reconcileHolds(rt, live);
    this.followTokens(live, rt, now, ctx.dt);
    sweepEnded(rt); for (const c of live) sweepEnded(c.rt);
    for (const e of out.events) { this.log.push(e); if (this.log.length > EVENT_LOG) this.log.shift(); }
    return out;
  }
  private fighterOf(c: EntityCombat, now: number): Fighter {
    const pose = this.poseOf(c.entity, now), b = c.behaviour;
    return { id: c.id, isPlayer: false, rt: c.rt, centre: pose.hull[0]!.start, forward: pose.forward, L: pose.bodyLength, mass: pose.mass, knockbackResistance: b.knockbackResistance, armor: 0,
      ground: c.entity.spec.movementProfileId === 'sp-ground', grabbable: b.grabbable && !c.entity.spec.alpha, poise: c.poise, poiseMax: b.poise, staggerResist: now < c.immuneUntil ? 1 : b.staggerResist,
      health: c.entity.hp, traits: b.traits ?? null };
  }
  /** The shape origin of a species action (review R2, R4): a target-origin attack's fixed point; a `centre` attack's hull centre; else the
   *  hull front (hull centre + aim × hull radius). */
  private speciesOrigin(a: ActionState, pose: CombatPose): Vec3 {
    if (a.originPoint) return a.originPoint;
    const h = pose.hull[0]!, c = h.start;
    if (a.resolved.attack?.aimMode === 'centre') return c;
    return { x: c.x + a.aim.x * h.radius, y: c.y + a.aim.y * h.radius, z: c.z + a.aim.z * h.radius };
  }
  /** A species action's world shapes from its origin (spec §5.10, review R2/R4); a `fixed-at-start` aim is set by the caller. */
  speciesShapes(c: EntityCombat, a: ActionState, now: number): WorldShape[] { return this.shapesAt(a, this.poseOf(c.entity, now)); }
  private shapesAt(a: ActionState, pose: CombatPose): WorldShape[] {
    const attack = a.resolved.attack!;
    return actionShapes(attack.shape, [this.speciesOrigin(a, pose)], a.aim, pose.forward, pose.bodyLength);
  }
  /** The hit volume that a species action's active phase tests now (plan review R11 checks it against the telegraph). */
  speciesHitShapes(c: EntityCombat, a: ActionState, now: number): WorldShape[] { return this.hitShapes(c, a, null, now); }
  /** The hit volume of an active action: the locked shapes; a lunge's capsule truncated at the reached point (always inside the telegraph). */
  private hitShapes(c: EntityCombat | null, a: ActionState, p: PlayerBody | null, now: number): WorldShape[] {
    const shapes = a.lockedShapes ?? (c ? this.speciesShapes(c, a, now) : p ? this.playerShapes(p, a) : []), attack = a.resolved.attack!;
    if (!attack.lunge || attack.shape.kind !== 'capsule') return shapes;
    const len = Math.hypot(attack.shape.end.x - attack.shape.start.x, attack.shape.end.y - attack.shape.start.y, attack.shape.end.z - attack.shape.start.z);
    return shapes.map(s => s.kind === 'capsule' ? truncateCapsule(s, len, attack.lunge!.distanceBodyLengths, a.lungeDone) : s);
  }
  private releaseAllOf(c: EntityCombat, playerRt: CombatRuntime) {
    const a = holdingAction(c.rt, PLAYER_ID); if (a) { playerRt.heldBy = null; playerRt.breakProgress = 0; a.heldTarget = null; }
    if (c.rt.heldBy === PLAYER_ID) for (const a of playerRt.actions) if (a.heldTarget === c.id) a.heldTarget = null;
    c.rt.heldBy = null; c.rt.breakProgress = 0;
  }
  /** Every `heldBy` must match a grabber action that holds it (a catch in active or the hold phase), and every hold a held target. Anything
   *  else is released on both sides, `heldBy` and `breakProgress` (T5 carry): a stagger by a third fighter, a counter, a kill, a despawn,
   *  a faint or a reset ended one side. */
  private reconcileHolds(rt: CombatRuntime, live: readonly EntityCombat[]) {
    const holds = (who: ActorId, of: CombatRuntime) => holdingAction(of, who) !== undefined;
    if (rt.heldBy !== null) { const g = live.find(c => c.id === rt.heldBy); if (!g || !holds(PLAYER_ID, g.rt)) { rt.heldBy = null; rt.breakProgress = 0; } }
    for (const c of live) if (c.rt.heldBy === PLAYER_ID && !holds(c.id, rt)) { c.rt.heldBy = null; c.rt.breakProgress = 0; }
    for (const c of live) { const a = holdingAction(c.rt, PLAYER_ID); if (a && rt.heldBy !== c.id) endHold(c.rt, a); }
    for (const a of rt.actions) if (a.heldTarget !== null && (a.phase === 'hold' || a.phase === 'active') && live.find(c => c.id === a.heldTarget)?.rt.heldBy !== PLAYER_ID) endHold(rt, a);
  }
  /** A blocked held motion (result `blocked` with progress below .5) ends the hold (spec §5.12). */
  onPlayerStep(rt: CombatRuntime, step: { status: string; progress: number }, now: number): boolean {
    if (rt.heldBy === null || step.status !== 'blocked' || step.progress >= .5) return false;
    const g = [...this.entities.values()].find(c => c.id === rt.heldBy), a = g && holdingAction(g.rt, PLAYER_ID);
    if (g && a) releaseHold(g.rt, a, rt, now, false); else { rt.heldBy = null; rt.breakProgress = 0; }
    return true;
  }
  /** The claw point of a hold: the grabber's shape origin (the hull front for a species, review R2) plus CLAW_REACH × L_t along its aim. */
  clawPoint(grabber: EntityCombat | PlayerBody, a: ActionState, targetL: number, now: number): Vec3 {
    const origin = 'entity' in grabber ? this.speciesOrigin(a, this.poseOf(grabber.entity, now))
      : (this.playerShapes(grabber, a)[0] as Extract<WorldShape, { kind: 'cone' }> | undefined)?.apex ?? grabber.centre;
    return { x: origin.x + a.aim.x * CLAW_REACH * targetL, y: origin.y + a.aim.y * CLAW_REACH * targetL, z: origin.z + a.aim.z * CLAW_REACH * targetL };
  }
  /** Motion during the player's actions for the next player step (spec §5.12). `wish`: the move direction (world space) of this frame.
   *  Review R16: while Brace is up and the aim source is `none` (a phone with no auto-aim candidate), the body turns toward the move wish. */
  playerMotion(p: MotionBody, intent: CombatInput, now: number, wish: Vec3 = NO_MOVE): CombatMotion {
    const rt = p.rt; let speed = 1, face: CombatMotion['face'] = null, dash: Vec3 | null = null, forced: Vec3 | null = null;
    for (const a of liveActions(rt)) {
      const attack = a.resolved.attack, g = a.resolved.guard;
      if (attack && (a.phase === 'windup' || a.phase === 'active')) {
        speed *= attack.moveSpeedFactor;
        if (a.resolved.kind === 'bite' || a.resolved.kind === 'grab') face = { dir: a.aim, yawRateFactor: 1 };
      }
      if (g?.kind === 'brace' && (a.phase === 'windup' || a.phase === 'active')) { speed *= g.moveSpeedFactor; face = { dir: braceFacing(intent, wish) ?? intent.aim ?? forwardOf(rt.orientation), yawRateFactor: g.yawRateFactor }; }
      if (a.phase === 'hold') speed *= HOLDING_SPEED;
      if (a.resolved.evasion && a.phase === 'active') { const s = dashSpeed(a, p.L); dash = { x: a.aim.x * s, y: a.aim.y * s, z: a.aim.z * s }; }
    }
    if (rt.status && now < rt.status.until) speed *= rt.status.speedFactor;
    if (rt.actionClock < rt.staggerUntil) speed *= STAGGERED_SPEED;
    if (rt.heldBy !== null) {
      const g = [...this.entities.values()].find(c => c.id === rt.heldBy), a = g && holdingAction(g.rt, PLAYER_ID);
      if (g && a) { const claw = this.clawPoint(g, a, p.L, now); forced = { x: claw.x - p.centre.x, y: claw.y - p.centre.y, z: claw.z - p.centre.z }; }
    }
    return { speedFactor: speed, face, dashVelocity: dash, forcedDisplacement: forced, frozen: now < rt.hitStopUntil };
  }
  /** Starts a species attack (the AI asks; spec §5.3). `targetAt` (the target's hurtbox centre): the aim points from the hull centre at it
   *  (review R3); a target-origin attack is centred on it (R4). Without it the given aim is used. Either way the pitch is clamped to
   *  ±AIM_PITCH_LIMIT. `targetAt` is required (else 'no-target') for an attack on the player and for a target-origin attack.
   *  An attack at the player needs a director token (start rule 7, spec §9.4): the token's extension lengthens the wind-up. A refusal
   *  ('token') sets `tokenRetryAt`; until then every attack at the player is refused. */
  startSpecies(c: EntityCombat, attackId: string, attack: AttackSpec, aim: Vec3, targetId: ActorId | null, now: number, opts: SpeciesStartOptions = {}): ActionState | SpeciesRefusal {
    const targetAt = opts.targetAt ?? null, atPlayer = targetId === PLAYER_ID;
    if (!targetAt && (atPlayer || attack.origin === 'target')) return 'no-target';
    if (atPlayer && (opts.onScreen === undefined || opts.playerHeld === undefined || opts.tick === undefined)) return 'no-context';
    const key = `${c.id}:root:${attackId}`, d = canStart(c.rt, { playing: opts.playing ?? true, isPlayer: false, kind: 'species', cooldownKey: key, mode: 'swim', allowedModes: ['swim'], inBreachArc: false,
      token: !atPlayer || now >= c.tokenRetryAt - 1e-9, worldNow: now });
    if (!d.ok) return d.reason;
    const id = `${c.id}#${this.serial + 1}`;
    let extension = 0;
    if (atPlayer) {
      const tick = opts.tick!, delay = tick + Math.max(0, c.rt.hitStopUntil - now - tick);   // review R6: one tick and the remaining hit-stop
      const t = this.director.request({ actionInstanceId: id, attackerId: c.id, windupSeconds: attack.windupSeconds, now, grab: !!attack.hold, onScreen: opts.onScreen!,
        playerHeld: opts.playerHeld!, delay });
      if (!t.ok) { c.tokenRetryAt = t.retryAt; return 'token'; }
      extension = t.extension;
    }
    this.serial++;
    if (d.replaces) endNow(c.rt, d.replaces);
    const pose = this.poseOf(c.entity, now), centre = pose.hull[0]!.start;
    const dir = clampAimPitch(targetAt ? { x: targetAt.x - centre.x, y: targetAt.y - centre.y, z: targetAt.z - centre.z } : aim, pose.forward);
    const a = startAction(c.rt, { instanceId: id, definitionId: attackId, grantId: attackId, source: { kind: 'actor', actorId: c.id, mountId: 'root', socketId: 'centre' },
      resolved: speciesMove(attack), aim: dir, targetId, cooldownKey: key, worldNow: now });
    a.windupExtension = extension;
    if (attack.origin === 'target' && targetAt) a.originPoint = { x: targetAt.x, y: targetAt.y, z: targetAt.z };
    if (a.aimLocked) a.lockedShapes = this.speciesShapes(c, a, now);
    return a;
  }
  /** The telegraphs of every species action in windup or active (spec §9.1): the shapes the hit test uses (the live aim before the lock,
   *  the locked shapes after it), the fill (τ − τ0) / (windup + extension), the depth ring, the colour code, the edge arrow and the flash.
   *  Read-only: it reads poses through the shared pose cache without counting `poseSamples`, and keeps no other memory.
   *  `isOnScreen` takes a physical point. */
  telegraphs(now: number, isOnScreen: (p: Vec3) => boolean, groundAt: (x: number, z: number) => number): TelegraphView[] {
    const out: TelegraphView[] = [];
    for (const c of this.entities.values()) {
      if (c.entity.eaten || !c.entity.active) continue;
      for (const a of c.rt.actions) {
        if (a.phase !== 'windup' && a.phase !== 'active') continue;
        const attack = a.resolved.attack; if (!attack) continue;
        const profile = TELEGRAPHS[attack.telegraphProfileId]; if (!profile || profile.color === 'none') continue;
        const windup = windupLength(a), elapsed = c.rt.actionClock - a.phaseStartedAt, fill = a.phase === 'windup' ? elapsed / Math.max(1e-9, windup) : 1;
        const shapes = a.lockedShapes ?? this.shapesAt(a, this.speciesPose(c.entity, now, false)), d = telegraphDescriptor(shapes, fill, profile.color, profile.pattern, a.aimLocked, groundAt), onScreen = isOnScreen(d.centroid);
        const activeIn = a.phase === 'windup' ? Math.max(0, windup - elapsed) : 0;
        const flash = a.phase === 'windup' && (elapsed < WINDUP_FLASH - 1e-9 || activeIn <= profile.flashLeadSeconds + 1e-9);
        out.push({ ...d, actionId: a.instanceId, attackerId: c.id, entityId: c.entity.id, attackId: attack.id, phase: a.phase, onScreen, edgeArrow: profile.edgeArrow, targetsPlayer: a.targetId === PLAYER_ID, flash,
          cue: profile.poseCue, activeIn });
      }
    }
    return out;
  }
  /** The AI tick (spec §11.2), after the combat tick and before the ecosystem's step: every active combat species' state machine, its
   *  attack at the player (startSpecies with the full context: the hurtbox centre, on-screen, held, playing, the tick; a director token),
   *  and its motion for the step (`entity.combat`). The player's damage this tick provokes fighters. */
  aiTick(ctx: AiTickContext): AiTickResult {
    const res: AiTickResult = { engagements: [], roars: [], markers: [] }, p = ctx.player, now = ctx.now;
    // prey-school (spec §11.2): the live members of each schooling species, with their hull centres (one pose sample each, reused below).
    // Final review I3: the AI reads a light body (hull centre, radius, L, forward), not a full pose; a pose is sampled only to start an attack.
    const schools = new Map<string, SchoolMember[]>();
    for (const e of ctx.entities) {
      if (e.eaten || !e.active || !e.spec.behaviourId) continue;
      const c = this.stateOf(e); if (!c?.behaviour.school) continue;
      const body = aiBodyInto(e, this.aiScratchOf(c).body);
      const list = schools.get(e.spec.key) ?? []; list.push({ entity: e, state: c.ai ??= newAiState(ctx.runSeed, e.id, now), position: body.centre, L: body.L }); schools.set(e.spec.key, list);
    }
    for (const e of ctx.entities) {
      if (!e.spec.behaviourId) continue;
      if (e.eaten || !e.active) { e.combat = null; continue; }
      const c = this.stateOf(e); if (!c) { e.combat = null; continue; }
      const ai = c.ai ??= newAiState(ctx.runSeed, e.id, now), hit = ctx.hitBy.has(e.id);
      if (hit && e.spec.fights) provoke(e, p.position, now, p.pose.hull);
      const sc = this.aiScratchOf(c), body = c.behaviour.school ? sc.body : aiBodyInto(e, sc.body), centre = body.centre, r = body.r, L = body.L;
      let dHurt = Infinity;
      for (const h of p.pose.hurtboxes) dHurt = Math.min(dHurt, segmentDistance(centre, h.start, h.end) - h.radius);
      const tierSize = SIZES[e.spec.tier]!, stageSize = SIZES[Math.min(ctx.stage, SIZES.length - 1)]!, engaged = e.mode === 'hunt' || e.mode === 'angry';
      sc.ctx = ctx; sc.e = e; sc.p = p;
      const i = sc.input, self = i.self, pl = i.player;
      i.now = now;
      self.position = centre; self.L = L; self.forward = body.forward; self.hp = e.hp; self.maxHp = c.maxHp; self.staggered = c.rt.actionClock < c.rt.staggerUntil; self.held = c.rt.heldBy !== null;
      self.busy = c.rt.actions.some(a => a.phase !== 'interrupted'); self.speed = e.spec.speed * tierSize;
      // Final review I3: line of sight only when the AI reads it (the eel's den trigger, after its distance test): `visible` is a getter.
      pl.position = p.centre; pl.d = Math.max(0, dHurt - r) / L; pl.targetable = ctx.playing && p.rt.targetable; pl.ground = p.ground;
      i.hostile = !ctx.givingUp && hostileSizes(e.spec).includes(ctx.stage);   // D27 (review ruling): no creature attacks the player in the window
      i.pursuit = ctx.givingUp && engaged ? 'return' : e.mode; i.hit = hit;
      i.fleeDistance = 7 * Math.max(tierSize, stageSize) * ctx.stealthFactor;
      i.inLair = ai.home && c.behaviour.lair ? Math.hypot(p.centre.x - ai.home.x, p.centre.z - ai.home.z) <= c.behaviour.lair.radiusBodyLengths * L : undefined;
      i.tokenRetryAt = c.tokenRetryAt;
      i.schoolCentre = c.behaviour.school ? schoolCentre(schools.get(e.spec.key) ?? [], centre, 2 * c.behaviour.school.radiusBodyLengths * L) : undefined;
      const out = aiStep(c.behaviour, ai, i);
      // An alpha has no ecosystem pursuit (its lair is its leash): its mode mirrors the AI, engaged ('angry') unless idle or resetting.
      if (e.spec.alpha) { const mode = ai.name === 'idle' || ai.name === 'reset' ? 'calm' : 'angry'; if (e.mode !== mode) { e.mode = mode; e.modeTime = 0; } }
      if (out.roar) {   // a phase change: the roar starts at once and cancels a busy action (its token returns; no cooldown)
        for (const a of c.rt.actions) { if (a.phase === 'interrupted') continue; if (a.heldTarget === PLAYER_ID) { endHold(c.rt, a); p.rt.heldBy = null; p.rt.breakProgress = 0; } endNow(c.rt, a, 0); this.director.release(a.instanceId); }
        c.immuneUntil = now + ROAR_SECONDS; res.roars.push(e);
      }
      let snap: Vec3 | null = null;
      if (out.attack) {
        const attack = this.attacks[out.attack.attackId];
        const started = attack ? this.startSpecies(c, out.attack.attackId, attack, out.attack.aim, PLAYER_ID, now,
          { targetAt: p.centre, onScreen: ctx.isOnScreen(this.startCentroid(attack, this.speciesPose(e, now), p.centre)), playerHeld: p.rt.heldBy !== null, playing: ctx.playing, tick: ctx.dt }) : 'no-target';
        if (typeof started === 'string') aiRefused(ai, now, c.tokenRetryAt);
        else {
          aiStarted(ai, now);
          if (ai.name === 'ambush') engage(e, p.position, now, p.pose.hull);   // T16 carry 4: the ambusher's pursuit is engaged
          if (started.originPoint) snap = started.originPoint;   // review R4: the body stands at the emerge point
        }
      }
      c.rt.targetable = !out.untargetable;
      if (out.heal > 0) e.hp = Math.min(c.maxHp, e.hp + out.heal * c.maxHp * ctx.dt);
      if (out.marker) res.markers.push(e);
      if (out.engagementEnded) res.engagements.push({ entity: e, ...out.engagementEnded });
      const lunging = c.rt.actions.find(a => a.phase === 'active' && !!a.resolved.attack?.lunge), speed = lunging ? lungeSpeed(lunging, L) : 0;
      const holder = c.rt.heldBy === PLAYER_ID ? holdingAction(p.rt, c.id) : undefined, claw = holder ? this.clawPoint(p, holder, L, now) : null;
      const motion: EntityMotion = { intent: out.intent, face: out.intent.kind === 'hold' && (ai.name === 'face' || ai.name === 'notice' || ai.name === 'attack') ? p.centre : null,
        lunge: lunging ? { x: lunging.aim.x * speed, y: lunging.aim.y * speed, z: lunging.aim.z * speed } : null, external: c.rt.externalVelocity, frozen: now < c.rt.hitStopUntil,
        held: claw ? { x: claw.x - centre.x, y: claw.y - centre.y, z: claw.z - centre.z } : null, snap, moved: 0 };
      e.combat = motion;
    }
    // prey-school (spec §11.2): one member's flee takes every near idle member along on the same tick, in one direction. schoolFlee groups by
    // the school radius around each starter, so it runs per school; every member that flees from this tick moves along the shared direction now.
    for (const members of schools.values()) {
      const f = this.behaviours[members[0]!.entity.spec.behaviourId!]!, school = f.school!, speedFactor = f.flee?.speedFactor ?? 1;
      schoolFlee(members, p.centre, school.radiusBodyLengths, now, !!p.ground);
      for (const m of members) {
        const d = m.state.fleeDir, motion = m.entity.combat;
        if (!d || !motion || m.state.name !== 'flee' || m.state.since !== now) continue;   // the starter too: the school's shared direction
        motion.intent = { kind: 'away', point: { x: m.position.x - d.x, y: m.position.y - d.y, z: m.position.z - d.z }, speedFactor }; motion.face = null;
      }
    }
    return res;
  }
  /** The centroid of an attack's shape if it started now (the director's on-screen test): from the target point, the hull centre or the hull
   *  front (review R2/R4), aimed at the target with the pitch clamp. */
  private startCentroid(attack: AttackSpec, pose: CombatPose, target: Vec3): Vec3 {
    const h = pose.hull[0]!, c = h.start, aim = clampAimPitch({ x: target.x - c.x, y: target.y - c.y, z: target.z - c.z }, pose.forward);
    const origin = attack.origin === 'target' ? target : attack.aimMode === 'centre' ? c : { x: c.x + aim.x * h.radius, y: c.y + aim.y * h.radius, z: c.z + aim.z * h.radius };
    return shapeCentroid(worldShape(attack.shape, aimFrame(origin, aim, pose.forward), pose.bodyLength));
  }
  /** After the ecosystem's step: a lunge counts the body lengths it really moved (its hit volume is truncated there, spec §5.10). */
  afterMotion(entities: readonly Entity[]): void {
    for (const e of entities) {
      const m = e.combat, c = m?.lunge ? this.entities.get(e.id) : undefined; if (!m || !c || c.entity !== e) continue;
      const a = liveActions(c.rt).find(x => x.phase === 'active' && !!x.resolved.attack?.lunge);
      if (a) a.lungeDone += m.moved / speciesActor(e).bodyLength;
    }
  }
  /** Tokens follow their actions (spec §9.4, plan review R6), at the end of each tick (`now`, length `dt`; the clocks cover the tick):
   *  - a token is held to the end of active (to the end of hold for a grab), and returns when the action ends or its attacker is gone
   *    (then the action ends too, without a cooldown);
   *  - each wind-up's active start is estimated again: the remaining wind-up plus the attacker's hit-stop after this tick;
   *  - in order of start, a wind-up less than ACTIVE_GAP after an earlier token grows (within MAX_EXTENSION in all); when more would be
   *    needed, it ends: its token returns, its cooldown is not spent, and its attacker asks again after RETRY_SECONDS.
   *  Each wind-up at the player marks the player as threatened (`lastThreatAt`, set at the end of each tick while the wind-up runs).
   *  The spacing holds in game time (activeStartedAt); a frame-based observer may see up to one tick less. */
  private followTokens(live: readonly EntityCombat[], playerRt: CombatRuntime, now: number, dt: number) {
    const windups: { a: ActionState; c: EntityCombat; start: number }[] = [];
    for (const c of live) for (const a of c.rt.actions) {
      if (!this.director.holds(a.instanceId)) continue;
      if (a.phase === 'recovery' || a.phase === 'interrupted') { this.director.release(a.instanceId); continue; }
      if (a.phase !== 'windup') continue;
      const remaining = Math.max(0, windupLength(a) - (c.rt.actionClock - a.phaseStartedAt));
      windups.push({ a, c, start: now + dt + remaining + Math.max(0, c.rt.hitStopUntil - now - dt) });
      playerRt.lastThreatAt = now;
    }
    // A token whose attacker is not live (eaten, inactive, gone) returns, and its action ends without a cooldown: the attacker must not
    // resume a tokenless wind-up when it comes back as the same entity (T11 fix round 1).
    for (const t of [...this.director.tokens]) {
      if (live.some(c => c.rt.actions.some(a => a.instanceId === t.actionInstanceId && a.phase !== 'interrupted'))) continue;
      for (const c of this.entities.values()) for (const a of c.rt.actions) if (a.instanceId === t.actionInstanceId) endNow(c.rt, a, 0);
      this.director.release(t.actionInstanceId);
    }
    const placed = this.director.tokens.filter(t => !windups.some(w => w.a.instanceId === t.actionInstanceId)).map(t => t.activeStart);
    windups.sort((x, y) => x.start - y.start);
    for (const w of windups) {
      const need = spacedExtension(w.start, 0, placed);
      if (need > 0 && w.a.windupExtension + need > MAX_EXTENSION + 1e-9) {
        endNow(w.c.rt, w.a, 0); this.director.release(w.a.instanceId); w.c.tokenRetryAt = now + RETRY_SECONDS;
        continue;
      }
      w.a.windupExtension += need; w.start += need;
      this.director.update(w.a.instanceId, w.start); placed.push(w.start);
    }
  }
}
