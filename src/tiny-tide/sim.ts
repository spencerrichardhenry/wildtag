// One pure game tick (spec D29), moved out of main.ts in the same order: the growth check, the player step (with recovery, the trap
// watch and the rescue glide), the combat tick (T8: new, after the step and before the chomp), the chomp, the stuck retry, the ecosystem, hazards and faint, the respawn timer, and the game clock.
// main.ts and the combat probe both call it. It returns events; main.ts turns them into sound, particles, toasts and saves.
import { SIZES } from './biomes';
import { clearBuffer } from './action-engine';
import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRuntime, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
import type { Ecosystem, EcoEvent } from './ecosystem';
import { chomp, CHOMP_COOLDOWN, type ChompResult } from './feeding';
import { derive, dietOf, effectiveStats, type Derived } from './genome';
import { basicRequested } from './input';
import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, rescueBudget, UnstickSearch, wedged, type TrapWatch } from './lifecycle';
import { startAnchor } from './motion';
import { bodyLengthOf, hullFitOf, hullOffsets, massFor, sampleCombatPose } from './mount';
import { CombatWorld, playerMatrix, type CombatTick, type MotionBody, type PlayerBody } from './combat-world';
import { assignSlots, movesOf, NO_PINS, type MoveSet, type SlotAssignment } from './moves';
import { DROPS } from './parts';
import { createRigPose, type RigPose } from './rig';
import { orientedHeave, orientedSway, rotateInto } from './orientation';
import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
import { habitat, movement, movementCapabilities } from './profiles';
import { currentPlan, evolveReady, growthOf, hurt, STAGES, unlock, type Run } from './state';
import { admissionClock, admissionCount, supportHeight } from './world-queries';

export type GameMode = 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won';
export interface SimLegality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
/** What the tick reads from outside: the ecosystem, the cached world queries of a stage, and the start grace (seconds). `qa`: keep the
 *  QA-only diagnostics (`lastSolids`, read by the rescue log); off in production, as main.ts did with its QA flag. */
export interface SimWorld { eco: Ecosystem; legality(stage: number): SimLegality; startGrace: number; qa?: boolean }
type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
interface ActorCache { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number }
export interface Glide { path: { position: Vec3; orientation: Orientation }[]; index: number }
export interface RescueLog { searches: number; found: number; failed: number; last: null | { from: Vec3; to: Vec3; time: number; solids: string[] } }
export interface SimState {
  run: Run; rt: CombatRuntime; physical: Vec3; time: number; mode: GameMode; derived: Derived; genomeRevision: number;
  chompCooldown: number; sinceHit: number; regenClock: number; respawnClock: number; stuckRetry: number;
  /** A run that began stuck owes its start grace to the first successful install. */
  startGracePending: boolean;
  trap: TrapWatch; unstick: UnstickSearch | null; glide: Glide | null; beforeStep: StepSnapshot;
  rescueLog: RescueLog; trapRescues: number; lastSolids: string[];
  /** Admissions of this frame's player step and rescue slice (fix round 4: the slice gets what the step left of FRAME_ADMISSIONS).
   *  main.ts reads them for its QA admission stats. */
  stepCalls: number; rescueCalls: number;
  actorCache: ActorCache | null; hullRescaled: boolean; hullGrew: boolean;
  acceptedHits: number; rejectedHits: number; faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[];
  /** The combat world (spec §3.1) and the player's moves, cached per genome revision. */
  combat: CombatWorld; moves: { revision: number; set: MoveSet; slots: SlotAssignment; rig: RigPose } | null;
  /** The previous tick's stick (break-free flicks). */
  previousMove: Vec3;
}
export type SimEvent =
  /** A pose was installed (`snap`: the camera jumps there too: start, respawn). */
  | { type: 'installed'; snap: boolean }
  | { type: 'step'; result: PlayerStepResult }
  | { type: 'stuck' } | { type: 'unstuck' }
  | { type: 'chomp'; result: ChompResult }
  /** One combat tick's outcome (hits, kills, the moves the player started, a break-free). */
  | { type: 'combat'; tick: CombatTick }
  | { type: 'regen' }
  /** An accepted hazard hit; `fainted` when it emptied the hearts (the run is already marked; save it at once). */
  | { type: 'hurt'; event: EcoEvent; damage: number; fainted: boolean }
  | { type: 'respawned' } | { type: 'respawn-waiting' }
  /** Combat damage emptied the hearts (the run is already marked; save it at once). */
  | { type: 'fainted' }
  /** A loaded run that was saved during a faint found no anchor yet: it waits fainted (main shows the faint overlay). */
  | { type: 'resume-fainted' };
