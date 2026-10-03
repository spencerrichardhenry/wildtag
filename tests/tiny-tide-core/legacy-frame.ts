// The main.ts frame before the sim.ts extraction (HEAD 450052a), ported line for line for the golden record (sim.test.ts,
// TIDE_SIM_RECORD=legacy). Only presentation is removed (DOM, audio, particles, toasts, the food guide, QA counters). The fix-round-4
// admission budget (stepCalls around stepPlayer, rescueBudget(stepCalls) for the rescue slice) is kept. Deleted after sim.ts matches it.
import { SIZES } from '../../src/tiny-tide/biomes';
import { newRuntime, type Actor, type Capsule, type CombatInput, type MutVec3, type Orientation, type RecoveryResult, type Vec3 } from '../../src/tiny-tide/combat-types';
import { provoke, entityRadius, type EcoEvent } from '../../src/tiny-tide/ecosystem';
import { derive, dietOf, effectiveStats } from '../../src/tiny-tide/genome';
import { basicRequested, RELEASED } from '../../src/tiny-tide/input';
import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, rescueBudget, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UnstickSearch, wedged } from '../../src/tiny-tide/lifecycle';
import { startAnchor } from '../../src/tiny-tide/motion';
import { bodyLengthOf, hullFitOf, hullOffsets, massFor } from '../../src/tiny-tide/mount';
import { orientedHeave, orientedSway, rotateInto } from '../../src/tiny-tide/orientation';
import { DROPS } from '../../src/tiny-tide/parts';
import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult } from '../../src/tiny-tide/player-motion';
import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { currentPlan, dietCanEat, eat, freshRun, growthOf, hurt, inReach, reward, STAGES, unlock } from '../../src/tiny-tide/state';
import { admissionCount, supportHeight } from '../../src/tiny-tide/world-queries';
import { round, world, type Sample, type Scenario } from './sim.test';

