// The combat world (spec §3.1): it owns the combat state of entities and runs one combat tick — the player's moves from the intent, the
// action clocks, the action engine, world shapes, hit requests, the resolver, holds and kills. Pure: positions are read from the bodies it
// is given; it never moves a body (combat motion goes to the player step and the ecosystem as requests).
import * as T from 'three';
import { advanceClock, bufferedPress, bufferPress, canStart, dashSpeed, endHold, endNow, holdingAction, liveActions, newPoise, startAction, sweepEnded, tickAction, windupLength, type PoiseMeter, type StartRefusal } from './action-engine';
import { BEHAVIOURS, type SpeciesBehaviour } from './bestiary';
import { actionShapes, aimFrame, crossingOk, hurtboxesHit, nearestTargets, obstructionClear, telegraphDescriptor, truncateCapsule, worldShape, type TelegraphDescriptor } from './combat-shapes';
import { newRuntime, type ActionPhase, type TelegraphProfile, type ActionState, type ActiveSlot, type ActorId, type AttackSpec, type CombatInput, type CombatPose, type CombatRuntime, type EmitterSource, type MovementMode, type ResolvedMove, type Vec3, type WorldQueries, type WorldShape } from './combat-types';
import type { Entity } from './ecosystem';
import { biteDispatch } from './feeding';
import { addBreakProgress, armCounters, isFlick, releaseHold, resolveAll, squeezesDue, type CombatEvent, type Fighter, type HitRequestIn } from './hit-resolver';
import { basicRequested } from './input';
import { speciesCombatPose } from './mount';
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
 *  token or a wind-up the director ended; spec §9.4: ask again after RETRY_SECONDS). */
export interface EntityCombat { id: ActorId; entity: Entity; rt: CombatRuntime; poise: PoiseMeter; behaviour: SpeciesBehaviour; maxHp: number; lastDamagedAt: number; lastAttackedPlayerAt: number; tokenRetryAt: number }
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
/** What the telegraph view draws for one species action in windup or active (spec §9.1). `arrow`: the shape's centroid was off-screen at
 *  some time in the windup; the edge arrow shows to the end of active. `flash`: the attacker flashes (WINDUP_FLASH at the windup start, and
 *  the profile's flash lead before active). `activeIn`: action-clock seconds to the active start (0 in active). */
export interface TelegraphView extends TelegraphDescriptor {
  actionId: string; attackerId: ActorId; entityId: number; attackId: string; phase: ActionPhase; onScreen: boolean; arrow: boolean; flash: boolean;
  cue: TelegraphProfile['poseCue']; activeIn: number;
}
/** The attacker's colour flash lasts this long at the windup start (spec §9.1 item 5). */
export const WINDUP_FLASH = .1;
const statusOf = (id: string) => { const s = EFFECTS[id]?.status; return s ? { seconds: s.seconds, speedFactor: s.speedFactor } : null; };

