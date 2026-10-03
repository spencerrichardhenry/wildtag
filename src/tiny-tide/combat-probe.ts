// The headless combat balance probe (spec §14.3, D35; plan review R12). It runs sim.ts — the real player step, ecosystem and combat world —
// with bots, at dt = 1/30, and measures P0–P8. Pure: no DOM, no timers, no storage; the test writes the report. It proposes no tuning.
import { SIZES } from './biomes';
import type { AttackSpec, CombatInput, CombatRuntime, ActionState, MoveKind, Vec3 } from './combat-types';
import { Ecosystem, type Entity } from './ecosystem';
import { readIntent, RELEASED, type InputSources } from './input';
import { newSimState, playerActorCached, playerBody, playerMoves, simBegin, simFrame, type SimEvent, type SimState, type SimWorld } from './sim';
import { stageBounds, stageWorldQueries } from './world-queries';
import { applyDesign, commitEvolution, currentPlan, dietCanEat, evolveReady, freshRun, maxHealthOf, prepareEvolution, STAGES, validateRun, type Build, type Run } from './state';
import { adaptToPlan, cloneGenome, nextUid, type Genome } from './genome';
import { plan as planById } from './plans';
import { part } from './parts';
import { startAnchor } from './motion';
import { playerActor, speciesCombatPose } from './mount';
import { BEHAVIOURS, hostileSizes, SPECIES_ATTACKS, type AttackChoice } from './bestiary';
import { SPECIES } from './species';
import { PLAYER_ID } from './combat-world';
import { activeStartedAt, liveActions, phaseRemaining, recoveryLength, windupLength, activeLength, holdLength } from './action-engine';
import { closestOnSegment, shapeCentroid } from './combat-shapes';
import { aiStarted } from './combat-ai';
import { movementCapabilities } from './profiles';

export const PROBE_DT = 1 / 30;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 }; };
const flat = (a: Vec3): Vec3 => unit({ x: a.x, y: 0, z: a.z });
export const median = (xs: readonly number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN; };

// ---- the camera model (spec §14.3): 6 L behind and 2 L above the player, looking at it, 60° vertical field of view, 16:9 ----
const TAN_V = Math.tan(30 * Math.PI / 180), TAN_H = TAN_V * 16 / 9;
export function onScreenFrom(player: Vec3, yaw: number, L: number, p: Vec3): boolean {
  const f = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, eye = { x: player.x - 6 * L * f.x, y: player.y + 2 * L, z: player.z - 6 * L * f.z };
  const look = unit(sub(player, eye)), right = unit(cross(look, UP)), up = cross(right, look), d = sub(p, eye), z = dot(d, look);
  return z > 0 && Math.abs(dot(d, up) / z) <= TAN_V && Math.abs(dot(d, right) / z) <= TAN_H;
}

// ---- builds (the fixture page's construction, with the game's own modules) ----
export interface PartIn { id: string; scale?: number; mirror?: boolean }
/** A build: the mouth of size 0 and size 1, parts added at its last size, and the line it evolves along. */
export interface ProbeBuild { label: string; stage: 0 | 1; line: 'swimmer' | 'crawler'; mouths: [string, string]; add: PartIn[] }
type Legality = { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> };
/** The world queries of a seed are costly: the probe keeps the last few seeds (the trials loop seeds in the outer loop). */
const legalities = new Map<string, Legality>(), LEGALITY_KEEP = 24;
function legality(stage: number, seed: number): Legality {
  const k = `${seed}:${stage}`; let l = legalities.get(k);
  if (l) { legalities.delete(k); legalities.set(k, l); return l; }
  l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; legalities.set(k, l);
  while (legalities.size > LEGALITY_KEEP) legalities.delete(legalities.keys().next().value!);
  return l;
}
const buildOf = (seed: number): Build => ({ coast: false, anchorCheck: (g, p) => [1, 1.38].every(growth => startAnchor(playerActor(p, g, p.size, growth), p.size, legality(p.size, seed)).ok) });
function design(g: Genome, serial: number, mouth: string, add: readonly PartIn[]): { genome: Genome; next: number } {
  const out = cloneGenome(g), m = out.parts.find(p => part(p.id)?.kind === 'mouth');
  if (m) m.id = mouth;
  for (const x of add) { const spec = part(x.id)!; out.parts.push({ uid: nextUid(serial++), id: x.id, t: spec.t, angle: spec.angle, scale: x.scale ?? 1, mirror: x.mirror ?? spec.mirror, roll: 0 }); }
  return { genome: out, next: serial };
}
const runs = new Map<string, string>();
/** The run of a build at its stage: designs paid from construction money, then a 100-DNA wallet and full health. Cached per seed and build
 *  (a fresh copy each call). */
export function makeRun(seed: number, b: ProbeBuild): Run {
  const key = `${seed}:${JSON.stringify(b)}`, hit = runs.get(key);
  if (hit) return JSON.parse(hit) as Run;
  const run = freshRun(seed), build = buildOf(seed);
  run.economy = { ...run.economy, wallet: { banked: run.economy.wallet.banked + 100000, atRisk: 0 } };
  // The size-0 mouth and diet are the start's choice (a fresh run starts with the Nibbler; the diet is locked between evolutions), so they are
  // set on the fresh run itself; the added parts go through applyDesign.
  const mouth = run.genome.parts.find(x => part(x.id)?.kind === 'mouth');
  if (mouth) { mouth.id = b.mouths[0]; run.diet = part(b.mouths[0])!.diet ?? run.diet; }
  const issues = validateRun(run, build); if (issues.length) throw new Error(`probe build ${b.label}: ${issues.join(', ')}`);
  const d0 = design(run.genome, run.nextPartSerial, b.mouths[0], b.stage === 0 ? b.add : []);
  const r0 = applyDesign(run, d0.genome, run.name, build, d0.next); if (!r0.ok) throw new Error(`probe build ${b.label}: ${r0.reason}`);
  if (b.stage === 1) evolve(run, b.line, b.mouths[1], b.add, seed);
  run.economy = { ...run.economy, wallet: { banked: 100, atRisk: 0 } }; run.stageDna = 0; run.health = maxHealthOf(run);
  if (runs.size > 64) runs.clear();
  runs.set(key, JSON.stringify(run));
  return JSON.parse(runs.get(key)!) as Run;
}
/** Evolution to the line's size-1 plan with the build's mouth (the journey bot and the size-1 builds). */
function evolve(run: Run, line: 'swimmer' | 'crawler', mouth: string, add: readonly PartIn[], seed: number): void {
  const build = buildOf(seed), next = planById(line)!;
  run.stageDna = STAGES[run.stage]!.goal;
  const a = adaptToPlan(run.genome, next, { unlocked: run.unlocked, anchorCheck: build.anchorCheck }, run.nextPartSerial);
  if (!a.ok) throw new Error(`probe evolve ${line}: ${a.reasons[0]}`);
  const d = design(a.genome, a.nextSerial, mouth, add), funded = run.economy.wallet.banked;
  run.economy = { ...run.economy, wallet: { ...run.economy.wallet, banked: funded + 100000 } };
  const prepared = prepareEvolution(run, line, d.genome, run.name, build, d.next);
  if (!('planId' in prepared)) throw new Error(`probe evolve ${line}: ${prepared.reason}`);
  commitEvolution(run, prepared);
  run.economy = { ...run.economy, wallet: { ...run.economy.wallet, banked: Math.max(0, run.economy.wallet.banked - 100000) } };
}

// ---- the world ----
export interface ProbeWorld { s: SimState; w: SimWorld }
function startWorld(seed: number, run: Run, grace = 0): ProbeWorld {
  const s = newSimState(run), eco = new Ecosystem(seed, { queries: tier => legality(tier, seed).queries });
  const w: SimWorld = { eco, startGrace: grace, legality: stage => legality(stage, seed), isOnScreen: p => onScreenFrom(s.physical, s.rt.orientation.yaw, playerActorCached(s).bodyLength, p) };
  eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  return { s, w };
}
/** The hull centre of a species (the AI's own position, spec §11.2). */
export const entityCentre = (e: Entity): Vec3 => speciesCombatPose(e, 0).hull[0]!.start;
const entityL = (e: Entity) => speciesCombatPose(e, 0).bodyLength;
const NO_WISH: Vec3 = { x: 0, y: 0, z: 0 };
const stillFrame = (p: ProbeWorld): SimEvent[] => simFrame(p.s, p.w, { dt: PROBE_DT, intent: RELEASED, wish: NO_WISH, held: false });
/** Removes every creature but `keep` (the measure's subject): eaten for good; alphas by hiding them for this run. */
function isolate(p: ProbeWorld, keep: Entity): void {
  for (const e of p.w.eco.entities) {
    if (e === keep || e.spec.kind === 'planet') continue;
    if (e.spec.alpha && e.spec.alpha !== keep.spec.alpha) { if (!p.s.run.unlocked.includes(e.spec.alpha.rewardPartId)) p.s.run.unlocked.push(e.spec.alpha.rewardPartId); continue; }
    if (e.spec.alpha) continue;
    e.eaten = true; e.respawn = -1; e.combat = null;
  }
}
/** The AI's band distance (spec §11.2, combat-world aiTick): from the species' hull centre to the nearest player hurtbox, minus both radii,
 *  in the species' body lengths. */