export function runLegacy(scenario: Scenario): Sample[] {
  const run = freshRun(scenario.seed), w = world(scenario.seed), legality = w.legality, START_GRACE = 2, out: Sample[] = [];
  let forcedSpawn: Vec3 | null = scenario.forced, trapRescues = 0;
  let mode = 'menu', rt = newRuntime(), physical: Vec3 = { x: 0, y: 0, z: 0 }, time = 0, cooldown = 0, sinceHit = 99, regenClock = 0, respawnClock = 0, stuckRetry = 0, startGracePending = false;
  let genomeRevision = 0, derived = derive(effectiveStats(run.genome, currentPlan(run))), lastIntent: CombatInput = RELEASED;
  const trapWatch = newTrapWatch(), beforeStep = newStepSnapshot();
  let stepCalls = 0, rescueCalls = 0;
  let unstick: UnstickSearch | null = null, glide: { path: { position: Vec3; orientation: Orientation }[]; index: number } | null = null;
  type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
  let actorCache: { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number } | null = null, hullRescaled = false, hullGrew = false;
  const refreshDerived = () => { derived = derive(effectiveStats(run.genome, currentPlan(run))); };
  function playerActorCached(): Actor {
    const plan = currentPlan(run), key = `${plan.id}:${genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
    if (!actorCache || actorCache.key !== key) {
      const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
      actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
    }
    const c = actorCache;
    if (c.scale !== scale) {
      c.unit.forEach((u, i) => { const h = c.hull[i]!; h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale; h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
        h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale; if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; } });
      hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; hullRescaled = true;
    }
    return c.actor;
  }
  const capsOf = () => movementCapabilities(currentPlan(run));
  const hullBuffer: { start: MutVec3; end: MutVec3; radius: number; sway: number; heave: number }[] = [];
  function worldHull(actor: Actor): Capsule[] {
    const o = rt.orientation, h = actor.hull;
    while (hullBuffer.length < h.length) hullBuffer.push({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, sway: 0, heave: 0 });
    hullBuffer.length = h.length;
    for (let i = 0; i < h.length; i++) { const c = h[i]!, b = hullBuffer[i]!, wy = c.sway ?? 0, v = c.heave ?? 0; rotateInto(o, c.start, b.start); rotateInto(o, c.end, b.end);
      b.start.x += physical.x; b.start.y += physical.y; b.start.z += physical.z; b.end.x += physical.x; b.end.y += physical.y; b.end.z += physical.z; b.radius = c.radius; b.sway = orientedSway(wy, v, o.pitch); b.heave = orientedHeave(wy, v, o.pitch); }
    return hullBuffer;
  }
  function settleOffset(actor: Actor) { const t = legality(run.stage).queries.terrain; rt.groundOffset = capsOf().ground && !t.space ? Math.max(0, physical.y - (supportHeight(actor, physical.x, physical.z, rt.orientation, t) + .01 * actor.bodyLength)) : 0; }
  function cancelRescue() { unstick = null; glide = null; trapWatch.armed = false; }
  function installPose(pose: { position: Vec3; orientation: Orientation }, actor: Actor, _snap = false, rescue = false) {
    if (!rescue) cancelRescue();
    physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
    rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 }; settleOffset(actor);
  }
  const anchorFor = (actor: Actor): RecoveryResult => startAnchor(actor, run.stage, legality(run.stage));
  const admitted = (actor: Actor) => legality(run.stage).queries.overlapHull(actor, physical, rt.orientation, { time, permit: rt.permit, bounds: legality(run.stage).bounds }).ok;
  function recover(actor: Actor, at: number, from: Vec3 = physical): boolean { const rec = recoverPlayer(actor, from, rt.orientation, { ...legality(run.stage), time: at }, anchorFor(actor), 20 * actor.bodyLength); if (!rec.ok) return false; installPose(rec, actor); return true; }
  function applyStartGrace() { rt.invulnerableUntil = START_GRACE > 0 ? time + START_GRACE : 0; }
  // main.ts enterStuck also calls clearInput(), which resets lastIntent to RELEASED. Not ported: the scripted input is not cleared (no
  // golden scenario gets stuck). T6b: main.ts clears input on the sim's `stuck` event.
  function enterStuck() { mode = 'stuck'; stuckRetry = 1; }
  function checkPose(actor: Actor) { cancelRescue(); if (admitted(actor)) settleOffset(actor); else if (!recover(actor, time)) enterStuck(); }
  function checkGrownPose(actor: Actor) { const lifted = growthPose(actor, physical, rt, { ...legality(run.stage), time }); if (!lifted) { checkPose(actor); return; } cancelRescue(); physical = lifted; settleOffset(actor); }
  function tryRespawn(): boolean { const actor = playerActorCached(), anchor = anchorFor(actor); if (!anchor.ok || !resolveRespawn(run, rt, time, anchor)) return false; installPose(anchor, actor, true); refreshDerived(); return true; }
  // main.ts chomp/biteTargets: world.player.position is physical / world.scale and food.data is entity / world.scale (world.scale is
  // SIZES[stage] outside a transformation), so the same stage-local positions are computed here from the physical ones.
  function chomp() {
    if (mode !== 'playing' || cooldown > 0) return;
    cooldown = .24;
    const size = SIZES[run.stage]!, p = { x: physical.x / size, y: physical.y / size, z: physical.z / size }, growth = growthOf(run), diet = dietOf(run.genome);
    const targets: { e: typeof w.eco.entities[number]; edible: boolean; distance: number }[] = [];
    for (const e of w.eco.entities) {
      if (e.eaten) continue;
      const attacking = e.mode === 'hunt' || e.mode === 'angry', tier = e.spec.tier;
      if (tier !== run.stage && !(attacking && tier === run.stage + 1)) continue;
      const radius = tier > run.stage ? entityRadius(e) / size : 0, food = { x: e.x / size, y: e.y / size, z: e.z / size };
      if (!inReach(run.stage, p, food, growth, derived.reach, radius)) continue;
      const edible = tier === run.stage && dietCanEat(diet, e.spec.tag);
      if (!edible && !attacking && !e.spec.fights) continue;
      targets.push({ e, edible, distance: Math.hypot(food.x - p.x, food.y - p.y, food.z - p.z) });
    }
    const hit = targets.sort((a, b) => a.distance - b.distance)[0]; if (!hit) return;
    const e = hit.e, bigger = e.spec.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
    if (e.spec.hp > 1 || bigger) { e.hp -= damage; provoke(e, physical, time, worldHull(playerActorCached())); if (e.hp > 0) return; }
    const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop);
    if (hit.edible) eat(run, e.spec, e.spec.kind === 'planet' ? w.eco.planetIndex(e) : e.id); else reward(run, Math.round(e.spec.dna * .5), e.spec.tier === run.stage);
    w.eco.consume(e);
  }
  function takeHit(event: EcoEvent) {
    sinceHit = 0; const fainted = hurt(run, event.damage, derived.armor); if (!fainted) return;
    // main.ts takeHit also calls clearInput() here (lastIntent = RELEASED). Not ported: the faint scenarios do not read input while
    // fainted, and the script's previous intent only feeds the tap edges. T6b: main.ts clears input on a `hurt` event with `fainted: true`.
    if (!beginRespawn(run, rt)) return; mode = 'fainted'; respawnClock = 1.8;
  }
  function tickFaint(dt: number) { respawnClock -= dt; if (respawnClock > 0) return; if (tryRespawn()) { mode = 'playing'; sinceHit = 99; return; } respawnClock = 1; }
  // begin()
  w.eco.reset(run.eatenPlanets); refreshDerived(); run.health = Math.min(run.health, derived.maxHealth); mode = 'playing'; cooldown = 0; sinceHit = 99;
  rt = newRuntime(); genomeRevision++; cancelRescue(); startGracePending = false;
  { const actor = playerActorCached(), t = legality(run.stage).queries.terrain; physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
    const anchor = anchorFor(actor), forced = forcedSpawn; forcedSpawn = null;
    const start: RecoveryResult = forced && anchor.ok ? recoverPlayer(actor, { x: forced.x * SIZES[run.stage]!, y: forced.y * SIZES[run.stage]!, z: forced.z * SIZES[run.stage]! }, anchor.orientation,
      { ...legality(run.stage), time }, anchor, 20 * actor.bodyLength) : anchor;
    if (start.ok) { rt = newRuntime(start.orientation); installPose(start, actor, true); applyStartGrace(); } else { enterStuck(); startGracePending = true; } }
  for (let f = 1; f <= scenario.frames; f++) {
    const dt = 1 / 60, held = false;
    // frame(): verbatim order.
    stepCalls = 0; rescueCalls = 0;
    const active = !held && (mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted');
    const stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
    const actor = mode === 'menu' ? null : playerActorCached();
    if (actor && hullRescaled) { const grew = hullGrew; hullRescaled = false; hullGrew = false; if (mode === 'playing') { if (grew) checkGrownPose(actor); else checkPose(actor); } else settleOffset(actor); }
    if (mode === 'playing' && actor && !held) {
      run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); sinceHit += dt;
      if (sinceHit > 5 && run.health < derived.maxHealth) { regenClock += dt; if (regenClock > 2.5) { regenClock = 0; run.health = Math.min(derived.maxHealth, run.health + 1); } } else regenClock = 0;
      const { intent, wish } = scenario.script(time, lastIntent); lastIntent = intent;
      const legal = legality(stage);
      snapshotStep(rt, beforeStep);
      let r: PlayerStepResult;
      if (glide) {
        const pose = glide.path[glide.index++];
        if (pose && legal.queries.overlapHull(actor, pose.position, pose.orientation, { time: time + dt, bounds: legal.bounds }).ok) installPose(pose, actor, false, true); else glide = null;
        if (glide && glide.index >= glide.path.length) glide = null;
        r = { position: physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
      } else stepCalls = admissionCount.n, r = stepPlayer(physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * derived.speedFactor, now: time, dt, wish, aim: null, actionLock: false });
      stepCalls = admissionCount.n - stepCalls;
      if (!r.needsRecovery) physical = r.position; else if (!recover(actor, time + dt, r.position)) { restoreStep(rt, beforeStep); enterStuck(); }
      if (!glide && !r.needsRecovery && !unstick && trapDue(trapWatch, physical, wish, actor.bodyLength, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), dt))
        unstick = new UnstickSearch(actor, { ...physical }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { ...legal, time: time + dt, ground: caps.ground && !legal.queries.terrain.space }, rescueFreeRun(trapWatch, physical, time, actor.bodyLength));
      if (unstick) {
        const spent = unstick.spent, u = Math.hypot(physical.x - unstick.at.x, physical.z - unstick.at.z) > TRAP_MOVE * actor.bodyLength ? { ok: false as const, reason: 'moved' } : unstick.step(rescueBudget(stepCalls));
        rescueCalls = unstick.spent - spent;
        if (u) { if (u.ok) { glide = { path: u.path, index: 0 }; trapRescues++; trapRescued(trapWatch, unstick.at, time); } else if (u.reason !== 'moved') trapFailed(trapWatch, unstick.at, wish); unstick = null; }
      }
      if (mode === 'playing' && basicRequested(intent)) chomp();
    }
    if (mode === 'stuck' && actor) { stuckRetry -= dt; if (stuckRetry <= 0) { stuckRetry = 1; if (recover(actor, time)) { if (startGracePending) { startGracePending = false; applyStartGrace(); } mode = 'playing'; } } }
    if ((mode === 'playing' || mode === 'evolving' || mode === 'fainted') && actor && !held) {
      const events = w.eco.step({ stage, dt, now: time, player: physical, playerHull: worldHull(actor), perceivable: rt.perceivable && mode !== 'fainted', stealthFactor: derived.stealthFactor });
      const accepted = resolveHazards(events, { mode, pendingRespawn: run.pendingRespawn, rt, now: time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
      for (const event of accepted) { if (mode !== 'playing') break; takeHit(event); }
    }
    if (mode === 'fainted') tickFaint(dt);
    if (active) time += dt;
    if (f % scenario.every === 0) out.push({ t: round(time), x: round(physical.x), y: round(physical.y), z: round(physical.z), health: run.health, stageDna: run.stageDna, dna: run.economy.wallet.atRisk + run.economy.wallet.banked, bites: run.bites, mode, rescues: trapRescues, deaths: run.deaths });
  }
  void rescueCalls;
  return out;
}
