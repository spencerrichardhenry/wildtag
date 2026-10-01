// tests/tiny-tide-core/lifecycle.test.ts
import { describe, expect, it } from 'vitest';
import { beginRespawn, canChooseNextPlan, evolutionDestination, reconcileAfterCommit, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn } from '../../src/tiny-tide/lifecycle';
import { defaultCatalogs } from '../../src/tiny-tide/registries';
import { newRuntime, type CombatRuntime } from '../../src/tiny-tide/combat-types';
import { designDelta } from '../../src/tiny-tide/design-delta';
import { Ecosystem, type EcoEvent } from '../../src/tiny-tide/ecosystem';
import { freshRun, maxHealthOf, STAGES } from '../../src/tiny-tide/state';
import { PLANS, plan } from '../../src/tiny-tide/plans';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { starterFor, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { REGISTRY_HAZARDS, syntheticAttack } from './helpers';
import { habitat } from '../../src/tiny-tide/profiles';

const action = (uid: string, copy: 0 | 1) => ({ instanceId: `${uid}${copy}`, definitionId: 'pinch', grantId: 'snap', source: { kind: 'part' as const, partUid: uid, copy, socketId: 'pinch' }, phase: 'windup' as const, startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map() });
const busy = (): CombatRuntime => { const rt = newRuntime({ yaw: 1, pitch: .4 }); Object.assign(rt.controlledVelocity, { x: 1, y: 0, z: 0 }); Object.assign(rt.externalVelocity, { x: 0, y: 2, z: 0 });
  rt.permit = { id: 'breach', startsAt: 0, expiresAt: 2, media: ['air'], landingRequired: true }; rt.arc = { startedAt: 0, duration: 1.8, fromY: 3 }; rt.breachReadyAt = 2.3;
  rt.staggerUntil = 4; rt.guardProfileId = 'g'; rt.damageable = false; rt.cooldowns.set('player:p5:snap', 5); rt.actions.push(action('p5', 0), action('p5', 1)); return rt; };
const claw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
const grant: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
const hazardEvent = (e: EcoEvent['entity'], time: number): EcoEvent => ({ type: 'hazard', entity: e, hazard: REGISTRY_HAZARDS['crab-pinch']!, damage: 3, point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, time });

describe('lifecycle', () => {
  it('resets every transient field', () => {
    const rt = busy(); resetRuntime(rt);
    expect(rt).toMatchObject({ permit: null, arc: null, breachReadyAt: 0, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null, damageable: true, targetable: true, perceivable: true, actions: [], orientation: { yaw: 1, pitch: 0 } });
    expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.externalVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.cooldowns.size).toBe(0);
  });
  it('faints once, even when called twice, and resolves once with a legal anchor', () => {
    const run = freshRun(1), rt = busy(), before = structuredClone(run.economy);
    expect(beginRespawn(run, rt)).toBe(true); const after = structuredClone(run.economy);
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
  it('applies an impulse through mass and resistance', () => {
    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime(), e = { ...hazardEvent(crab, 0), hazard: { ...REGISTRY_HAZARDS['crab-pinch']!, impulse: 2 } };
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