export const bandDistance = (p: ProbeWorld, e: Entity): number => Math.max(0, rawBandDistance(p, e));
/** bandDistance before the clamp at 0 (negative: the bodies overlap). */
function rawBandDistance(p: ProbeWorld, e: Entity): number {
  const pose = speciesCombatPose(e, p.s.time), centre = pose.hull[0]!.start, r = pose.hull[0]!.radius, body = playerBody(p.s, playerActorCached(p.s));
  let d = Infinity;
  for (const h of body.pose.hurtboxes) { const q = closestOnSegment(centre, h.start, h.end); d = Math.min(d, Math.hypot(q.x - centre.x, q.y - centre.y, q.z - centre.z) - h.radius); }
  return (d - r) / pose.bodyLength;
}
/** Installs `e` in front of the player at band distance `d` (iterated with still frames: a ground body settles; the AI may not attack
 *  meanwhile). False when no legal pose within .04 L_e of `d` was found. */
function placeAtBand(p: ProbeWorld, e: Entity, d: number, turn = 0): boolean {
  const c0 = p.s.combat.stateOf(e); if (c0) c0.tokenRetryAt = Infinity;
  const yaw = p.s.rt.orientation.yaw + turn, me = p.s.physical, Le = entityL(e);
  let D = d * Le + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1) + .5 * playerActorCached(p.s).bodyLength;
  for (let k = 0; k < 8; k++) {
    if (!p.w.eco.placeAt(e, { x: me.x + Math.sin(yaw) * D, y: me.y, z: me.z + Math.cos(yaw) * D })) return false;
    stillFrame(p); const c = p.s.combat.stateOf(e); if (c) c.tokenRetryAt = Infinity;
    if (e.eaten || p.s.mode !== 'playing') return false;
    const got = rawBandDistance(p, e);
    if (Math.abs(got - d) <= .04) return true;
    D = Math.max(0, D + (d - got) * Le);
  }
  return false;
}

// ---- attacks: which choice, band, phase and parent an attack id has (plan review R12(2): chain-only attacks through their parent) ----
export interface AttackSetup { attackId: string; startId: string; band: readonly [number, number]; phase: number | null; choice: AttackChoice | null;
  /** How the band was found: the AI's choice band, the parent's band (chain), or a probe band (a pattern or den attack has none). */
  bandSource: 'choice' | 'parent' | 'probe' }
/** Probe bands for attacks the AI starts without a band (plan decision, reported): the den ambush (its trigger radius), the Clawmother's
 *  emerge (at the player's point, any distance in the lair), the Reef Tyrant's lap charge (from the lap, its den-lunge band). */
const PROBE_BANDS: Readonly<Record<string, readonly [number, number]>> = { 'eel-ambush': [0, .9], 'mother-emerge': [0, .6], 'tyrant-charge': [.4, 1.2] };
export function attackSetup(speciesKey: string, attackId: string): AttackSetup {
  const spec = SPECIES.find(x => x.key === speciesKey)!, b = BEHAVIOURS[spec.behaviourId!]!;
  const lists: { phase: number | null; attacks: readonly AttackChoice[]; pattern?: string }[] = [{ phase: null, attacks: b.attacks }, ...(b.phases ?? []).map((ph, i) => ({ phase: i, attacks: ph.attacks, pattern: ph.patternAttackId }))];
  for (const l of lists) { const c = l.attacks.find(x => x.attackId === attackId); if (c) return { attackId, startId: attackId, band: c.band, phase: l.phase, choice: c, bandSource: 'choice' }; }
  for (const l of lists) { const c = l.attacks.find(x => x.chainNextId === attackId); if (c) return { attackId, startId: c.attackId, band: c.band, phase: l.phase, choice: c, bandSource: 'parent' }; }
  const phase = lists.find(l => l.pattern === attackId)?.phase ?? null;
  return { attackId, startId: attackId, band: PROBE_BANDS[attackId] ?? [.5, 1], phase, choice: null, bandSource: 'probe' };
}

// ---- the bots ----
export interface BotOptions {
  /** Seconds from a wind-up's start to the bot's reaction. */
  reaction: number;
  /** false: movement only (P4). */
  useMoves: boolean;
  /** The creature the bot fights (the fight and journey bots), or null. */
  fight: Entity | null;
  /** Journey: walk to this point (food) when there is nothing to fight or dodge. */
  goal: Vec3 | null;
  /** Journey: keep away from this creature (a hunter of the plant diet, a hunting alpha, an unreachable hunter). */
  flee: Entity | null;
}
interface Response { kind: 'brace' | 'counter' | 'dash' | 'move'; actionId: string; attacker: Entity; pressAt: number; until: number; dir: Vec3; pressed: boolean }
export interface Bot { previous: CombatInput; seen: Map<string, number>; response: Response | null; flick: number; responses: Record<Response['kind'], number> }
export const newBot = (): Bot => ({ previous: RELEASED, seen: new Map(), response: null, flick: 0, responses: { brace: 0, counter: 0, dash: 0, move: 0 } });
const slotOf = (s: SimState, kind: MoveKind): number => playerMoves(s).slots.slots.indexOf(kind);
/** The action-clock seconds until a live action ends (every phase left; a held Brace: until it is let go, here Infinity). */
function remainingOf(a: ActionState, tau: number): number {
  const order = ['windup', 'active', 'hold', 'recovery'] as const, i = order.indexOf(a.phase as typeof order[number]); if (i < 0) return 0;
  let t = phaseRemaining(a, tau);
  for (const ph of order.slice(i + 1)) t += ph === 'active' ? activeLength(a) : ph === 'hold' ? (a.resolved.attack?.hold ? holdLength(a) : 0) : ph === 'recovery' ? recoveryLength(a) : 0;
  return t;
}
/** Plan review R12(1): the move of `kind` is in a slot and can start at world time `at` (its cooldown is over and no other action is still
 *  running then, except the recovery of a Bite or a Sweep that a Dash cancels). Hit-stop is ignored (the estimate uses world seconds). */
export function moveReadyAt(s: SimState, kind: MoveKind, at: number): boolean {
  const m = playerMoves(s).set.byKind[kind]; if (!m || slotOf(s, kind) < 0) return false;
  const rt: CombatRuntime = s.rt, ahead = Math.max(0, at - s.time), tau = rt.actionClock;
  if ((rt.cooldowns.get(`${PLAYER_ID}:${m.partUid}:${m.grantId}`) ?? -Infinity) > tau + ahead + 1e-9) return false;
  if (rt.heldBy !== null || tau + ahead < rt.staggerUntil) return false;
  for (const a of liveActions(rt)) {
    if (a.resolved.guard?.kind === kind) continue;   // the bot's own brace, about to be let go
    const left = remainingOf(a, tau);
    if (left <= ahead + 1e-9) continue;
    if (kind === 'dash' && (a.resolved.kind === 'bite' || a.resolved.kind === 'sweep') && left - recoveryLength(a) <= ahead + 1e-9) continue;
    return false;
  }
  return true;
}
const centreOfPlayer = (s: SimState): Vec3 => playerBody(s, playerActorCached(s)).centre;