export class CombatWorld {
  readonly entities = new Map<number, EntityCombat>();
  /** The last EVENT_LOG hit outcomes (diagnostics). */
  readonly log: CombatEvent[] = [];
  /** Species poses sampled so far (diagnostics, review R18: at most one per live entity per tick). */
  poseSamples = 0;
  /** Attack tokens for wind-ups at the player (spec §9.4). */
  readonly director = new Director();
  private serial = 0;
  /** Actions whose telegraph centroid went off-screen in the windup (their edge arrow shows to the end of active). Presentation memory only:
   *  no tick reads it. */
  private readonly arrowed = new Set<string>();
  /** Review R18: inside a tick, each entity's pose is sampled once (keyed by entity id); outside a tick nothing is cached. */
  private readonly poses = new Map<number, { entity: Entity; pose: CombatPose }>();
  private inTick = false;
  constructor(private readonly behaviours: Record<string, SpeciesBehaviour> = BEHAVIOURS) {}
  /** A fresh state for a new run or a load (spec §13). */
  reset(): void { this.entities.clear(); this.log.length = 0; this.poses.clear(); this.arrowed.clear(); this.director.releaseAll(); }
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
    c = { id: entityActorId(e), entity: e, rt: newRuntime({ yaw: e.heading, pitch: 0 }), poise: newPoise(), behaviour: b, maxHp: e.spec.hp, lastDamagedAt: -Infinity, lastAttackedPlayerAt: -Infinity, tokenRetryAt: -Infinity };
    this.entities.set(e.id, c); return c;
  }
  /** A combat entity that respawned or was consumed starts over (its actions, clock and holds). */
  forget(e: Entity): void {
    const c = this.entities.get(e.id);
    if (c) for (const a of c.rt.actions) if (this.director.holds(a.instanceId)) { endNow(c.rt, a, 0); this.director.release(a.instanceId); }
    this.entities.delete(e.id);
  }
  /** Forgets every combat entity that was eaten on any path (T11 fix round 1); the sim calls it at the end of each frame. */
  forgetEaten(): void { for (const c of [...this.entities.values()]) if (c.entity.eaten) this.forget(c.entity); }
  private nextId(actor: ActorId) { return `${actor}#${++this.serial}`; }
  /** A species pose: sampled once per entity per tick inside a tick (review R18), fresh outside one. */
  private poseOf(e: Entity, now: number): CombatPose {
    const hit = this.inTick ? this.poses.get(e.id) : undefined;
    if (hit && hit.entity === e) return hit.pose;
    const pose = speciesCombatPose(e, now); this.poseSamples++;
    if (this.inTick) this.poses.set(e.id, { entity: e, pose });
    return pose;
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
    return actionShapes(attack.shape, origins.length ? origins : [p.centre], a.aim, forwardOf(p.rt.orientation), p.L);
  }
  /** The Bite cone of the dispatch rule: the resolved Bite shape with the current aim and its range × 1.25 (spec §8.3). */
  biteCone(p: PlayerBody, moves: MoveSet, aim: Vec3): WorldShape | null {
    const b = moves.basic, attack = b?.resolved.attack; if (!b || !attack || attack.shape.kind !== 'cone') return null;
    const origin = p.pose.emitters.find(e => e.source.kind === 'part' && e.source.partUid === b.partUid && e.source.socketId === 'bite')?.origin ?? p.centre;
    return worldShape({ ...attack.shape, range: attack.shape.range * 1.25 }, aimFrame(origin, aim, forwardOf(p.rt.orientation)), p.L);
  }
  private releasePlayerHold(a: ActionState, rt: CombatRuntime, now: number) {
    const held = a.heldTarget === null ? undefined : [...this.entities.values()].find(c => c.id === a.heldTarget);
    if (held) releaseHold(rt, a, held.rt, now, false);
  }

  /** One combat tick (spec §6.1, §5): clocks, the player's starts, actions, hits, holds and kills.
   *  The tick must never move a body: the pose cache (review R18) is keyed by entity id only, so a body moved inside the tick would keep
   *  its stale pose. Combat motion leaves as requests (playerMotion, lunges) and is applied outside the tick. */
  tick(ctx: CombatContext): CombatTick {
    this.inTick = true; this.poses.clear();
    try { return this.tickInner(ctx); } finally { this.inTick = false; this.poses.clear(); }
  }
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
        if (addBreakProgress(rt, { basicPressed: intent.basicPressed, dashPressed, flick })) {
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
        if (cone && biteDispatch(cone, ctx.entities, ctx.stage, isCombat, e => this.poseOf(e, now).hurtboxes)) {
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
    const fighters = new Map(live.map(c => [c, this.fighterOf(c, now)] as const)), requests: HitRequestIn[] = [];
    for (const { fighter, a } of activeNow) {
      const attack = a.resolved.attack as AttackSpec, shapes = this.hitShapes(fighter === 'player' ? null : fighter, a, p, now);
      if (!shapes.length) continue;
      const attacker = fighter === 'player' ? playerFighter : fighters.get(fighter)!;
      const candidates = fighter === 'player'
        ? live.map(c => ({ id: c.id, c, hurt: this.poseOf(c.entity, now).hurtboxes }))
        : [{ id: PLAYER_ID, c: null, hurt: p.pose.hurtboxes }];
      const hits = candidates.flatMap(t => { const point = hurtboxesHit(t.hurt, shapes); if (!point) return []; const s = shapes[0]!, origin = s.kind === 'cone' ? s.apex : s.start;
        return [{ ...t, point, origin, distance: Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) }]; });
      for (const t of nearestTargets(hits, attack.maxTargets)) {
        const target = t.c ? fighters.get(t.c)! : playerFighter;
        const geometryOk = crossingOk(attack.crossing, ctx.queries, t.origin, t.point, attacker.L) && obstructionClear(ctx.queries, t.origin, t.point, attacker.L);
        requests.push({ attacker, target, action: a, attack, hitGroupId: a.grantId, origin: t.origin, point: t.point, geometryOk });
      }
    }
    for (const e of resolveAll(requests, now, statusOf)) {
      out.events.push(e);
      if (e.killed && e.killed !== PLAYER_ID) { const c = live.find(x => x.id === e.killed); if (c && !out.killed.includes(c.entity)) out.killed.push(c.entity); }
      const hurt = live.find(x => x.id === e.targetId); if (hurt && e.amount > 0) hurt.lastDamagedAt = now;
      if (e.targetId === PLAYER_ID) { const by = live.find(x => x.id === e.attackerId); if (by) by.lastAttackedPlayerAt = now; }
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
          hitStop: 0, impulse: { x: 0, y: 0, z: 0 }, status: null, caught: false, held: true, killed: null, time: now });
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
      ground: c.entity.spec.movementProfileId === 'sp-ground', grabbable: b.grabbable && !c.entity.spec.alpha, poise: c.poise, poiseMax: b.poise, staggerResist: b.staggerResist, health: c.entity.hp };
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
  speciesShapes(c: EntityCombat, a: ActionState, now: number): WorldShape[] {
    const attack = a.resolved.attack!, pose = this.poseOf(c.entity, now);
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
   *  Read-only for the combat state; `isOnScreen` takes a physical point. */
  telegraphs(now: number, isOnScreen: (p: Vec3) => boolean, groundAt: (x: number, z: number) => number): TelegraphView[] {
    const out: TelegraphView[] = [], seen = new Set<string>();
    for (const c of this.entities.values()) {
      if (c.entity.eaten || !c.entity.active) continue;
      for (const a of c.rt.actions) {
        if (a.phase !== 'windup' && a.phase !== 'active') continue;
        const attack = a.resolved.attack; if (!attack) continue;
        const profile = TELEGRAPHS[attack.telegraphProfileId]; if (!profile || profile.color === 'none') continue;
        const windup = windupLength(a), elapsed = c.rt.actionClock - a.phaseStartedAt, fill = a.phase === 'windup' ? elapsed / Math.max(1e-9, windup) : 1;
        const shapes = a.lockedShapes ?? this.speciesShapes(c, a, now), d = telegraphDescriptor(shapes, fill, profile.color, profile.pattern, a.aimLocked, groundAt), onScreen = isOnScreen(d.centroid);
        if (a.phase === 'windup' && !onScreen) this.arrowed.add(a.instanceId);
        seen.add(a.instanceId);
        const activeIn = a.phase === 'windup' ? Math.max(0, windup - elapsed) : 0;
        const flash = a.phase === 'windup' && (elapsed < WINDUP_FLASH - 1e-9 || activeIn <= profile.flashLeadSeconds + 1e-9);
        out.push({ ...d, actionId: a.instanceId, attackerId: c.id, entityId: c.entity.id, attackId: attack.id, phase: a.phase, onScreen, arrow: profile.edgeArrow && this.arrowed.has(a.instanceId), flash,
          cue: profile.poseCue, activeIn });
      }
    }
    for (const id of [...this.arrowed]) if (!seen.has(id)) this.arrowed.delete(id);
    return out;
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
