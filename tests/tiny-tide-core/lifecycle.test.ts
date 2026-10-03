// tests/tiny-tide-core/lifecycle.test.ts
import { describe, expect, it } from 'vitest';
import { beginRespawn, canChooseNextPlan, evolutionDestination, growthPose, reconcileAfterCommit, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn } from '../../src/tiny-tide/lifecycle';
import { defaultCatalogs } from '../../src/tiny-tide/registries';
import { newRuntime, type CombatRuntime } from '../../src/tiny-tide/combat-types';
import { designDelta } from '../../src/tiny-tide/design-delta';
import { Ecosystem, type EcoEvent } from '../../src/tiny-tide/ecosystem';
import { freshRun, maxHealthOf, STAGES } from '../../src/tiny-tide/state';
import { earn } from '../../src/tiny-tide/economy';
import { PLANS, plan } from '../../src/tiny-tide/plans';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { starterFor, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { derive, effectiveStats } from '../../src/tiny-tide/genome';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
import { stepPlayer } from '../../src/tiny-tide/player-motion';
import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { RELEASED } from '../../src/tiny-tide/input';
import { blankAction, REGISTRY_HAZARDS, syntheticAttack } from './helpers';

const action = (uid: string, copy: 0 | 1) => blankAction({ instanceId: `${uid}${copy}`, source: { kind: 'part', partUid: uid, copy, socketId: 'pinch' }, cooldownKey: `player:${uid}:snap` });
const busy = (): CombatRuntime => { const rt = newRuntime({ yaw: 1, pitch: .4 }); Object.assign(rt.controlledVelocity, { x: 1, y: 0, z: 0 }); Object.assign(rt.externalVelocity, { x: 0, y: 2, z: 0 });
  rt.permit = { id: 'breach', startsAt: 0, expiresAt: 2, media: ['air'], landingRequired: true }; rt.arc = { startedAt: 0, duration: 1.8, fromY: 3, endY: 60 }; rt.breachReadyAt = 2.3;
  rt.staggerUntil = 4; rt.guardProfileId = 'g'; rt.damageable = false; rt.cooldowns.set('player:p5:snap', 5); rt.actions.push(action('p5', 0), action('p5', 1)); return rt; };
const claw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
const grant: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
const hazardEvent = (e: EcoEvent['entity'], time: number): EcoEvent => ({ type: 'hazard', entity: e, hazard: REGISTRY_HAZARDS['jelly-sting']!, damage: 3, point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, time });

describe('lifecycle', () => {
  it('resets every transient field', () => {
    const rt = busy(); resetRuntime(rt);
    expect(rt).toMatchObject({ permit: null, arc: null, breachReadyAt: 0, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null, damageable: true, targetable: true, perceivable: true, actions: [], orientation: { yaw: 1, pitch: 0 } });
    expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.externalVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.cooldowns.size).toBe(0);
  });
  it('resets the combat fields (spec §13): action clock, hit-stop, buffer, holds and status', () => {
    const rt = busy(); Object.assign(rt, { actionClock: 7, hitStopUntil: 8, buffered: { input: 'basic', at: 6.9 }, heldBy: 'e3', breakProgress: .5, status: { id: 'inked', until: 9, speedFactor: .7 } });
    resetRuntime(rt);
    expect(rt).toMatchObject({ actionClock: 0, hitStopUntil: 0, buffered: null, heldBy: null, breakProgress: 0, status: null });
  });
  it('faints once, even when called twice, and resolves once with a legal anchor', () => {
    const run = freshRun(1), rt = busy(); run.economy = earn(run.economy, 7); const before = structuredClone(run.economy);
    expect(beginRespawn(run, rt)).toBe(true); const after = structuredClone(run.economy); expect(after.wallet.atRisk).toBe(0);
    expect(beginRespawn(run, rt)).toBe(false); expect(run.economy).toEqual(after); expect(run.deaths).toBe(1); expect(after).not.toEqual(before);
    const anchor = { ok: true as const, position: { x: 0, y: 1, z: 0 }, orientation: { yaw: 0, pitch: 0 } };
    expect(resolveRespawn(run, rt, 10, { ok: false, reason: 'none' })).toBe(false); expect(run.pendingRespawn).toBe(true);
    expect(resolveRespawn(run, rt, 10, anchor)).toBe(true); expect(run.health).toBe(maxHealthOf(run)); expect(rt.invulnerableUntil).toBe(13);
    expect(rt.orientation).toEqual({ yaw: 0, pitch: 0 });   // the anchor's checked orientation, not the retained yaw 1
    expect(resolveRespawn(run, rt, 11, anchor)).toBe(false);
  });
  const cats = { ...defaultCatalogs(), parts: grant, attacks: { pinch: { ...syntheticAttack, cooldownSeconds: 1 } } };
  it('cancels actions of removed and changed emitters, and keeps cooldowns whose grant survives', () => {
    const rt = busy(), kept = claw({ mirror: false }); reconcileAfterCommit(rt, designDelta(claw(), kept, { active: [null, null] }, grant), kept, 'player', 0, cats);
    expect(rt.actions).toEqual([]); expect([...rt.cooldowns.keys()]).toEqual(['player:p5:snap']);   // copy 1 removed, copy 0 changed; the grant still exists
    const rt2 = busy(), swapped = claw({ id: 'spike', mirror: false }); reconcileAfterCommit(rt2, designDelta(claw(), swapped, { active: [null, null] }, grant), swapped, 'player', 0, cats);
    expect(rt2.cooldowns.size).toBe(0);   // same uid, catalog replacement without the grant
    const rt3 = busy(); reconcileAfterCommit(rt3, designDelta(claw(), claw(), { active: [null, null] }, grant), claw(), 'player', 0, cats); expect(rt3.actions).toHaveLength(2);
  });
  it('reserves the cooldown of an interrupted action whose grant survives', () => {
    const rt = newRuntime(); rt.actions.push(action('p5', 0)); const moved = claw({ t: .5 });
    reconcileAfterCommit(rt, designDelta(claw(), moved, { active: [null, null] }, grant), moved, 'player', 10, cats);
    expect(rt.actions).toEqual([]); expect(rt.cooldowns.get('player:p5:snap')).toBe(11);   // 10 + cooldown 1, though the map was empty
  });
  it('recovers a pitched long body by levelling it, and never returns an unchecked anchor', () => {
    const shallow = makeWorldQueries({ groundAt: () => 0, surface: 1.2, space: false, slopeBound: 0 });
    const rod = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat('open-water'), bodyLength: 2 };
    const bad = { ok: true as const, position: { x: 0, y: 5, z: 0 }, orientation: { yaw: 0, pitch: 0 } };
    const r = recoverPlayer(rod, { x: 0, y: .6, z: 0 }, { yaw: .5, pitch: 1.2 }, { queries: shallow, time: 0 }, bad, 4);   // pitched span 2 sin 1.2 + .6 > 1.2
    expect(r).toMatchObject({ ok: true, position: { x: 0, y: .6, z: 0 }, orientation: { yaw: .5, pitch: 0 } });
    const none = makeWorldQueries({ groundAt: () => 0, surface: .5, space: false, slopeBound: 0 });   // nothing fits; the anchor is rechecked and refused
    expect(recoverPlayer(rod, { x: 0, y: .3, z: 0 }, { yaw: 0, pitch: 0 }, { queries: none, time: 0 }, bad, 4).ok).toBe(false);
  });
  it('accepts one hit per invulnerability window, in order, only while playing and damageable', () => {
    const crabs = new Ecosystem(7).entities.filter(e => e.spec.key === '1:crab'), [a, b] = [crabs[0]!, crabs[1]!];
    const ctx = (rt: CombatRuntime, now: number, over = {}) => ({ mode: 'playing', pendingRespawn: false, rt, now, mass: 4, resistance: .5, ...over });
    const rt = newRuntime(); const first = resolveHazards([hazardEvent(b, 0), hazardEvent(a, 0)], ctx(rt, 0));
    expect(first.map(e => e.entity)).toEqual([a.id < b.id ? a : b]); expect(rt.invulnerableUntil).toBeCloseTo(.8); expect(rt.externalVelocity.x).toBeCloseTo(0);   // impulse 0 today
    expect(resolveHazards([hazardEvent(a, .5)], ctx(rt, .5))).toEqual([]); expect(resolveHazards([hazardEvent(b, .9)], ctx(rt, .9))).toHaveLength(1);
    expect(resolveHazards([hazardEvent(a, 5)], ctx(newRuntime(), 5, { mode: 'evolving' }))).toEqual([]);
    expect(resolveHazards([hazardEvent(a, 5)], ctx(newRuntime(), 5, { pendingRespawn: true }))).toEqual([]);
    const off = newRuntime(); off.damageable = false; expect(resolveHazards([hazardEvent(a, 5)], ctx(off, 5))).toEqual([]);
  });
  it('an accepted hazard marks the damage time (regeneration waits, spec §10.2); a rejected one does not', () => {
    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime();
    const ctx = (now: number) => ({ mode: 'playing', pendingRespawn: false, rt, now, mass: 4, resistance: .5 });
    resolveHazards([hazardEvent(crab, 2)], ctx(2)); expect(rt.lastDamageAt).toBe(2);
    expect(resolveHazards([hazardEvent(crab, 2.5)], ctx(2.5))).toEqual([]); expect(rt.lastDamageAt).toBe(2);   // still invulnerable
  });
  it('applies an impulse through mass and resistance', () => {
    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime(), e = { ...hazardEvent(crab, 0), hazard: { ...REGISTRY_HAZARDS['jelly-sting']!, impulse: 2 } };
    resolveHazards([e], { mode: 'playing', pendingRespawn: false, rt, now: 0, mass: 4, resistance: .5 }); expect(rt.externalVelocity.x).toBeCloseTo(.25);   // 2 / 4 × .5
  });
  it('finds a legal evolution destination away from an illegal start, or uses the anchor', () => {
    const p = plan('shellback')!, actor = playerActor(p, starterFor(p), 2, 1), q = makeWorldQueries(makeTerrain(2)), here = { x: 0, y: 80, z: 0 };
    const r = evolutionDestination(actor, here, { queries: q, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { x: 0, y: 0, z: 0 });
    expect(r.ok).toBe(true); if (!r.ok) return; expect(r.position.y).toBeLessThan(here.y);
    expect(q.overlapHull(actor, r.position, r.orientation, { time: 0 }).ok).toBe(true);
  });
  it('allows evolution only when ready and a child is eligible', () => {
    const run = freshRun(1); expect(canChooseNextPlan(run, { coast: false })).toBe(false);
    run.stageDna = STAGES[0]!.goal; expect(canChooseNextPlan(run, { coast: false })).toBe(true);
    expect(canChooseNextPlan(run, { coast: false }, PLANS.filter(p => p.size === 0))).toBe(false);
  });
});
describe('growth at the floor (playtest: a bite stops the body)', () => {
  // The investigation's floor replay (probe-growth): 120 frames of a push along the seabed, then one 9-DNA bite grows the hull.
  for (const [id, stage, heading] of [['swimmer', 1, 0], ['darter', 2, Math.PI / 4]] as const) it(`lifts a grown ${id} off the floor and keeps its velocity`, () => {
    const p = plan(id)!, g = starterFor(p), size = SIZES[stage]!, terrain = makeTerrain(stage), queries = makeWorldQueries(terrain), bounds = { half: PLAYER_HALF * size };
    const actor = playerActor(p, g, stage, 1), L = actor.bodyLength, rt = newRuntime({ yaw: heading, pitch: 0 });
    const top = STAGES[stage]!.speed * derive(effectiveStats(g, p)).speedFactor;
    let pos = { x: 0, y: supportHeight(actor, 0, 0, rt.orientation, terrain) + .02 * L, z: 0 }, touching = false;
    // At least 120 frames, then until a frame ends in seabed contact (the tight swim hull of P3 touches the floor less often).
    for (let f = 0; f < 240 && !(f >= 120 && touching); f++) {
      const r = stepPlayer(pos, rt, RELEASED, { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries, bounds, size, topSpeedLocal: top,
        now: f / 60, dt: 1 / 60, wish: { x: Math.sin(heading), y: 0, z: Math.cos(heading) }, aim: null, actionLock: false });
      pos = r.position; touching = r.contacts.some(c => c.constraint === 'ground');
    }
    expect(touching).toBe(true);
    const grown = playerActor(p, g, stage, 1 + .38 * 9 / STAGES[stage]!.goal), now = 2, ctx = { queries, bounds, time: now };
    expect(queries.overlapHull(grown, pos, rt.orientation, { time: now, bounds }).ok).toBe(false);   // the grown hull reaches into the floor
    const cv = { ...rt.controlledVelocity }, ev = { ...rt.externalVelocity }, o = { ...rt.orientation };
    expect(Math.hypot(cv.x, cv.y, cv.z)).toBeGreaterThan(.5 * top * size);
    const lifted = growthPose(grown, pos, rt, ctx);
    expect(lifted).not.toBeNull(); if (!lifted) return;
    expect(queries.overlapHull(grown, lifted, rt.orientation, { time: now, bounds }).ok).toBe(true);
    const lift = Math.hypot(lifted.x - pos.x, lifted.y - pos.y, lifted.z - pos.z);
    expect(lift).toBeGreaterThan(0); expect(lift).toBeLessThanOrEqual(.5 * grown.bodyLength);
    expect(lifted.y).toBeGreaterThan(pos.y);
    expect(rt.controlledVelocity).toEqual(cv); expect(rt.externalVelocity).toEqual(ev); expect(rt.orientation).toEqual(o);
  });
  it('returns the same position when the grown hull is already admitted, and null when no lift within .5 L helps', () => {
    const p = plan('swimmer')!, grown = playerActor(p, starterFor(p), 1, 1.1), queries = makeWorldQueries(makeTerrain(1)), rt = newRuntime();
    const mid = { x: 0, y: 60, z: 0 }; expect(growthPose(grown, mid, rt, { queries, time: 0 })).toEqual(mid);
    const flat = makeWorldQueries({ groundAt: () => 0, surface: 1, space: false, slopeBound: 0 });   // no water deep enough for the body
    expect(growthPose(grown, { x: 0, y: .5, z: 0 }, rt, { queries: flat, time: 0 })).toBeNull();
  });
});