/** One frame of bot input (spec §14.3): the ideal dodge bot, plus fighting when `fight` is set. Every bot aims at its target (T17 finding). */
export function botInput(p: ProbeWorld, bot: Bot, o: BotOptions): { intent: CombatInput; wish: Vec3 } {
  const s = p.s, now = s.time, me = centreOfPlayer(s), L = playerActorCached(s).bodyLength, moves = playerMoves(s).set;
  const tapped: [boolean, boolean, boolean, boolean] = [false, false, false, false], held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  let wish: Vec3 = { x: 0, y: 0, z: 0 }, aim: Vec3 | null = null, basic = false;
  const keys = new Set<string>();
  // Held: presses and stick flicks break free (spec §6.6).
  if (s.rt.heldBy !== null) {
    bot.flick = -bot.flick || 1; basic = bot.flick > 0;
    const dash = slotOf(s, 'dash'); if (dash >= 0 && o.useMoves && bot.flick > 0) tapped[dash] = true;
    const src: InputSources = { stickX: bot.flick, stickZ: 0, keys, chompHeld: basic, chompTapped: basic, riseHeld: false, riseTapped: false, diveHeld: false, activeTapped: tapped, activeHeld: held };
    const intent = readIntent(src, bot.previous, { breachOnRiseTap: false }); bot.previous = intent; return { intent, wish: { x: bot.flick, y: 0, z: 0 } };
  }
  // Threats: species wind-ups at the player, seen `reaction` seconds ago.
  for (const [id] of bot.seen) if (![...s.combat.entities.values()].some(c => c.rt.actions.some(a => a.instanceId === id))) bot.seen.delete(id);
  let next: { c: { entity: Entity }; a: { instanceId: string }; activeAt: number; attack: AttackSpec; centroid: Vec3 } | null = null;
  for (const c of s.combat.entities.values()) for (const a of c.rt.actions) {
    if (a.targetId !== PLAYER_ID || a.phase !== 'windup' || !a.resolved.attack) continue;
    if (!bot.seen.has(a.instanceId)) bot.seen.set(a.instanceId, now);
    if (now - bot.seen.get(a.instanceId)! < o.reaction - 1e-9 || bot.response?.actionId === a.instanceId) continue;
    const activeAt = now + Math.max(0, windupLength(a) - (c.rt.actionClock - a.phaseStartedAt));
    const shapes = a.lockedShapes ?? s.combat.speciesShapes(c, a, now);
    if (!next || activeAt < next.activeAt) next = { c, a, activeAt, attack: a.resolved.attack, centroid: shapes[0] ? shapeCentroid(shapes[0]) : entityCentre(c.entity) };
  }
  if (next && (!bot.response || bot.response.kind === 'move')) {
    const attacker = next.c.entity, axis = flat(sub(me, entityCentre(attacker))), side = { x: -axis.z, y: 0, z: axis.x };
    const dir = dot(side, sub(me, next.centroid)) >= 0 ? side : { x: -side.x, y: 0, z: -side.z };
    const brace = o.useMoves ? moves.byKind.brace?.resolved.guard : undefined, counter = o.useMoves ? moves.byKind.counter?.resolved.guard : undefined, dash = o.useMoves ? moves.byKind.dash?.resolved.evasion : undefined;
    const base = { actionId: next.a.instanceId, attacker, dir, pressed: false }, until = next.activeAt + next.attack.activeSeconds;
    const counterAt = counter ? next.activeAt - counter.startupSeconds - (counter.windowSeconds ?? 0) / 2 : 0, dashAt = dash ? next.activeAt - .15 - dash.startupSeconds : 0;
    // Order (spec §14.3): Brace, Counter, Dash, move; a move is used only when it is ready at its press time (plan review R12(1)).
    if (brace && next.attack.blockable && next.attack.damage < (brace.breakHalfHearts ?? Infinity) && moveReadyAt(s, 'brace', now)) bot.response = { ...base, kind: 'brace', pressAt: now, until };
    else if (counter && next.attack.parryable && moveReadyAt(s, 'counter', counterAt)) bot.response = { ...base, kind: 'counter', pressAt: counterAt, until };
    else if (dash && moveReadyAt(s, 'dash', dashAt)) bot.response = { ...base, kind: 'dash', pressAt: dashAt, until };
    else bot.response = { ...base, kind: 'move', pressAt: now, until: until + .2 };
    bot.responses[bot.response.kind]++;
  }
  const r = bot.response;
  if (r) {
    const toward = unit(sub(entityCentre(r.attacker), me));
    if (r.kind === 'brace') { const i = slotOf(s, 'brace'); if (i >= 0) held[i] = true; aim = toward; }
    else if (r.kind === 'counter') { aim = toward; if (!r.pressed && now >= r.pressAt - 1e-9) { const i = slotOf(s, 'counter'); if (i >= 0) tapped[i] = true; r.pressed = true; } }
    else if (r.kind === 'dash') { wish = r.dir; aim = r.dir; if (!r.pressed && now >= r.pressAt - 1e-9) { const i = slotOf(s, 'dash'); if (i >= 0) tapped[i] = true; r.pressed = true; } }
    else wish = r.dir;
    if (now > r.until || r.attacker.eaten) bot.response = null;
  } else if (o.flee && !o.flee.eaten) {
    wish = flat(sub(me, entityCentre(o.flee)));
    if (o.goal) { const g = flat(sub(o.goal, me)); if (dot(g, wish) > 0) wish = unit({ x: wish.x + g.x, y: 0, z: wish.z + g.z }); }
  } else if (o.fight && !o.fight.eaten) {
    // Fight: close in, aimed at the target's hull centre; Bite (or Grab, or Sweep) when the target is in recovery or not attacking and in range.
    const t = o.fight, c = s.combat.stateOf(t), to = sub(entityCentre(t), me), d = Math.hypot(to.x, to.y, to.z);
    const reach = (moves.basic?.resolved.attack?.shape.kind === 'cone' ? moves.basic.resolved.attack.shape.range : .5) * L;
    const gap = d - .35 * SIZES[t.spec.tier]! * (t.spec.bodyScale ?? 1) - .3 * L, attacking = !!c?.rt.actions.some(a => a.phase === 'windup' || a.phase === 'active');
    aim = unit(to);
    if (gap > .8 * reach) wish = flat(to);
    if (gap <= 1.1 * reach && !attacking && !liveActions(s.rt).length) {
      const grabbable = !!(t.spec.behaviourId && BEHAVIOURS[t.spec.behaviourId]?.grabbable) && !t.spec.alpha;
      if (o.useMoves && grabbable && moveReadyAt(s, 'grab', now) && (now * 10 | 0) % 7 === 0) tapped[slotOf(s, 'grab')] = true;
      else if (o.useMoves && moveReadyAt(s, 'sweep', now) && (now * 10 | 0) % 5 === 0) tapped[slotOf(s, 'sweep')] = true;
      else basic = true;
    }
    if (to.y > .3 * L) keys.add('KeyE'); else if (to.y < -.3 * L) keys.add('KeyQ');
  } else if (o.goal) {
    const to = sub(o.goal, me); wish = flat(to); aim = unit(to);
    if (to.y > .3 * L) keys.add('KeyE'); else if (to.y < -.3 * L) keys.add('KeyQ');
    basic = Math.hypot(to.x, to.y, to.z) < 1.2 * L;
  }
  // A press is an edge: alternate the basic button so that a held wish gives one press every other frame.
  const tap = basic && !bot.previous.basicHeld;
  const src: InputSources = { stickX: wish.x, stickZ: wish.z, keys, chompHeld: tap, chompTapped: tap, riseHeld: false, riseTapped: false, diveHeld: false, aim, aimSource: aim ? 'pointer' : 'none', activeTapped: tapped, activeHeld: held };
  const intent = readIntent(src, bot.previous, { breachOnRiseTap: false }); bot.previous = intent;
  return { intent, wish };
}

// ---- director invariants (P8, in game time: activeStartedAt, T11 ruling) ----
export interface DirectorWatch { maxTokens: number; minActiveGap: number; minOffScreenWindup: number; lastActiveAt: number; world: ProbeWorld | null; seen: Map<string, { windup: number; onScreen: boolean; active: boolean }>;
  /** The two actions of the smallest gap (diagnostics). */
  gapPair: string; windups: number; offScreen: number;
  /** Wind-ups at the player by attack id (the attack mix; balance note: squid ink is rare). */
  mix: Record<string, number> }
export const newWatch = (): DirectorWatch => ({ maxTokens: 0, minActiveGap: Infinity, minOffScreenWindup: Infinity, lastActiveAt: -Infinity, world: null, seen: new Map(), gapPair: '', windups: 0, offScreen: 0, mix: {} });
let lastActiveId = '';
function watchDirector(p: ProbeWorld, d: DirectorWatch): void {
  // Each world has its own clock and director: spacing is measured inside one world.
  if (d.world !== p) { d.world = p; d.lastActiveAt = -Infinity; d.seen.clear(); }
  const s = p.s; d.maxTokens = Math.max(d.maxTokens, s.combat.director.tokens.length);
  const starts: { at: number; id: string }[] = [];
  for (const c of s.combat.entities.values()) for (const a of c.rt.actions) {
    if (a.targetId !== PLAYER_ID || !a.resolved.attack) continue;
    let w = d.seen.get(a.instanceId);
    if (!w) {
      // The director's on-screen test is on the shape's centroid at the start (combat-world startCentroid).
      const shapes = a.lockedShapes ?? s.combat.speciesShapes(c, a, s.time), at = shapes[0] ? shapeCentroid(shapes[0]) : entityCentre(c.entity);
      w = { windup: windupLength(a), onScreen: p.w.isOnScreen(at), active: false }; d.seen.set(a.instanceId, w); d.windups++; d.mix[a.definitionId] = (d.mix[a.definitionId] ?? 0) + 1;
      if (!w.onScreen) { d.offScreen++; d.minOffScreenWindup = Math.min(d.minOffScreenWindup, w.windup); }
    }
    if (!w.active && a.phase !== 'windup') { w.active = true; const at = activeStartedAt(c.rt, a, s.time); if (at !== null) starts.push({ at, id: a.instanceId }); }
  }
  for (const x of starts.sort((a, b) => a.at - b.at)) {
    const gap = x.at - d.lastActiveAt;
    if (gap < d.minActiveGap) { d.minActiveGap = gap; d.gapPair = `${lastActiveId} → ${x.id} (${gap.toFixed(3)} s)`; }
    d.lastActiveAt = x.at; lastActiveId = x.id;
  }
  if (d.seen.size > 256) d.seen.clear();
}

// ---- P0–P4: one attack at a time ----
export type AttackOutcome = 'avoided' | 'mitigated' | 'countered' | 'hit';
export type BandPoint = 'near' | 'mid' | 'far';
/** The band point (5 % inside an edge: at an edge of 0 the bodies touch and separate). */
export const bandPoint = (band: readonly [number, number], at: BandPoint) => at === 'mid' ? (band[0] + band[1]) / 2 : at === 'near' ? band[0] + .05 * (band[1] - band[0]) : band[1] - .05 * (band[1] - band[0]);
/** One trial (spec §14.3): the attacker placed at a band point (default the midpoint), the attack started at the player as the AI starts it,
 *  the bot reacting; the outcome of that action (of the chained child for a chain-only attack, R12(2)). `still`: the player does nothing
 *  (the baseline: a P1–P4 trial counts only when the attack hits a still player). null: no subject, no legal place or no start. */