export interface SimInput { dt: number; intent: CombatInput; wish: Vec3; held: boolean }

type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'stepCalls' | 'rescueCalls' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog' | 'combat' | 'moves' | 'previousMove'>;
/** The fields only the simulation owns (main.ts spreads them into its bound state). */
export const simOwnedState = (): SimOwned => ({ trap: newTrapWatch(), unstick: null, glide: null, beforeStep: newStepSnapshot(), rescueLog: { searches: 0, found: 0, failed: 0, last: null },
  trapRescues: 0, lastSolids: [], stepCalls: 0, rescueCalls: 0, actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [], combat: new CombatWorld(), moves: null, previousMove: { x: 0, y: 0, z: 0 } });
/** A plain state (tests and the combat probe). */
export function newSimState(run: Run): SimState {
  return { run, rt: newRuntime(), physical: { x: 0, y: 0, z: 0 }, time: 0, mode: 'menu', derived: derive(effectiveStats(run.genome, currentPlan(run))), genomeRevision: 0,
    chompCooldown: 0, sinceHit: 99, regenClock: 0, respawnClock: 0, stuckRetry: 0, startGracePending: false, acceptedHits: 0, rejectedHits: 0, ...simOwnedState() };
}
export function refreshDerived(s: SimState): void { s.derived = derive(effectiveStats(s.run.genome, currentPlan(s.run))); }
const capsOf = (s: SimState) => movementCapabilities(currentPlan(s.run));
/** The player's actor. The hull is rebuilt only when the plan, the genome revision or the stage changes; a growth change rescales the
 *  cached buffers in place to the exact growth (no bucket) and sets `hullRescaled` (`hullGrew` when only the growth changed). */