export function attackTrial(seed: number, build: ProbeBuild, speciesKey: string, attackId: string, o: { reaction: number; useMoves: boolean; still?: boolean; at?: BandPoint; trace?: (p: ProbeWorld, subject: Entity) => void }, watch?: DirectorWatch): AttackOutcome | null {
  const run = makeRun(seed, build), p = startWorld(seed, run), subject = p.w.eco.entities.find(e => e.spec.key === speciesKey && (!e.eaten || !!e.spec.alpha));
  if (!subject) return null;
  if (subject.spec.alpha && subject.spec.alpha.size !== run.stage) return null;
  isolate(p, subject);
  stillFrame(p);   // the subject becomes active (an alpha is installed at its lair)
  if (subject.eaten) return null;
  const setup = attackSetup(speciesKey, attackId);
  if (!placeAtBand(p, subject, bandPoint(setup.band, o.at ?? 'mid'))) return null;
  const c = p.s.combat.stateOf(subject), attack = SPECIES_ATTACKS[setup.startId]!;
  if (!c || !c.ai) return null;
  // An alpha attack of a later phase: the phase is set first (no roar), then the HP just below the phase's upper bound.
  if (setup.phase !== null && setup.phase > 0 && c.behaviour.phases) { c.ai.phase = setup.phase; subject.hp = Math.max(1, Math.floor(c.maxHp * (c.behaviour.phases[setup.phase - 1]!.aboveHpFraction - .03))); }
  c.tokenRetryAt = -Infinity;
  const target = centreOfPlayer(p.s), now = p.s.time;
  const started = p.s.combat.startSpecies(c, setup.startId, attack, sub(target, entityCentre(subject)), PLAYER_ID, now,
    { targetAt: target, onScreen: true, playerHeld: false, playing: true, tick: PROBE_DT });
  if (typeof started === 'string') return null;
  // The AI's own bookkeeping, as when it asked for this attack: the chain follows the parent; it holds while busy.
  c.ai.current = setup.choice; c.ai.name = attackId === 'eel-ambush' ? 'den' : attackId === 'mother-emerge' ? 'burrowed' : 'attack'; aiStarted(c.ai, now);
  const chained = setup.startId !== attackId, scored = new Set<string>(chained ? [] : [started.instanceId]);
  const bot = newBot(); let outcome: AttackOutcome = 'avoided', ended = false;
  const lengthOf = (x: AttackSpec) => x.windupSeconds + .5 + x.activeSeconds + (x.hold?.seconds ?? 0);
  const child = chained ? SPECIES_ATTACKS[attackId]! : null;
  const end = now + lengthOf(attack) + attack.recoverySeconds + (child ? (setup.choice?.chainGapSeconds ?? 0) + lengthOf(child) + .5 : 0) + 1;
  while (p.s.time < end && !ended) {
    const { intent, wish } = o.still ? { intent: RELEASED, wish: NO_WISH } : botInput(p, bot, { ...o, fight: null, goal: null, flee: null });
    const events = simFrame(p.s, p.w, { dt: PROBE_DT, intent, wish, held: false });
    if (chained) for (const a of c.rt.actions) if (a.definitionId === attackId && a.targetId === PLAYER_ID) scored.add(a.instanceId);
    for (const ev of events) {
      if (ev.type !== 'combat') continue;
      for (const h of ev.tick.events) {
        if (!scored.has(h.actionInstanceId) || h.targetId !== PLAYER_ID) continue;
        if (h.outcome === 'hit' || h.outcome === 'grabbed' || h.outcome === 'guard-broken') outcome = 'hit';
        else if (h.outcome === 'countered' && outcome !== 'hit') outcome = 'countered';
        else if (h.outcome === 'blocked' && outcome !== 'hit') outcome = h.amount <= attack.damage / 2 ? (outcome === 'countered' ? outcome : 'mitigated') : 'hit';
      }
    }
    if (watch) watchDirector(p, watch);
    o.trace?.(p, subject);
    if (p.s.mode !== 'playing') break;
    // The scored action is over (not for a chain parent whose child has not started).
    if (scored.size && [...scored].every(id => !c.rt.actions.some(a => a.instanceId === id && a.phase !== 'recovery' && a.phase !== 'interrupted'))) ended = true;
  }
  if (chained && !scored.size) return null;   // the chain never came: nothing to score
  return outcome;
}

/** P8, off-screen wind-ups: the subject placed behind or beside the player (`turn` from its facing) at the far point of its longest band, and
 *  the AI left to start its own attack (the director judges on-screen as in the game; the camera model sees close attackers even behind the
 *  player). Runs until that attack ends or `seconds` pass. True if it attacked. */
export function behindTrial(seed: number, build: ProbeBuild, speciesKey: string, watch: DirectorWatch, turn = Math.PI, seconds = 6): boolean {
  const run = makeRun(seed, build), p = startWorld(seed, run), subject = p.w.eco.entities.find(e => e.spec.key === speciesKey && (!e.eaten || !!e.spec.alpha));
  if (!subject || (subject.spec.alpha && subject.spec.alpha.size !== run.stage)) return false;
  isolate(p, subject); stillFrame(p);
  const b = BEHAVIOURS[subject.spec.behaviourId ?? '']!, longest = [...b.attacks, ...(b.phases?.[0]?.attacks ?? [])].sort((x, y) => y.band[1] - x.band[1])[0];
  if (subject.eaten || !longest || !placeAtBand(p, subject, bandPoint(longest.band, 'far'), turn)) return false;
  const c = p.s.combat.stateOf(subject); if (!c) return false;
  c.tokenRetryAt = -Infinity;
  let attacked = false;
  for (const t0 = p.s.time; p.s.time - t0 < seconds;) {
    stillFrame(p); watchDirector(p, watch);
    const live = c.rt.actions.some(a => a.targetId === PLAYER_ID && a.phase !== 'interrupted' && a.phase !== 'recovery');
    if (live) attacked = true; else if (attacked) break;
    if (p.s.mode !== 'playing') break;
  }
  return attacked;
}

// ---- P5/P6: time to kill ----
/** Seconds until the fight bot kills one creature of `speciesKey` placed 1 of its body lengths away, or Infinity (a faint or `cap`). */
export function timeToKill(seed: number, build: ProbeBuild, speciesKey: string, cap: number, watch?: DirectorWatch, stats?: { faints: number; damage: number },
  trace?: (p: ProbeWorld, subject: Entity, events: SimEvent[], bot: Bot) => void, how: { reaction: number; useMoves: boolean; gapL: number } = { reaction: .25, useMoves: true, gapL: 1 }): number {
  const run = makeRun(seed, build), p = startWorld(seed, run), subject = p.w.eco.entities.find(e => e.spec.key === speciesKey && (!e.eaten || !!e.spec.alpha));
  if (!subject || (subject.spec.alpha && subject.spec.alpha.size !== run.stage)) return NaN;
  isolate(p, subject); stillFrame(p);
  if (subject.eaten || !placeAtBand(p, subject, how.gapL)) return NaN;
  const c = p.s.combat.stateOf(subject); if (c) c.tokenRetryAt = -Infinity;
  const bot = newBot(), t0 = p.s.time;
  while (p.s.time - t0 < cap) {
    const { intent, wish } = botInput(p, bot, { reaction: how.reaction, useMoves: how.useMoves, fight: subject, goal: null, flee: null });
    const events = simFrame(p.s, p.w, { dt: PROBE_DT, intent, wish, held: false });
    if (watch) watchDirector(p, watch);
    trace?.(p, subject, events, bot);
    if (stats) for (const e of events) { if (e.type === 'combat') for (const h of e.tick.events) if (h.targetId === PLAYER_ID) stats.damage += h.amount; if (e.type === 'fainted') stats.faints++; }
    if (events.some(e => e.type === 'killed' && e.entity === subject) || (subject.eaten && p.s.mode === 'playing')) return p.s.time - t0;
    if (p.s.mode === 'fainted') return Infinity;
  }
  return Infinity;
}

// ---- P7: journeys ----
export interface FaintRecord { time: number; lostWallet: number; lostGrowth: number; by: string }
export interface SizeReport { size: number; ready: boolean; activeSeconds: number; faints: number; kills: Record<string, number>; damageHalfHearts: number; heldSeconds: number;
  dna: { meals: number; kills: number; survivor: number; alpha: number };
  /** Plan review R12(4): damage taken and faints by attacker species; seconds spent chasing a target that was then skipped as unreachable. */
  damageBy: Record<string, number>; faintsBy: Record<string, number>; unreachableChaseSeconds: number;
  /** R7: each faint, with the DNA it took (the at-risk wallet and part credit) and the growth bar it reset. */
  faintLog: FaintRecord[] }
export interface JourneyReport { line: 'swimmer' | 'crawler'; diet: 'herbivore' | 'carnivore' | 'omnivore'; seed: number; sizes: SizeReport[]; pass: boolean }
const DIET_MOUTHS: Record<JourneyReport['diet'], [string, string]> = { herbivore: ['mouth_nibbler', 'mouth_nibbler'], carnivore: ['mouth_snapper', 'mouth_snapper'], omnivore: ['mouth_snapper', 'mouth_beak'] };
/** The journey bot (fight bot, 0.35 s reaction): it eats by diet; meat diets fight hunters and prey; the plant diet flees hunters and fights only
 *  when cornered (a hunter within 0.5 of its body lengths for 2 s). R12(5): no diet fights a hunter it cannot reach (a ground mover and the
 *  height difference above its Bite reach): it keeps away from it and keeps feeding; a ground mover also skips food above that reach. Each
 *  size ends at evolve-ready or after `limit` seconds of active time. */
export function journey(line: 'swimmer' | 'crawler', diet: JourneyReport['diet'], seed: number, limit = 600, watch?: DirectorWatch): JourneyReport {
  const mouths = DIET_MOUTHS[diet], run = makeRun(seed, { label: 'journey', stage: 0, line, mouths, add: [] });
  let p = startWorld(seed, run, 2);
  const sizes: SizeReport[] = [];
  for (const size of [0, 1]) {
    const rep: SizeReport = { size, ready: false, activeSeconds: 0, faints: 0, kills: {}, damageHalfHearts: 0, heldSeconds: 0, dna: { meals: 0, kills: 0, survivor: 0, alpha: 0 }, damageBy: {}, faintsBy: {}, unreachableChaseSeconds: 0, faintLog: [] };
    const bot = newBot(); let corneredFor = 0, lastHitBy = 'unknown';
    // A target (prey or food) whose distance has not dropped by half a body length in 3 s is skipped for 15 s (a rock or the seabed in the way).
    const skipped = new Map<Entity, number>(); let chase: { e: Entity; best: number; since: number; start: number } | null = null;
    const ground = movementCapabilities(currentPlan(p.s.run)).ground;
    while (rep.activeSeconds < limit && !evolveReady(p.s.run)) {
      const s = p.s, me = centreOfPlayer(s), L = playerActorCached(s).bodyLength, live = p.w.eco.entities.filter(e => e.active && !e.eaten);
      const biteReach = (playerMoves(s).set.basic?.resolved.attack?.shape.kind === 'cone' ? (playerMoves(s).set.basic!.resolved.attack!.shape as { range: number }).range : .5) * L;
      const reachable = (e: Entity) => !ground || Math.abs(entityCentre(e).y - me.y) <= biteReach + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1);
      const hunters = live.filter(e => e.spec.behaviourId && (e.mode === 'hunt' || e.mode === 'angry'));
      const open = (e: Entity) => !((skipped.get(e) ?? -Infinity) > s.time);
      const near = (es: Entity[]) => es.filter(open).reduce<{ e: Entity | null; d: number }>((b, e) => { const c = entityCentre(e), d = Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z); return d < b.d ? { e, d } : b; }, { e: null, d: Infinity });
      const hunter = near(hunters.filter(e => !e.spec.alpha));
      let fight: Entity | null = null, flee: Entity | null = null;
      if (diet === 'herbivore') {
        corneredFor = hunter.e && hunter.d - .35 * SIZES[hunter.e.spec.tier]! * (hunter.e.spec.bodyScale ?? 1) <= .5 * entityL(hunter.e) ? corneredFor + PROBE_DT : 0;
        if (corneredFor >= 2 && hunter.e && reachable(hunter.e)) fight = hunter.e; else if (hunter.e && hunter.d < 8 * L) flee = hunter.e;
      } else {
        const prey = near(live.filter(e => e.spec.behaviourId && !e.spec.alpha && reachable(e) && (e.spec.tier === s.run.stage || hostileSizes(e.spec).includes(s.run.stage))));
        const h = hunter.e && hunter.d < 10 * L ? hunter.e : null;
        if (h && !reachable(h)) flee = h; else fight = h ?? (prey.e && prey.d < 14 * L ? prey.e : null);
      }
      const alpha = near(hunters.filter(e => !!e.spec.alpha));
      // An alpha that hunts: every diet keeps away from it while it hunts prey or food (T23 fix round 1: the bot chased sardines into the Reef
      // Tyrant); only a non-alpha hunter that the bot is fighting or fleeing comes first.
      if (alpha.e && alpha.d < 6 * entityL(alpha.e) && !flee && !(fight && fight === hunter.e)) { flee = alpha.e; fight = null; }
      const food = near(live.filter(e => !e.spec.behaviourId && e.spec.tier === s.run.stage && dietCanEat(s.run.diet, e.spec.tag) && e.spec.kind !== 'planet' && reachable(e)));   // the run's diet: the omnivore plan has a Snapper at size 0
      const target = fight ?? (flee ? null : food.e);
      if (target) {
        const tc = entityCentre(target), d = Math.hypot(tc.x - me.x, tc.y - me.y, tc.z - me.z);
        if (!chase || chase.e !== target) chase = { e: target, best: d, since: s.time, start: s.time };
        else if (d < chase.best - .5 * L) { chase.best = d; chase.since = s.time; }
        else if (s.time - chase.since > 3) { skipped.set(target, s.time + 15); rep.unreachableChaseSeconds += s.time - chase.start; chase = null; }
      }
      const { intent, wish } = botInput(p, bot, { reaction: .35, useMoves: true, fight, flee, goal: food.e ? entityCentre(food.e) : null });
      const before = s.mode, stageDna = s.run.stageDna, events: SimEvent[] = simFrame(s, p.w, { dt: PROBE_DT, intent, wish, held: false });
      if (before === 'playing') rep.activeSeconds += PROBE_DT;
      if (s.rt.heldBy !== null) rep.heldSeconds += PROBE_DT;
      if (watch) watchDirector(p, watch);
      const keyOf = (actorId: string) => p.w.eco.entities.find(e => `e${e.id}` === actorId)?.spec.key ?? actorId;
      for (const e of events) {
        if (e.type === 'hurt') { rep.damageHalfHearts += e.damage; lastHitBy = e.event.entity.spec.key; rep.damageBy[lastHitBy] = (rep.damageBy[lastHitBy] ?? 0) + e.damage; }
        if (e.type === 'combat') for (const h of e.tick.events) if (h.targetId === PLAYER_ID && h.amount > 0) { rep.damageHalfHearts += h.amount; lastHitBy = keyOf(h.attackerId); rep.damageBy[lastHitBy] = (rep.damageBy[lastHitBy] ?? 0) + h.amount; }
        if (e.type === 'fainted' || (e.type === 'hurt' && e.fainted)) {
          rep.faints++; rep.faintsBy[lastHitBy] = (rep.faintsBy[lastHitBy] ?? 0) + 1;
          rep.faintLog.push({ time: rep.activeSeconds, lostWallet: e.lost, lostGrowth: stageDna, by: lastHitBy });
        }
        if (e.type === 'chomp' && e.result.kind === 'ate') rep.dna.meals += e.result.dna;
        if (e.type === 'survived') rep.dna.survivor += e.dna;
        if (e.type === 'killed') { rep.kills[e.entity.spec.key] = (rep.kills[e.entity.spec.key] ?? 0) + 1; if (e.entity.spec.alpha) rep.dna.alpha += e.dna; else rep.dna.kills += e.dna; }
      }
    }
    rep.ready = evolveReady(p.s.run); sizes.push(rep);
    if (!rep.ready || size === 1) break;
    evolve(p.s.run, line, mouths[1], [], seed);
    const next = p.s.run; p = startWorld(seed, next, 2);
  }
  const pass = sizes.length === 2 && sizes.every(r => r.ready && r.faints <= 3);
  return { line, diet, seed, sizes, pass };
}