export function playerActorCached(s: SimState): Actor {
  const run = s.run, plan = currentPlan(run), key = `${plan.id}:${s.genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
  if (!s.actorCache || s.actorCache.key !== key) {
    const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
    s.actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
  }
  const c = s.actorCache;
  if (c.scale !== scale) {
    c.unit.forEach((u, i) => {
      const h = c.hull[i]!;
      h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale;
      h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
      h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale;
      if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; }
    });
    s.hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; s.hullRescaled = true;
  }
  return c.actor;
}
const hullBuffer: { start: MutVec3; end: MutVec3; radius: number; sway: number; heave: number }[] = [];
/** The player's hull in world space; the buffer is reused every call (its readers copy what they keep). */
export function worldHull(s: SimState, actor: Actor): Capsule[] {
  const o = s.rt.orientation, h = actor.hull, p = s.physical;
  while (hullBuffer.length < h.length) hullBuffer.push({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, sway: 0, heave: 0 });
  hullBuffer.length = h.length;
  for (let i = 0; i < h.length; i++) {
    const c = h[i]!, b = hullBuffer[i]!, w = c.sway ?? 0, v = c.heave ?? 0;
    rotateInto(o, c.start, b.start); rotateInto(o, c.end, b.end);
    b.start.x += p.x; b.start.y += p.y; b.start.z += p.z; b.end.x += p.x; b.end.y += p.y; b.end.z += p.z;
    b.radius = c.radius; b.sway = orientedSway(w, v, o.pitch); b.heave = orientedHeave(w, v, o.pitch);
  }
  return hullBuffer;
}
/** The grounded offset against the support under the current pose (0 when supported or not grounded). */
export function settleOffset(s: SimState, w: SimWorld, actor: Actor): void {
  const t = w.legality(s.run.stage).queries.terrain, p = s.physical;
  s.rt.groundOffset = capsOf(s).ground && !t.space ? Math.max(0, p.y - (supportHeight(actor, p.x, p.z, s.rt.orientation, t) + .01 * actor.bodyLength)) : 0;
}
/** Ends a pending rescue search or glide and restarts the trap watch. Every install but a rescue glide step calls it. */
export function cancelRescue(s: SimState): void { s.unstick = null; s.glide = null; s.trap.armed = false; }
/** Installs an admitted full pose: position and orientation together, no permit or arc, zero velocities. */
export function installPose(s: SimState, w: SimWorld, pose: { position: Vec3; orientation: Orientation }, actor: Actor, events: SimEvent[], snap = false, rescue = false): void {
  if (!rescue) cancelRescue(s);
  s.physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; s.rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
  s.rt.permit = null; s.rt.arc = null; s.rt.controlledVelocity = { x: 0, y: 0, z: 0 }; s.rt.externalVelocity = { x: 0, y: 0, z: 0 };
  settleOffset(s, w, actor);
  events.push({ type: 'installed', snap });
}
export const anchorFor = (s: SimState, w: SimWorld, actor: Actor): RecoveryResult => startAnchor(actor, s.run.stage, w.legality(s.run.stage));
export const admitted = (s: SimState, w: SimWorld, actor: Actor): boolean => {
  const l = w.legality(s.run.stage); return l.queries.overlapHull(actor, s.physical, s.rt.orientation, { time: s.time, permit: s.rt.permit, bounds: l.bounds }).ok;
};
/** Recovers to an admitted full pose, searching from `from` (default: the installed pose). A failed pose is never installed. */
export function recover(s: SimState, w: SimWorld, actor: Actor, at: number, events: SimEvent[], from: Vec3 = s.physical): boolean {
  const rec = recoverPlayer(actor, from, s.rt.orientation, { ...w.legality(s.run.stage), time: at }, anchorFor(s, w, actor), 20 * actor.bodyLength);
  if (!rec.ok) return false;
  installPose(s, w, rec, actor, events); return true;
}
export function applyStartGrace(s: SimState, w: SimWorld): void { s.rt.invulnerableUntil = w.startGrace > 0 ? s.time + w.startGrace : 0; }
export function enterStuck(s: SimState, events: SimEvent[]): void { s.mode = 'stuck'; s.stuckRetry = 1; events.push({ type: 'stuck' }); }
/** After an edit, a growth change or a transformation: settle on the support, or recover when the body is not admitted. */
export function checkPose(s: SimState, w: SimWorld, actor: Actor, events: SimEvent[]): void {
  cancelRescue(s);
  if (admitted(s, w, actor)) settleOffset(s, w, actor);
  else if (!recover(s, w, actor, s.time, events)) enterStuck(s, events);
}
/** After a growth rescale: the smallest admitted lift of the grown body, with both velocities kept; else the normal recovery. */
export function checkGrownPose(s: SimState, w: SimWorld, actor: Actor, events: SimEvent[]): void {
  const lifted = growthPose(actor, s.physical, s.rt, { ...w.legality(s.run.stage), time: s.time });
  if (!lifted) { checkPose(s, w, actor, events); return; }
  cancelRescue(s); s.physical = lifted; settleOffset(s, w, actor);
}
/** Completes a pending respawn at the start anchor for the actual growth. The caller saves. */
export function tryRespawn(s: SimState, w: SimWorld, events: SimEvent[]): boolean {
  const actor = playerActorCached(s), anchor = anchorFor(s, w, actor);
  if (!anchor.ok || !resolveRespawn(s.run, s.rt, s.time, anchor)) return false;
  installPose(s, w, anchor, actor, events, true); refreshDerived(s); return true;
}

/** The player's moves and slots, cached per genome revision (pins: none until the loadout carries them). */
export function playerMoves(s: SimState): NonNullable<SimState['moves']> {
  if (!s.moves || s.moves.revision !== s.genomeRevision) s.moves = { revision: s.genomeRevision, set: movesOf(s.run.genome), slots: assignSlots(s.run.genome, NO_PINS), rig: createRigPose(s.run.genome) };
  return s.moves;
}
/** The middle of the player's world hull (read from the shared worldHull buffer at once). */
function hullCentre(s: SimState, actor: Actor): Vec3 {
  const hull = worldHull(s, actor), first = hull[0]!, last = hull[hull.length - 1]!;
  return { x: (first.start.x + last.end.x) / 2, y: (first.start.y + last.end.y) / 2, z: (first.start.z + last.end.z) / 2 };
}
/** What the combat motion of the player step reads: no combat pose is sampled (review R18). */
export const playerMotionBody = (s: SimState, actor: Actor): MotionBody => ({ rt: s.rt, centre: hullCentre(s, actor), L: actor.bodyLength });
/** The player's combat body at its installed pose (spec §5.10: sampleCombatPose on the rest rig). The centre is the middle of the hull.
 *  simFrame samples it once per frame, after the player step (review R18). */
export function playerBody(s: SimState, actor: Actor): PlayerBody {
  const plan = currentPlan(s.run), m = playerMoves(s), scale = SIZES[s.run.stage]! * growthOf(s.run), caps = movementCapabilities(plan);
  const pose = sampleCombatPose({ actorId: 'player', genome: s.run.genome, plan, world: playerMatrix(s.physical, s.rt.orientation, scale), rig: m.rig, physicalLength: actor.bodyLength });
  const centre = hullCentre(s, actor);
  return { rt: s.rt, position: s.physical, centre, L: actor.bodyLength, mass: massFor(plan, s.run.genome, actor.bodyLength), knockbackResistance: plan.physics.knockbackResistance,
    armor: s.derived.armor, ground: caps.ground, mode: movement(plan.movement).mode, inBreachArc: s.rt.arc !== null, health: s.run.health, pose };
}
/** A faint at 0 hearts, once (the hazard path and the combat path share it). */
function faintNow(s: SimState): boolean {
  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
  if (!beginRespawn(s.run, s.rt)) return false;
  s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
  return true;
}
/** One frame of the simulation (main.ts `frame` without presentation). */
export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[] {
  const events: SimEvent[] = [], { dt, held } = input, run = s.run;
  s.stepCalls = 0; s.rescueCalls = 0;
  // The game clock runs in these modes only (not while paused, editing, stuck or won).
  const active = !held && (s.mode === 'playing' || s.mode === 'menu' || s.mode === 'evolving' || s.mode === 'fainted');
  const stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
  const actor = s.mode === 'menu' ? null : playerActorCached(s);
  if (actor && s.hullRescaled) {
    // A growth change rescaled the hull: settle again, or recover if the bigger body is not admitted.
    const grew = s.hullGrew; s.hullRescaled = false; s.hullGrew = false;
    if (s.mode === 'playing') { if (grew) checkGrownPose(s, w, actor, events); else checkPose(s, w, actor, events); } else settleOffset(s, w, actor);
  }
  if (s.mode === 'playing' && actor && !held) {
    run.elapsed += dt; s.chompCooldown = Math.max(0, s.chompCooldown - dt); s.sinceHit += dt;
    // Hearts come back slowly once the creature is out of danger.
    if (s.sinceHit > 5 && run.health < s.derived.maxHealth) { s.regenClock += dt; if (s.regenClock > 2.5) { s.regenClock = 0; run.health = Math.min(s.derived.maxHealth, run.health + 1); events.push({ type: 'regen' }); } } else s.regenClock = 0;
    const intent = input.intent, wish = input.wish, legal = w.legality(stage), rt = s.rt;
    snapshotStep(rt, s.beforeStep);
    // A rescue glides the body along its admitted path, one pose a frame, re-admitted for the current body.
    let r: PlayerStepResult;
    if (s.glide) {
      const pose = s.glide.path[s.glide.index++];
      if (pose && legal.queries.overlapHull(actor, pose.position, pose.orientation, { time: s.time + dt, bounds: legal.bounds }).ok) installPose(s, w, pose, actor, events, false, true);
      else s.glide = null;
      if (s.glide && s.glide.index >= s.glide.path.length) s.glide = null;
      r = { position: s.physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
    } else s.stepCalls = admissionCount.n, r = stepPlayer(s.physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * s.derived.speedFactor,
      now: s.time, dt, wish, aim: null, actionLock: false, combat: s.combat.playerMotion(playerMotionBody(s, actor), intent, s.time) });
    // As main.ts at HEAD: after a glide step stepCalls is the running admissionCount (it was 0), so a search started in that frame
    // gets rescueBudget 0 and begins next frame.
    s.stepCalls = admissionCount.n - s.stepCalls;
    // A result that needs recovery is never installed: recover from it, or keep the last legal pose while stuck.
    if (!r.needsRecovery) s.physical = r.position;
    else if (!recover(s, w, actor, s.time + dt, events, r.position)) { restoreStep(rt, s.beforeStep); enterStuck(s, events); }
    // A trapped body (pushed, really wedged on most frames, no progress for TRAP_SECONDS) glides to the nearest admitted pose that faces
    // the push. The search spends what the step left of FRAME_ADMISSIONS a frame (rescueBudget; fix round 4) and goes on next frame
    // where it stopped; it is dropped when the body moves away on its own.
    if (!s.glide && !r.needsRecovery && !s.unstick && trapDue(s.trap, s.physical, wish, actor.bodyLength, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), dt))
      { s.unstick = new UnstickSearch(actor, { ...s.physical }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { ...legal, time: s.time + dt, ground: caps.ground && !legal.queries.terrain.space }, rescueFreeRun(s.trap, s.physical, s.time, actor.bodyLength)); s.rescueLog.searches++; }
    if (s.unstick) {
      const spent = s.unstick.spent, u = Math.hypot(s.physical.x - s.unstick.at.x, s.physical.z - s.unstick.at.z) > TRAP_MOVE * actor.bodyLength ? { ok: false as const, reason: 'moved' } : s.unstick.step(rescueBudget(s.stepCalls));
      s.rescueCalls = s.unstick.spent - spent;
      if (u) {
        if (u.ok) { s.rescueLog.found++; s.rescueLog.last = { from: { ...s.unstick.at }, to: { ...u.position }, time: s.time, solids: [...s.lastSolids] }; s.glide = { path: u.path, index: 0 }; s.trapRescues++; trapRescued(s.trap, s.unstick.at, s.time); }
        else if (u.reason !== 'moved') { s.rescueLog.failed++; trapFailed(s.trap, s.unstick.at, wish); }
        s.unstick = null;
      }
    }
    if (w.qa) s.lastSolids = r.contacts.filter(c => c.solidId).map(c => c.solidId!);
    events.push({ type: 'step', result: r });
    s.combat.onPlayerStep(rt, r, s.time);
    // The combat world (spec §3.1; T8 decision: after the player step, before the chomp): the player's moves, every action, hits, holds
    // and kills. The basic input that finds no combat species in the Bite cone falls back to today's chomp, before the ecosystem moves.
    if (s.mode === 'playing') {
      const body = playerBody(s, actor), m = playerMoves(s);   // the one combat-pose sample of this frame (review R18)
      const tick = s.combat.tick({ now: s.time, dt, playing: true, intent, wish, previousMove: s.previousMove, player: body, moves: m.set, slots: m.slots, entities: w.eco.entities,
        stage, diet: dietOf(run.genome), queries: legal.queries });
      run.health = body.health; s.previousMove = intent.move;
      if (tick.events.length || tick.killed.length || tick.started.length || tick.brokeFree) events.push({ type: 'combat', tick });
      for (const e of tick.killed) { const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop); w.eco.consume(e); s.combat.forget(e); }
      if (run.health <= 0 && faintNow(s)) events.push({ type: 'fainted' });
      if (s.mode === 'playing' && tick.chomp && basicRequested(intent) && s.chompCooldown <= 0) {
        s.chompCooldown = CHOMP_COOLDOWN;
        events.push({ type: 'chomp', result: chomp(run, w.eco, s.physical, growthOf(run), s.derived, s.time, worldHull(s, playerActorCached(s))) });
      }
    }
  }
  if (s.mode === 'stuck' && actor) {
    // The game clock is stopped; a separate countdown retries recovery once per second.
    s.stuckRetry -= dt;
    if (s.stuckRetry <= 0) { s.stuckRetry = 1; if (recover(s, w, actor, s.time, events)) { if (s.startGracePending) { s.startGracePending = false; applyStartGrace(s, w); } s.mode = 'playing'; events.push({ type: 'unstuck' }); } }
  }
  if ((s.mode === 'playing' || s.mode === 'evolving' || s.mode === 'fainted') && actor && !held) {
    admissionClock.caller = 'ecosystem';
    const hazards = w.eco.step({ stage, dt, now: s.time, player: s.physical, playerHull: worldHull(s, actor), perceivable: s.rt.perceivable && s.mode !== 'fainted', stealthFactor: s.derived.stealthFactor });
    admissionClock.caller = 'player';
    const accepted = resolveHazards(hazards, { mode: s.mode, pendingRespawn: run.pendingRespawn, rt: s.rt, now: s.time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
    s.rejectedHits += hazards.length - accepted.length;
    // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
    for (const event of accepted) { if (s.mode !== 'playing') break; s.acceptedHits++; takeHit(s, event, events); }
  }
  if (s.mode === 'fainted') tickFaint(s, w, dt, events);
  if (active) s.time += dt;
  return events;
}
/** One accepted hazard event: damage, and a faint at 0 hearts (once). */
function takeHit(s: SimState, event: EcoEvent, events: SimEvent[]): void {
  s.sinceHit = 0;
  const fainted = hurt(s.run, event.damage, s.derived.armor) && faintNow(s);
  events.push({ type: 'hurt', event, damage: event.damage, fainted });
}
/** The faint timer: respawn at the start anchor, or wait and retry each second. */
function tickFaint(s: SimState, w: SimWorld, dt: number, events: SimEvent[]): void {
  s.respawnClock -= dt; if (s.respawnClock > 0) return;
  if (tryRespawn(s, w, events)) { s.mode = 'playing'; s.sinceHit = 99; events.push({ type: 'respawned' }); return; }
  s.respawnClock = 1; events.push({ type: 'respawn-waiting' });
}
/** A new run or a load (main.ts `begin`, after the world is built): a fresh runtime, then the pending respawn, or the start anchor (or a
 *  forced spawn, recovered like any other pose). */
export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null): SimEvent[] {
  const events: SimEvent[] = [];
  s.run = run; refreshDerived(s); run.health = Math.min(run.health, s.derived.maxHealth);
  s.mode = 'playing'; s.chompCooldown = 0; s.sinceHit = 99;
  s.rt = newRuntime(); s.genomeRevision++; cancelRescue(s); s.startGracePending = false; s.combat.reset(); s.previousMove = { x: 0, y: 0, z: 0 };
  s.faintLog.length = 0; s.acceptedHits = 0; s.rejectedHits = 0;
  const actor = playerActorCached(s), t = w.legality(run.stage).queries.terrain;
  s.physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
  events.push({ type: 'installed', snap: true });
  if (run.pendingRespawn) {
    // A save made during a faint resolves once, before play starts.
    if (!tryRespawn(s, w, events)) { s.mode = 'fainted'; s.respawnClock = 1; events.push({ type: 'resume-fainted' }); }
  } else {
    const anchor = anchorFor(s, w, actor), size = SIZES[run.stage]!;
    const start: RecoveryResult = forced && anchor.ok ? recoverPlayer(actor, { x: forced.x * size, y: forced.y * size, z: forced.z * size }, anchor.orientation,
      { ...w.legality(run.stage), time: s.time }, anchor, 20 * actor.bodyLength) : anchor;
    if (start.ok) { s.rt = newRuntime(start.orientation); installPose(s, w, start, actor, events, true); applyStartGrace(s, w); }
    else { enterStuck(s, events); s.startGracePending = true; }
  }
  return events;
}
/** The game stops for a pause, a help dialog or the editor (spec §5.7, review R19): nothing is buffered across it, so the buffered press is
 *  dropped (the action clock is stopped while the game is stopped, so the press would otherwise survive). */
export function simSuspend(s: SimState, mode: 'paused' | 'editing'): void { s.mode = mode; clearBuffer(s.rt); }
/** A committed evolution: the runtime resets with the destination's orientation; the body goes to the destination. */
export function simEvolve(s: SimState, destination: { position: Vec3; orientation: Orientation }): void {
  resetRuntime(s.rt, destination.orientation); s.genomeRevision++; refreshDerived(s);
  cancelRescue(s); s.physical = { ...destination.position };
}
export { evolveReady };