// ---- the report ----
export const SPECIES_SIZE: Readonly<Record<string, 0 | 1>> = { '0:drifter': 0, '0:spiny_snail': 0, '1:crab': 0, '1:clawmother': 0, '1:sardine': 1, '1:puffer': 1, '2:squid': 1, '2:eel': 1, '2:reef_tyrant': 1 };
/** P5 bars (seconds, median time to kill with the meat build). */
export const P5_BARS: Readonly<Record<string, number>> = { '0:drifter': 6, '0:spiny_snail': 8, '1:crab': 20, '1:sardine': 6, '1:puffer': 10, '2:squid': 30, '2:eel': 30, '1:clawmother': 90, '2:reef_tyrant': 120 };
/** P6 bars (plant build); the other species are reported only. */
export const P6_BARS: Readonly<Record<string, number>> = { '1:crab': 45, '2:squid': 75 };
const dashBuild = (stage: 0 | 1): ProbeBuild => ({ label: `dash ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'fin_side', scale: 1, mirror: true }] });
const braceBuild: ProbeBuild = { label: 'brace 1', stage: 1, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'shell_plate', scale: 1 }] };
const counterBuild = (stage: 0 | 1): ProbeBuild => ({ label: `counter ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'spike', scale: 1 }] });
const meatBuild = (stage: 0 | 1): ProbeBuild => ({ label: `meat ${stage}`, stage, line: 'swimmer', mouths: ['mouth_snapper', 'mouth_snapper'], add: [] });
const plantBuild = (stage: 0 | 1): ProbeBuild => ({ label: `plant ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [] });
export const PROBE_BUILDS = { dashBuild, braceBuild, counterBuild, meatBuild, plantBuild };

export interface AttackRow { attackId: string; species: string; size: number; kind: 'alpha' | 'hunter' | 'fighter'; trials: number; share: number; bar: number | null; pass: boolean;
  /** Trials that found no subject, no legal place or no start (not counted). */
  skipped: number; bandSource?: AttackSetup['bandSource'] }
export interface P0Row { attackId: string; species: string; size: number; band: readonly [number, number]; bandSource: AttackSetup['bandSource']; near: number; mid: number; far: number;
  trials: { near: number; mid: number; far: number };  pass: boolean }
export interface TtkRow { species: string; build: 'meat' | 'plant'; median: number; bar: number | null; pass: boolean; trials: number; faints: number; times: number[] }
export interface ProbeReport { p0: P0Row[]; p1: AttackRow[]; p2: AttackRow[]; p3: AttackRow[]; p4: AttackRow[]; p5: TtkRow[]; p6: TtkRow[]; p7: JourneyReport[];
  p8: { maxTokens: number; minActiveGap: number; minOffScreenWindup: number; windups: number; offScreen: number; gapPair: string; pass: boolean; mix?: Record<string, number> };
  /** The balance notes of earlier reviews, measured (controller list; no bar). */
  notes: NoteRow[];
  /** T23 fix round 1: the largest bot reaction (step .01 s) at which each attack still meets its bar, per measure; and P1 with a reaction
   *  drawn from .25–.45 s for each trial (reported, no bar). */
  thresholds: ThresholdRow[]; p1Jitter: JitterRow[]; pass: boolean }
export interface ThresholdRow { measure: 'p1' | 'p2' | 'p3'; attackId: string; species: string; size: number; bar: number;
  /** Largest reaction (s) in [0, .8] with share ≥ bar; null: not even at 0; .8: at least .8. */
  threshold: number | null; at25: number; at35: number; trials: number }
export interface JitterRow { attackId: string; species: string; size: number; kind: AttackRow['kind']; trials: number; share: number;
  /** Avoided share by reaction bin (.25–.30, .30–.35, .35–.40, .40–.45). */
  bins: { from: number; n: number; good: number }[] }
export interface NoteRow { note: string; build: string; species: string; median: number; faints: number; trials: number; damage: number; times: number[] }
export interface ProbeOptions { trials: number; p0Trials: number; ttkSeeds: readonly number[]; ttkTrials: number; journeySeeds: readonly number[]; journeyLimit: number;
  /** Seeds per attack and reaction step of the reaction-threshold search (T23 fix round 1). */
  thresholdTrials: number }
export const FULL_PROBE: ProbeOptions = { trials: 200, p0Trials: 100, ttkSeeds: [11, 12, 13], ttkTrials: 30, journeySeeds: [11, 12, 13, 14, 15], journeyLimit: 600, thresholdTrials: 40 };
export type ProbePart = 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7-swimmer' | 'p7-crawler' | 'p8' | 'notes' | 'th-p1' | 'th-p2' | 'th-p3' | 'p1-jitter';
export const PROBE_PARTS: readonly ProbePart[] = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7-swimmer', 'p7-crawler', 'p8', 'notes', 'th-p1', 'th-p2', 'th-p3', 'p1-jitter'];

/** Every hostile attack at sizes 0 and 1: its species, the size it targets and its kind. */
export function hostileAttacks(): { attackId: string; species: string; size: 0 | 1; kind: AttackRow['kind'] }[] {
  const out: { attackId: string; species: string; size: 0 | 1; kind: AttackRow['kind'] }[] = [];
  for (const spec of SPECIES) {
    const b = spec.behaviourId ? BEHAVIOURS[spec.behaviourId] : undefined; if (!b) continue;
    const kind: AttackRow['kind'] = spec.alpha ? 'alpha' : b.type === 'hunter' || b.type === 'hunter-ambush' ? 'hunter' : 'fighter';
    for (const size of hostileSizes(spec)) if (size === 0 || size === 1) for (const attackId of spec.attackIds) out.push({ attackId, species: spec.key, size, kind });
  }
  return out;
}
const failed = (r: { pass: boolean }) => !r.pass;
type Progress = (part: ProbePart, partial: Partial<ProbeReport>) => void;
/** P1–P4 rows. Seeds run in the outer loop (one seed's world queries serve every attack), and `progress` gets the rows after each seed. */
function attackRows(list: ReturnType<typeof hostileAttacks>, trials: number, build: (size: 0 | 1) => ProbeBuild, useMoves: boolean, counts: (o: AttackOutcome) => boolean,
  bar: (r: { kind: AttackRow['kind'] }) => number | null, watch: DirectorWatch, flush: (rows: AttackRow[]) => void): AttackRow[] {
  const acc = list.map(() => ({ n: 0, good: 0, skipped: 0 }));
  const rows = () => list.map((x, k) => {
    const a = acc[k]!, share = a.n ? a.good / a.n : NaN, b = bar(x);
    return { attackId: x.attackId, species: x.species, size: x.size, kind: x.kind, trials: a.n, share, bar: b, pass: b === null || (a.n > 0 && share >= b - 1e-9), skipped: a.skipped, bandSource: attackSetup(x.species, x.attackId).bandSource };
  });
  for (let i = 0; i < trials; i++) {
    list.forEach((x, k) => {
      // Only trials whose attack hits a still player count (a whiff measures nothing).
      const still = stillOutcome(1000 + i, build(x.size), x.species, x.attackId);
      if (still === null) { acc[k]!.skipped++; return; }
      if (still !== 'hit') return;
      const o = attackTrial(1000 + i, build(x.size), x.species, x.attackId, { reaction: .25, useMoves }, watch);
      if (o === null) { acc[k]!.skipped++; return; }
      acc[k]!.n++; if (counts(o)) acc[k]!.good++;
    });
    if (i % 10 === 9 || i === trials - 1) flush(rows());
  }
  return rows();
}
const stillCache = new Map<string, AttackOutcome | null>();
function stillOutcome(seed: number, build: ProbeBuild, species: string, attackId: string): AttackOutcome | null {
  const k = `${seed}:${build.label}:${species}:${attackId}`;
  if (!stillCache.has(k)) { if (stillCache.size > 20000) stillCache.clear(); stillCache.set(k, attackTrial(seed, build, species, attackId, { reaction: .25, useMoves: false, still: true })); }
  return stillCache.get(k)!;
}
/** P0 (plan review R12(3)): a still player at the near, middle and far band points is hit in ≥ 90 % of trials, for every species attack. */
function p0Rows(trials: number, watch: DirectorWatch, flush: (rows: P0Row[]) => void): P0Row[] {
  const list = hostileAttacks(), points: BandPoint[] = ['near', 'mid', 'far'];
  const acc = list.map(() => ({ near: { n: 0, hit: 0 }, mid: { n: 0, hit: 0 }, far: { n: 0, hit: 0 } }));
  const rows = (): P0Row[] => list.map((x, k) => {
    const a = acc[k]!, setup = attackSetup(x.species, x.attackId), sh = (q: { n: number; hit: number }) => q.n ? q.hit / q.n : NaN;
    const near = sh(a.near), mid = sh(a.mid), far = sh(a.far);
    return { attackId: x.attackId, species: x.species, size: x.size, band: setup.band, bandSource: setup.bandSource, near, mid, far, trials: { near: a.near.n, mid: a.mid.n, far: a.far.n },
      pass: [near, mid, far].every(v => v >= .9 - 1e-9) };
  });
  for (let i = 0; i < trials; i++) {
    list.forEach((x, k) => {
      for (const at of points) {
        const o = at === 'mid' ? stillOutcome(1000 + i, dashBuild(x.size), x.species, x.attackId) : attackTrial(1000 + i, dashBuild(x.size), x.species, x.attackId, { reaction: .25, useMoves: false, still: true, at }, watch);
        if (o === null) continue;
        acc[k]![at].n++; if (o === 'hit') acc[k]![at].hit++;
      }
    });
    if (i % 10 === 9 || i === trials - 1) flush(rows());
  }
  return rows();
}
function ttkRows(o: ProbeOptions, build: (size: 0 | 1) => ProbeBuild, bars: Readonly<Record<string, number>>, kind: 'meat' | 'plant', watch: DirectorWatch, flush: (rows: TtkRow[]) => void): TtkRow[] {
  const rows: TtkRow[] = [];
  for (const species of Object.keys(SPECIES_SIZE)) {
    const bar = bars[species] ?? null, cap = 3 * (bar ?? 60), times: number[] = [], stats = { faints: 0, damage: 0 };
    for (const seed of o.ttkSeeds) for (let i = 0; i < o.ttkTrials; i++) { const t = timeToKill(seed * 1000 + i, build(SPECIES_SIZE[species]!), species, cap, watch, stats); if (!Number.isNaN(t)) times.push(t); }
    const m = median(times); rows.push({ species, build: kind, median: m, bar, pass: bar === null || m <= bar, trials: times.length, faints: stats.faints, times: times.map(t => Number.isFinite(t) ? Math.round(t * 10) / 10 : -1) });
    flush(rows);
  }
  return rows;
}
const p8Of = (watch: DirectorWatch) => ({ maxTokens: watch.maxTokens, minActiveGap: watch.minActiveGap, minOffScreenWindup: watch.minOffScreenWindup, windups: watch.windups, offScreen: watch.offScreen, gapPair: watch.gapPair, mix: { ...watch.mix },
  pass: watch.maxTokens <= 2 && watch.minActiveGap >= .25 - 1e-6 && watch.minOffScreenWindup >= .6 - 1e-6 });
export function emptyReport(): ProbeReport {
  return { p0: [], p1: [], p2: [], p3: [], p4: [], p5: [], p6: [], p7: [], p8: { maxTokens: 0, minActiveGap: Infinity, minOffScreenWindup: Infinity, windups: 0, offScreen: 0, gapPair: '', pass: true, mix: {} }, notes: [], thresholds: [], p1Jitter: [], pass: false };
}
/** The pass flag of a whole report. */
export function judge(r: ProbeReport): ProbeReport {
  r.pass = ![...r.p0, ...r.p1, ...r.p2, ...r.p3, ...r.p5, ...r.p6].some(failed) && !r.p7.some(failed) && r.p8.pass && r.p0.length > 0 && r.p7.length > 0;
  return r;
}
/** The probe (spec §14.3), or some of its parts. Long: run it with TIDE_COMBAT_PROBE=1. `progress` receives each part's rows as they grow. */
export function runProbe(o: ProbeOptions = FULL_PROBE, parts: readonly ProbePart[] = PROBE_PARTS, progress?: Progress): ProbeReport {
  const all = hostileAttacks(), r = emptyReport();
  for (const part of parts) {
    const watch = newWatch(), flush = (x: Partial<ProbeReport>) => progress?.(part, { ...x, p8: p8Of(watch) });
    if (part === 'p0') r.p0 = p0Rows(o.p0Trials, watch, rows => flush({ p0: rows }));
    // P1–P3 measure each chain-only attack through its parent (R12(2)).
    if (part === 'p1') r.p1 = attackRows(all, o.trials, dashBuild, true, x => x === 'avoided' || x === 'countered', x => x.kind === 'alpha' ? .9 : .95, watch, rows => flush({ p1: rows }));
    if (part === 'p2') r.p2 = attackRows(all.filter(x => x.size === 1 && SPECIES_ATTACKS[x.attackId]!.blockable), o.trials, () => braceBuild, true, x => x !== 'hit', () => .95, watch, rows => flush({ p2: rows }));
    if (part === 'p3') r.p3 = attackRows(all.filter(x => SPECIES_ATTACKS[x.attackId]!.parryable), o.trials, counterBuild, true, x => x === 'countered', () => .85, watch, rows => flush({ p3: rows }));
    if (part === 'p4') r.p4 = attackRows(all, o.trials, dashBuild, false, x => x === 'avoided', () => null, watch, rows => flush({ p4: rows }));
    if (part === 'p5') r.p5 = ttkRows(o, meatBuild, P5_BARS, 'meat', watch, rows => flush({ p5: rows }));
    if (part === 'p6') r.p6 = ttkRows(o, plantBuild, P6_BARS, 'plant', watch, rows => flush({ p6: rows }));
    if (part === 'p7-swimmer' || part === 'p7-crawler') {
      const line = part === 'p7-swimmer' ? 'swimmer' : 'crawler', mine: JourneyReport[] = [];
      for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) for (const seed of o.journeySeeds) { mine.push(journey(line, diet, seed, o.journeyLimit, watch)); flush({ p7: [...mine] }); }
      r.p7.push(...mine);
    }
    // P8 is watched over every run; this part adds attackers that start behind the player (off-screen wind-ups).
    if (part === 'p8') for (let i = 0; i < Math.max(1, Math.round(o.p0Trials / 5)); i++) {
      for (const species of Object.keys(SPECIES_SIZE)) for (const turn of [Math.PI, Math.PI / 2, -Math.PI / 2]) behindTrial(1000 + i, dashBuild(SPECIES_SIZE[species]!), species, watch, turn);
      flush({});
    }
    if (part === 'notes') r.notes = noteRows(o, watch, rows => flush({ notes: rows }));
    if (part === 'th-p1') r.thresholds.push(...thresholdRows('p1', all, dashBuild, x => x === 'avoided' || x === 'countered', x => x.kind === 'alpha' ? .9 : .95, o.thresholdTrials, rows => flush({ thresholds: rows })));
    if (part === 'th-p2') r.thresholds.push(...thresholdRows('p2', all.filter(x => x.size === 1 && SPECIES_ATTACKS[x.attackId]!.blockable), () => braceBuild, x => x !== 'hit', () => .95, o.thresholdTrials, rows => flush({ thresholds: rows })));
    if (part === 'th-p3') r.thresholds.push(...thresholdRows('p3', all.filter(x => SPECIES_ATTACKS[x.attackId]!.parryable), counterBuild, x => x === 'countered', () => .85, o.thresholdTrials, rows => flush({ thresholds: rows })));
    if (part === 'p1-jitter') r.p1Jitter = jitterRows(all, o.trials, watch, rows => flush({ p1Jitter: rows }));
    r.p8 = mergeP8(r.p8, p8Of(watch));
  }
  return judge(r);
}
/** The avoided share of one attack at one reaction, over `trials` seeds (only trials whose attack hits a still player count). */
function shareAt(x: { attackId: string; species: string; size: 0 | 1 }, build: (size: 0 | 1) => ProbeBuild, counts: (o: AttackOutcome) => boolean, reaction: number, trials: number): { n: number; good: number } {
  let n = 0, good = 0;
  for (let i = 0; i < trials; i++) {
    if (stillOutcome(1000 + i, build(x.size), x.species, x.attackId) !== 'hit') continue;
    const o = attackTrial(1000 + i, build(x.size), x.species, x.attackId, { reaction, useMoves: true }); if (o === null) continue;
    n++; if (counts(o)) good++;
  }
  return { n, good };
}
/** T23 fix round 1 (review: P1–P3 are a cliff): per attack, the largest reaction in [0, .8] s, at a step of .01 s, at which the share still meets
 *  the bar (a binary search: the share falls as the reaction grows), with the shares at .25 and .35 s. */
function thresholdRows(measure: ThresholdRow['measure'], list: ReturnType<typeof hostileAttacks>, build: (size: 0 | 1) => ProbeBuild, counts: (o: AttackOutcome) => boolean,
  bar: (r: { kind: AttackRow['kind'] }) => number, trials: number, flush: (rows: ThresholdRow[]) => void): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  for (const x of list) {
    const b = bar(x), share = (r: number) => { const q = shareAt(x, build, counts, r, trials); return { ok: q.n > 0 && q.good / q.n >= b - 1e-9, share: q.n ? q.good / q.n : NaN, n: q.n }; };
    const s25 = share(.25), s35 = share(.35);
    let threshold: number | null;
    if (!share(0).ok) threshold = null;
    else if (share(.8).ok) threshold = .8;
    else { let lo = 0, hi = 80; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (share(mid / 100).ok) lo = mid; else hi = mid; } threshold = lo / 100; }
    rows.push({ measure, attackId: x.attackId, species: x.species, size: x.size, bar: b, threshold, at25: s25.share, at35: s35.share, trials: s25.n });
    flush([...rows]);
  }
  return rows;
}
/** P1 with a reaction drawn uniformly from .25–.45 s for each trial (seeded by trial and attack); reported with bins, no bar. */
function jitterRows(list: ReturnType<typeof hostileAttacks>, trials: number, watch: DirectorWatch, flush: (rows: JitterRow[]) => void): JitterRow[] {
  const acc = list.map(() => ({ n: 0, good: 0, bins: [.25, .30, .35, .40].map(from => ({ from, n: 0, good: 0 })) }));
  const rows = () => list.map((x, k) => ({ attackId: x.attackId, species: x.species, size: x.size, kind: x.kind, trials: acc[k]!.n, share: acc[k]!.n ? acc[k]!.good / acc[k]!.n : NaN, bins: acc[k]!.bins }));
  for (let i = 0; i < trials; i++) {
    list.forEach((x, k) => {
      if (stillOutcome(1000 + i, dashBuild(x.size), x.species, x.attackId) !== 'hit') return;
      const u = (Math.imul(1000 + i, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0, reaction = .25 + .2 * ((u % 10007) / 10007);
      const o = attackTrial(1000 + i, dashBuild(x.size), x.species, x.attackId, { reaction, useMoves: true }, watch); if (o === null) return;
      const a = acc[k]!, ok = o === 'avoided' || o === 'countered', bin = a.bins[Math.min(3, Math.floor((reaction - .25) / .05))]!;
      a.n++; bin.n++; if (ok) { a.good++; bin.good++; }
    });
    if (i % 10 === 9 || i === trials - 1) flush(rows());
  }
  return rows();
}
/** The balance notes of earlier reviews (controller list), each measured over the time-to-kill seeds: an aimed mash bot (it aims and bites, and
 *  never dodges or uses a move) against both alphas, crawler fights with the puffer and the eel, and a sardine placed 3 of its body lengths away. */
function noteRows(o: ProbeOptions, watch: DirectorWatch, flush: (rows: NoteRow[]) => void): NoteRow[] {
  const crawlerMeat: ProbeBuild = { label: 'crawler meat 1', stage: 1, line: 'crawler', mouths: ['mouth_snapper', 'mouth_snapper'], add: [] };
  const mash = { reaction: 1e9, useMoves: false, gapL: 1 }, fight = { reaction: .25, useMoves: true, gapL: 1 };
  const list: { note: string; build: ProbeBuild; species: string; how: typeof mash; cap: number }[] = [
    { note: 'Clawmother aimed mash (no dodge)', build: meatBuild(0), species: '1:clawmother', how: mash, cap: 270 },
    { note: 'Clawmother aimed mash (no dodge), plant build', build: plantBuild(0), species: '1:clawmother', how: mash, cap: 270 },
    { note: 'Reef Tyrant aimed mash (no dodge), swimmer', build: meatBuild(1), species: '2:reef_tyrant', how: mash, cap: 360 },
    { note: 'Reef Tyrant aimed mash (no dodge), crawler', build: crawlerMeat, species: '2:reef_tyrant', how: mash, cap: 360 },
    { note: 'Reef Tyrant fight bot, crawler', build: crawlerMeat, species: '2:reef_tyrant', how: fight, cap: 360 },
    { note: 'Crawler vs puffer (fight bot)', build: crawlerMeat, species: '1:puffer', how: fight, cap: 60 },
    { note: 'Crawler vs eel (fight bot)', build: crawlerMeat, species: '2:eel', how: fight, cap: 120 },
    { note: 'Crawler vs squid (fight bot)', build: crawlerMeat, species: '2:squid', how: fight, cap: 120 },
    { note: 'Sardine placed 3 L_e away (fight bot, swimmer)', build: meatBuild(1), species: '1:sardine', how: { ...fight, gapL: 3 }, cap: 60 },
    { note: 'Sardine placed 3 L_e away (fight bot, crawler)', build: crawlerMeat, species: '1:sardine', how: { ...fight, gapL: 3 }, cap: 60 },
  ];
  const rows: NoteRow[] = [];
  for (const x of list) {
    const times: number[] = [], stats = { faints: 0, damage: 0 };
    for (const seed of o.ttkSeeds) for (let i = 0; i < Math.max(1, Math.round(o.ttkTrials / 3)); i++) {
      const t = timeToKill(seed * 1000 + i, x.build, x.species, x.cap, watch, stats, undefined, x.how); if (!Number.isNaN(t)) times.push(t);
    }
    rows.push({ note: x.note, build: x.build.label, species: x.species, median: median(times), faints: stats.faints, trials: times.length, damage: stats.damage, times: times.map(t => Number.isFinite(t) ? Math.round(t * 10) / 10 : -1) });
    flush(rows);
  }
  return rows;
}
function mergeP8(a: ProbeReport['p8'], b: ProbeReport['p8']): ProbeReport['p8'] {
  // A part file stores Infinity as null (JSON): read it back as Infinity, not 0.
  const inf = (x: number | null | undefined) => typeof x === 'number' ? x : Infinity;
  const m = { maxTokens: Math.max(a.maxTokens, b.maxTokens), minActiveGap: Math.min(inf(a.minActiveGap), inf(b.minActiveGap)), minOffScreenWindup: Math.min(inf(a.minOffScreenWindup), inf(b.minOffScreenWindup)),
    windups: a.windups + b.windups, offScreen: (a.offScreen ?? 0) + (b.offScreen ?? 0), gapPair: inf(b.minActiveGap) < inf(a.minActiveGap) ? b.gapPair : a.gapPair, mix: { ...(a.mix ?? {}) } };
  for (const [k, n] of Object.entries(b.mix ?? {})) m.mix[k] = (m.mix[k] ?? 0) + n;
  return { ...m, pass: m.maxTokens <= 2 && m.minActiveGap >= .25 - 1e-6 && m.minOffScreenWindup >= .6 - 1e-6 };
}
/** Merges part reports (each from `runProbe` with some parts) into one report. */
export function mergeReports(list: readonly Partial<ProbeReport>[]): ProbeReport {
  const r = emptyReport();
  for (const x of list) {
    for (const k of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'notes', 'thresholds', 'p1Jitter'] as const) if (x[k]?.length) (r[k] as unknown[]).push(...x[k]!);
    if (x.p8) r.p8 = mergeP8(r.p8, x.p8);
  }
  return judge(r);
}

/** The Markdown summary of a report. */
export function probeMarkdown(r: ProbeReport): string {
  const pct = (x: number) => Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)} %`, sec = (x: number) => Number.isFinite(x) ? `${x.toFixed(1)} s` : '∞';
  const rows = (title: string, list: AttackRow[]) => [`## ${title}`, '', '| Attack | Species | Size | Kind | Band | Trials | Skipped | Share | Bar | Pass |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...list.map(x => `| ${x.attackId} | ${x.species} | ${x.size} | ${x.kind} | ${x.bandSource ?? ''} | ${x.trials} | ${x.skipped} | ${pct(x.share)} | ${x.bar === null ? '—' : pct(x.bar)} | ${x.pass ? 'yes' : '**no**'} |`), ''];
  const p0 = ['## P0 Still player hit at the band points (bar 90 %)', '', '| Attack | Species | Size | Band (L_e) | Band source | Near | Mid | Far | Trials n/m/f | Pass |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.p0.map(x => `| ${x.attackId} | ${x.species} | ${x.size} | ${x.band[0]}–${x.band[1]} | ${x.bandSource} | ${pct(x.near)} | ${pct(x.mid)} | ${pct(x.far)} | ${x.trials.near}/${x.trials.mid}/${x.trials.far} | ${x.pass ? 'yes' : '**no**'} |`), ''];
  const ttk = (title: string, list: TtkRow[]) => [`## ${title}`, '', '| Species | Median | Bar | Trials | Faints | Pass |', '| --- | --- | --- | --- | --- | --- |', ...list.map(x => `| ${x.species} | ${sec(x.median)} | ${x.bar === null ? '—' : sec(x.bar)} | ${x.trials} | ${x.faints} | ${x.pass ? 'yes' : '**no**'} |`), ''];
  const per = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
  const perMin = (s: SizeReport) => { const m = Math.max(1e-9, s.activeSeconds / 60); return `${(s.dna.meals / m).toFixed(1)} / ${(s.dna.kills / m).toFixed(1)} / ${(s.dna.survivor / m).toFixed(1)} / ${(s.dna.alpha / m).toFixed(1)}`; };
  const journeys = ['## P7 Completion', '', '| Line | Diet | Seed | Size | Ready | Active | Faints | Damage ½♥ | Held | DNA meals / kills / survivor / alpha | DNA per min (same order) | Kills | Damage by | Faints by | Unreachable chase |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.p7.flatMap(j => j.sizes.map(s => `| ${j.line} | ${j.diet} | ${j.seed} | ${s.size} | ${s.ready ? 'yes' : '**no**'} | ${sec(s.activeSeconds)} | ${s.faints} | ${s.damageHalfHearts} | ${sec(s.heldSeconds)} | ${s.dna.meals} / ${s.dna.kills} / ${s.dna.survivor} / ${s.dna.alpha} | ${perMin(s)} | ${per(s.kills)} | ${per(s.damageBy)} | ${per(s.faintsBy)} | ${sec(s.unreachableChaseSeconds)} |`)), ''];
  const faints = ['## R7 Faint statistics (per line and size)', '', '| Line | Size | Runs | Faints | Faints per run | Mean DNA lost (wallet) | Mean growth lost | Faint causes |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const line of ['swimmer', 'crawler'] as const) for (const size of [0, 1]) {
    const sizes = r.p7.filter(j => j.line === line).map(j => j.sizes[size]).filter((s): s is SizeReport => !!s), log = sizes.flatMap(s => s.faintLog);
    if (!sizes.length) continue;
    const mean = (xs: number[]) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—', by: Record<string, number> = {};
    for (const f of log) by[f.by] = (by[f.by] ?? 0) + 1;
    faints.push(`| ${line} | ${size} | ${sizes.length} | ${log.length} | ${(log.length / sizes.length).toFixed(2)} | ${mean(log.map(f => f.lostWallet))} | ${mean(log.map(f => f.lostGrowth))} | ${per(by)} |`);
  }
  faints.push('');
  return ['# Tiny Tide combat probe', '', `Overall: ${r.pass ? 'PASS' : '**FAIL**'}`, '',
    'Probe decisions: P0 band points are 5 % inside each edge; pattern and den attacks (no AI band) use probe bands (eel-ambush 0–.9, mother-emerge 0–.6, tyrant-charge .4–1.2); chain-only attacks (mother-pinch-2, mother-pinch-rage) start their parent and score the child (R12(2)); a move is used only when ready (R12(1)); P8 measures active starts in game time.', '',
    ...p0, ...rows('P1 Dash-only avoidance', r.p1), ...rows('P2 Brace', r.p2), ...rows('P3 Counter', r.p3), ...rows('P4 Movement only (reported)', r.p4),
    ...ttk('P5 Time to kill, meat build', r.p5), ...ttk('P6 Time to kill, plant build', r.p6), ...journeys, ...faints,
    '## Reaction thresholds (largest reaction that still meets the bar, step .01 s)', '', '| Measure | Attack | Species | Size | Bar | Threshold | Share at .25 s | Share at .35 s | Trials |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(r.thresholds ?? []).map(x => `| ${x.measure.toUpperCase()} | ${x.attackId} | ${x.species} | ${x.size} | ${pct(x.bar)} | ${x.threshold === null ? 'none' : x.threshold >= .8 ? '≥ 0.80 s' : x.threshold.toFixed(2) + ' s'} | ${pct(x.at25)} | ${pct(x.at35)} | ${x.trials} |`), '',
    '## P1 with reaction jitter .25–.45 s (reported)', '', '| Attack | Species | Size | Trials | Avoided | .25–.30 | .30–.35 | .35–.40 | .40–.45 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(r.p1Jitter ?? []).map(x => `| ${x.attackId} | ${x.species} | ${x.size} | ${x.trials} | ${pct(x.share)} | ${x.bins.map(b => b.n ? `${pct(b.good / b.n)} (${b.n})` : '—').join(' | ')} |`), '',
    '## Balance notes (measured, no bar)', '', '| Note | Build | Species | Median | Trials | Faints | Damage ½♥ | Not killed |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(r.notes ?? []).map(x => `| ${x.note} | ${x.build} | ${x.species} | ${sec(x.median)} | ${x.trials} | ${x.faints} | ${x.damage} | ${x.times.filter(t => t < 0).length} |`), '',
    `Attack mix (wind-ups at the player, every part): ${Object.entries(r.p8.mix ?? {}).sort().map(([k, n]) => `${k} ${n}`).join(', ') || '—'}`, '',
    '## P8 Director', '', `Most tokens at once: ${r.p8.maxTokens}; smallest gap between active starts: ${Number.isFinite(r.p8.minActiveGap) ? r.p8.minActiveGap.toFixed(3) + ' s' : '∞'} (${r.p8.gapPair || '—'}); shortest off-screen wind-up: ${sec(r.p8.minOffScreenWindup)} (${r.p8.offScreen} off-screen); wind-ups watched: ${r.p8.windups}; pass: ${r.p8.pass ? 'yes' : '**no**'}`, ''].join('\n');
}
