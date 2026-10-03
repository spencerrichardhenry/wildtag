// tests/tiny-tide-core/player-motion.test.ts
import { describe, expect, it } from 'vitest';
import { BLOCK_HINT_SECONDS, BREACH_REACH, blockHint, blockHintDue, newBlockHintGate, newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepContext } from '../../src/tiny-tide/player-motion';
import { breachPermit, habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { newRuntime, type Actor, type CombatInput, type MovementProfile, type Terrain, type Vec3 } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { plan } from '../../src/tiny-tide/plans';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { SIZES } from '../../src/tiny-tide/biomes';
import { STAGES } from '../../src/tiny-tide/state';
import { derive, effectiveStats, starterFor } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { forwardOf } from '../../src/tiny-tide/orientation';

const sea = (surface = 85): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });
const deep: Terrain = { groundAt: () => -1e6, surface: 1e6, space: false, slopeBound: 0 };
const ball = (id: string, r: number, L: number): Actor => ({ id: 'player', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r }], habitat: habitat(id), bodyLength: L });
const rod: Actor = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat('open-water'), bodyLength: 2 };
const ctxFor = (planId: string, actor: Actor, t: Terrain, over: Partial<PlayerStepContext> = {}): PlayerStepContext => {
  const p = plan(planId)!;
  return { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: makeWorldQueries(t), bounds: { half: 1e6 }, size: 4, topSpeedLocal: 6.5,
    now: 0, dt: .1, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, ...over };
};
const intent = (over: Partial<CombatInput> = {}): CombatInput => ({ ...RELEASED, ...over });

describe('player step: velocities', () => {
  it('accelerates and brakes in physical units', () => {
    const rt = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, rt, intent(), ctxFor('bulk', ball('open-water', 2, 10), sea(), { wish: { x: 0, y: 0, z: 1 } }));
    expect(rt.controlledVelocity.z).toBeCloseTo(5.6);   // accel 14 × 4 × .1
    const r2 = newRuntime(); r2.controlledVelocity.z = 10; stepPlayer({ x: 0, y: 40, z: 0 }, r2, intent(), ctxFor('bulk', ball('open-water', 2, 10), sea()));
    expect(r2.controlledVelocity.z).toBeCloseTo(6);     // braking 10 × 4 × .1
  });
  it('rises from rest, and never vertically for ground modes', () => {
    const rt = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', 2, 10), sea(), { dt: 1 / 60 }));
    expect(rt.controlledVelocity.y).toBeCloseTo(1.6);   // 24 × 4 / 60
    const c = newRuntime(); stepPlayer({ x: 0, y: 2.6, z: 0 }, c, intent({ traversal: 'rise' }), ctxFor('crawler', ball('seabed', 2.5, 10), sea()));
    expect(c.controlledVelocity.y).toBe(0);
  });
  it('normalizes a diagonal plus rise to the top speed', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 40, z: 0 };
    for (let i = 0; i < 120; i++) p = stepPlayer(p, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', .5, 2), deep, { now: i / 60, dt: 1 / 60, wish: { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 } })).position;
    const v = rt.controlledVelocity; expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(26 + 1e-9); expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(25);   // 6.5 × 1 × 4
  });
  it('decays an impulse without input and never grows it, at every size', () => {
    for (const size of [1, 4, 16, 64, 256]) {
      const rt = newRuntime(); rt.externalVelocity.x = 10 * size; let p: Vec3 = { x: 0, y: 0, z: 0 }, last = Infinity;
      for (let i = 0; i < 60; i++) {
        p = stepPlayer(p, rt, intent(), ctxFor('swimmer', ball('open-water', .3 * size, 2 * size), deep, { size, now: i / 60, dt: 1 / 60 })).position;
        const speed = Math.hypot(rt.controlledVelocity.x + rt.externalVelocity.x, rt.controlledVelocity.y + rt.externalVelocity.y, rt.controlledVelocity.z + rt.externalVelocity.z);
        expect(speed).toBeLessThan(last); last = speed;
      }
      expect(p.x / size).toBeCloseTo(1.74706, 3);   // Σ 10 e^(−.1k) / 60, k = 0…59
      expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 });
    }
  });
  it('removes an impulse into a wall once, and the rest still decays', () => {
    const wall: Terrain = { groundAt: x => x > .5 ? 30 : 0, surface: 85, space: false, slopeBound: 0 };
    const rt = newRuntime(); rt.externalVelocity.x = 5; let p: Vec3 = { x: 0, y: 10, z: 0 };
    for (let i = 0; i < 10; i++) { p = stepPlayer(p, rt, intent(), ctxFor('swimmer', ball('open-water', .3, 2), wall, { now: i / 10 })).position; expect(p.x).toBeLessThanOrEqual(.2 + 1e-6); expect(Math.hypot(rt.externalVelocity.x, rt.externalVelocity.y)).toBeLessThanOrEqual(5); }
    expect(rt.externalVelocity.x).toBeLessThan(.01);
  });
});
describe('player step: turning and facing', () => {
  it('stops a turn at a wall without asking for recovery', () => {
    const wall: Terrain = { groundAt: x => x > .8 ? 30 : 0, surface: 85, space: false, slopeBound: 0 }, fast: MovementProfile = { ...movement('swimmer'), maxYawRate: 100 };
    const rt = newRuntime(), r = stepPlayer({ x: 0, y: 10, z: 0 }, rt, intent(), ctxFor('swimmer', rod, wall, { profile: fast, wish: { x: 1, y: 0, z: 0 } }));
    expect(r.needsRecovery).toBe(false); expect(r.status).not.toBe('invalid-start'); expect(rt.orientation.yaw).toBeGreaterThan(0); expect(rt.orientation.yaw).toBeLessThanOrEqual(3 * Math.PI / 28 + 1e-9);
  });
  it('pitches the nose up for upward intent', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 40, z: 0 };
    for (let i = 0; i < 30; i++) p = stepPlayer(p, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { now: i / 60, dt: 1 / 60, wish: { x: 0, y: 0, z: 1 } })).position;
    expect(rt.orientation.pitch).toBeGreaterThan(0); expect(forwardOf(rt.orientation).y).toBeGreaterThan(0);
  });
  it('faces the aim, and holds facing only while an action locks it', () => {
    const aimP: MovementProfile = { ...movement('swimmer'), facing: 'aim' }, lockP: MovementProfile = { ...movement('swimmer'), facing: 'lock-during-action' };
    const a = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, a, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: aimP, aim: { x: 1, y: 0, z: 0 }, wish: { x: 0, y: 0, z: 1 } })); expect(a.orientation.yaw).toBeCloseTo(.8);   // 8 rad/s × .1 toward +X
    const b = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, b, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: lockP, actionLock: true, wish: { x: 1, y: 0, z: 0 } })); expect(b.orientation.yaw).toBe(0);
    const c = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, c, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: lockP, actionLock: false, wish: { x: 1, y: 0, z: 0 } })); expect(c.orientation.yaw).toBeCloseTo(.8);
  });
  it('keeps a grounded body at its support height while it moves', () => {
    const slope: Terrain = { groundAt: x => .2 * x, surface: 85, space: false, slopeBound: .2 }, a = ball('seabed', .3, 2), rt = newRuntime();
    const start = { x: 0, y: supportHeight(a, 0, 0, { yaw: 0, pitch: 0 }, slope) + .02, z: 0 };
    const r = stepPlayer(start, rt, intent(), ctxFor('crawler', a, slope, { size: 1, wish: { x: 1, y: 0, z: 0 } }));
    expect(r.position.x).toBeGreaterThan(0); expect(r.position.y).toBeCloseTo(supportHeight(a, r.position.x, 0, rt.orientation, slope) + .02, 3);
  });
});
describe('player step: Breach', () => {
  const darter = (t = sea()) => ctxFor('darter', ball('open-water', 2, 10), t, { size: 16, now: 10 });
  it('starts an arc and a permit once, only for plans that can breach', () => {
    const rt = newRuntime(), r = stepPlayer({ x: 0, y: 70, z: 0 }, rt, intent({ traversal: 'breach' }), darter());
    expect(r.breachStarted).toBe(true); expect(rt.permit).toEqual(breachPermit(10)); expect(rt.breachReadyAt).toBeCloseTo(12.3); expect(rt.arc).toMatchObject({ startedAt: 10, fromY: 70 });
    expect(r.position.y).toBeCloseTo(82.8403, 3);   // 70 − 5.8 × .0556 + sin(π/18) × 75.8
    expect(stepPlayer(r.position, rt, intent({ traversal: 'breach' }), { ...darter(), now: 10.1 }).breachStarted).toBe(false);
    const c = newRuntime(); expect(stepPlayer({ x: 0, y: 2.6, z: 0 }, c, intent({ traversal: 'breach' }), ctxFor('crawler', ball('seabed', 2.5, 10), sea())).breachStarted).toBe(false); expect(c.permit).toBeNull();
  });
  it('starts a Breach only within BREACH_REACH body lengths of the surface; deeper, the tap rises (owner ruling M9)', () => {
    // L = 10, surface 85: the reach is 20 under the surface.
    expect(BREACH_REACH).toBe(2);
    const near = newRuntime(), a = stepPlayer({ x: 0, y: 85 - 19, z: 0 }, near, intent({ traversal: 'breach' }), darter());
    expect(a.breachStarted).toBe(true); expect(near.arc).not.toBeNull();
    const deep = newRuntime(), b = stepPlayer({ x: 0, y: 85 - 21, z: 0 }, deep, intent({ traversal: 'breach' }), darter());
    expect(b.breachStarted).toBe(false); expect(deep.arc).toBeNull(); expect(deep.permit).toBeNull(); expect(deep.breachReadyAt).toBe(0);
    expect(deep.controlledVelocity.y).toBeGreaterThan(0);   // a normal Rise
    expect(b.position.y).toBeGreaterThan(85 - 21);
    // A held Rise after the tap keeps rising, and a tap near the surface on cooldown also rises.
    const held = stepPlayer(b.position, deep, intent({ traversal: 'rise' }), { ...darter(), now: 10.1 }); expect(held.position.y).toBeGreaterThan(b.position.y);
    const cool = newRuntime(); cool.breachReadyAt = 99; stepPlayer({ x: 0, y: 85 - 19, z: 0 }, cool, intent({ traversal: 'breach' }), darter());
    expect(cool.arc).toBeNull(); expect(cool.controlledVelocity.y).toBeGreaterThan(0);
  });
  it('accumulates external vertical motion on top of the arc', () => {
    const rt = newRuntime(); rt.externalVelocity.y = 5;
    const a = stepPlayer({ x: 0, y: 70, z: 0 }, rt, intent({ traversal: 'breach' }), darter()); expect(a.position.y).toBeCloseTo(83.3403, 3);   // + 5 × .1
    const b = stepPlayer(a.position, rt, intent(), { ...darter(), now: 10.1 });
    expect(b.position.y).toBeCloseTo(96.0551, 3);   // arcY(.2/1.8) = 95.2807, plus .5 + 5e^(−.6) × .1 = .7744
  });
  it('measures the ground offset against the installed pose after a wall stops the move', () => {
    const slope: Terrain = { groundAt: x => .2 * x, surface: 85, space: false, slopeBound: .2 }, a = ball('seabed', .3, 2), rt = newRuntime(), o = { yaw: 0, pitch: 0 };
    const start = { x: 0, y: supportHeight(a, 0, 0, o, slope) + .02, z: 0 }; rt.externalVelocity.y = 10; rt.externalVelocity.x = 50;   // pushed up and into the x bound at .5
    const r = stepPlayer(start, rt, intent(), ctxFor('crawler', a, slope, { size: 1, bounds: { half: .8 } }));
    expect(r.position.x).toBeLessThanOrEqual(.5 + 1e-9);
    expect(rt.groundOffset).toBeCloseTo(Math.max(0, r.position.y - (supportHeight(a, r.position.x, 0, rt.orientation, slope) + .02)), 9);
  });
  it('lets an upward push lift a grounded body and settle it back, nearly the same at 60 and 120 Hz', () => {
    const at = (hz: number) => { const rt = newRuntime(), a = ball('seabed', .3, 2), sup = supportHeight(a, 0, 0, { yaw: 0, pitch: 0 }, sea()) + .02; rt.externalVelocity.y = 5; let p: Vec3 = { x: 0, y: sup, z: 0 };
      for (let i = 0; i < Math.round(.3 * hz); i++) p = stepPlayer(p, rt, intent(), ctxFor('crawler', a, sea(), { size: 1, now: i / hz, dt: 1 / hz })).position; return p.y - sup; };
    const o60 = at(60), o120 = at(120);
    expect(o60).toBeCloseTo(1.5 * Math.exp(-1.8 + 6 / 60), 3); expect(Math.abs(o60 - o120) / o120).toBeLessThan(.06);   // offset_n = 5 h n e^(−6(n−1)h)
  });
  it('ends the permit by time and asks for a landing when the body is still in the air', () => {
    const rt = newRuntime(); rt.permit = { id: 'breach', startsAt: 9, expiresAt: 10.05, media: ['air'], landingRequired: true };
    const r = stepPlayer({ x: 0, y: 90, z: 0 }, rt, intent(), darter()); expect(r.permitEnded).toBe(true); expect(rt.permit).toBeNull(); expect(r.needsRecovery).toBe(true);
  });
  it('a step that needs recovery can be undone: orientation, permit and arc come back, so the kept pose is admitted (M10)', () => {
    const rt = newRuntime({ yaw: .3, pitch: 0 }), from = { x: 0, y: 90, z: 0 }, ctx = darter();
    rt.permit = { id: 'breach', startsAt: 9, expiresAt: 10.05, media: ['air'], landingRequired: true }; rt.arc = { startedAt: 9.5, duration: 1.8, fromY: 70, endY: 64 };
    const snap = newStepSnapshot(); snapshotStep(rt, snap);
    const r = stepPlayer(from, rt, intent({ traversal: 'dive' }), { ...ctx, wish: { x: 1, y: 0, z: 0 } });
    expect(r.needsRecovery).toBe(true); expect(rt.permit).toBeNull();
    // The step cleared the permit; the last installed pose (in the air at y 90) is then refused without it.
    expect(ctx.queries.overlapHull(ctx.actor, from, rt.orientation, { time: ctx.now, permit: rt.permit, bounds: ctx.bounds }).ok).toBe(false);
    restoreStep(rt, snap);
    expect(rt.permit).toEqual({ id: 'breach', startsAt: 9, expiresAt: 10.05, media: ['air'], landingRequired: true }); expect(rt.arc).toEqual({ startedAt: 9.5, duration: 1.8, fromY: 70, endY: 64 }); expect(rt.orientation).toEqual({ yaw: .3, pitch: 0 });
    expect(ctx.queries.overlapHull(ctx.actor, from, rt.orientation, { time: ctx.now, permit: rt.permit, bounds: ctx.bounds }).ok).toBe(true);
  });
  it('a grown Darter that Breaches at full speed lands in the water and keeps ≥ 95 % of its horizontal speed (M14)', () => {
    const p0 = plan('darter')!, g = starterFor(p0), size = SIZES[2]!, t = makeTerrain(2), q = makeWorldQueries(t), top = STAGES[2]!.speed * derive(effectiveStats(g, p0)).speedFactor;
    for (const growth of [1, 1.38]) {
      const actor = playerActor(p0, g, 2, growth), L = actor.bodyLength, rt = newRuntime(), wish = { x: 0, y: 0, z: 1 };
      let p: Vec3 = { x: 0, y: 85 - .8 * L, z: 0 }, before = 0, landed = -1;
      for (let f = 0; f < 60 * 4; f++) {
        const tap = f === 60 ? intent({ traversal: 'breach' }) : intent();
        const r = stepPlayer(p, rt, tap, { ...ctxFor('darter', actor, t, { size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish }), queries: q });
        expect(r.needsRecovery, `growth ${growth} frame ${f} ${r.status} ${JSON.stringify(p)}`).toBe(false);
        if (f === 59) before = Math.hypot(rt.controlledVelocity.x, rt.controlledVelocity.z);
        p = r.position;
        if (r.arcEnded) { landed = f; break; }
      }
      expect(landed, `growth ${growth}: the arc ended`).toBeGreaterThan(60);
      expect(q.overlapHull(actor, p, rt.orientation, { time: (landed + 1) / 60 }).ok).toBe(true);
      expect(Math.hypot(rt.controlledVelocity.x, rt.controlledVelocity.z) / before, `growth ${growth}`).toBeGreaterThanOrEqual(.95);
    }
  });
  it('lands in the water at the end of a full arc', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 70, z: 0 }, ended = false;
    for (let i = 0; i < 20; i++) { const r = stepPlayer(p, rt, intent(i === 0 ? { traversal: 'breach' } : {}), { ...darter(), now: 10 + i / 10 }); p = r.position; ended ||= r.arcEnded; expect(r.needsRecovery).toBe(false); }
    expect(ended).toBe(true); expect(rt.arc).toBeNull(); expect(rt.permit).toBeNull(); expect(p.y).toBeCloseTo(85 - 1.3 * 16, 3);
  });
});
describe('block hints', () => {
  it('explains each constraint', () => {
    const c = (constraint: string) => ({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: -1, z: 0 }, constraint: constraint as never, distanceFraction: 0, time: 0 });
    expect(blockHint(plan('swimmer')!, c('surface-top'))).toBe("Swimmers can't leave the water."); expect(blockHint(plan('crawler')!, c('floor-gap'))).toBe('Crawlers stay on the seabed.');
    expect(blockHint(plan('swimmer')!, c('bounds-x'))).toBe("That's the edge of the world for now."); expect(blockHint(plan('swimmer')!, c('ground'))).toBe('Something solid is in the way.');
  });
});
describe('block hints show only for a real block (final review I1)', () => {
  /** Steps `frames` at 60 Hz and feeds the hint gate; `free(f)` says whether no other toast is on screen at frame f. */
  const run = (id: string, actor: Actor, t: Terrain, start: Vec3, wish: Vec3, frames: number, free: (f: number) => boolean, stage = 1) => {
    const size = SIZES[stage]!, top = STAGES[stage]!.speed, rt = newRuntime({ yaw: Math.atan2(wish.x, wish.z), pitch: 0 }), q = makeWorldQueries(t), gate = newBlockHintGate();
    let p = start, contacts = 0, slid = 0;
    const due: number[] = [];
    for (let f = 0; f < frames; f++) {
      const r = stepPlayer(p, rt, intent(), { ...ctxFor(id, actor, t, { size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish }), queries: q });
      expect(r.needsRecovery).toBe(false);
      if (r.contacts.length > 0) { contacts++; if (r.progress >= .25) slid++; }
      if (blockHintDue(gate, r, 1 / 60, free(f))) due.push(f);
      p = r.position;
    }
    return { due, contacts, slid };
  };
  it('a Swimmer that skims and dives along the seabed for 10 s never gets a hint', () => {
    const p0 = plan('swimmer')!, actor = playerActor(p0, starterFor(p0), 1, 1), t = makeTerrain(1), a = Math.PI / 4, o = { yaw: a, pitch: 0 };
    const start = { x: 0, y: supportHeight(actor, 0, 0, o, t) + .02 * actor.bodyLength, z: 0 };
    const r = run('swimmer', actor, t, start, { x: Math.sin(a) * .95, y: -.3, z: Math.cos(a) * .95 }, 600, () => true);
    expect(r.contacts, 'the skim touches the seabed').toBeGreaterThan(30);
    expect(r.slid, 'the skim slides').toBeGreaterThan(30);
    expect(r.due).toEqual([]);
  });
  it('a sustained head-on block gets one hint, after BLOCK_HINT_SECONDS', () => {
    const wall: Terrain = { groundAt: x => x > .5 ? 30 : 0, surface: 85, space: false, slopeBound: 0 };
    const r = run('swimmer', ball('open-water', .3, 2), wall, { x: -1, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 180, () => true);
    expect(r.due.length).toBe(1);
    const firstContact = 0;   // the wall is .8 away: the body reaches it within a few frames
    expect(r.due[0]! / 60).toBeGreaterThanOrEqual(firstContact + BLOCK_HINT_SECONDS - 1e-9);
    expect(r.due[0]! / 60).toBeLessThan(1);
  });
  it('never replaces a toast on screen: the hint waits until the toast is gone', () => {
    const wall: Terrain = { groundAt: x => x > .5 ? 30 : 0, surface: 85, space: false, slopeBound: 0 };
    const r = run('swimmer', ball('open-water', .3, 2), wall, { x: -1, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 300, f => f >= 120);
    expect(r.due).toEqual([120]);
  });
});
describe('player step: seabed slopes (playtest stalls)', () => {
  /** 240 frames at 60 Hz of a 45° push with the body starting on the seabed (support height + .02 L), as the investigation's skim. */
  const push = (id: 'swimmer' | 'darter', stage: number, t: Terrain) => {
    const p0 = plan(id)!, g = starterFor(p0), actor = playerActor(p0, g, stage, 1), L = actor.bodyLength, size = SIZES[stage]!;
    const top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor, a = Math.PI / 4, rt = newRuntime({ yaw: a, pitch: 0 });
    const k = top * movement(p0.movement).speedMultiplier * size, q = makeWorldQueries(t);
    let p: Vec3 = { x: 0, y: t.slopeBound > 0 ? supportHeight(actor, 0, 0, rt.orientation, t) + .02 * L : 0, z: 0 }, travel = 0, frozen = 0;
    for (let f = 0; f < 240; f++) {
      const r = stepPlayer(p, rt, intent(), { ...ctxFor(id, actor, t, { size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: Math.sin(a), y: 0, z: Math.cos(a) } }), queries: q });
      expect(r.needsRecovery).toBe(false);
      const step = Math.hypot(r.position.x - p.x, r.position.y - p.y, r.position.z - p.z), v = rt.controlledVelocity;
      if (step < 1e-6 && Math.hypot(v.x, v.y, v.z) > .5 * k) frozen++;
      travel += step; p = r.position;
    }
    return { travel, frozen };
  };
  it('keeps a Swimmer and a Darter moving along a seabed slope', () => {
    for (const [id, stage] of [['swimmer', 1], ['darter', 2]] as const) {
      const real = push(id, stage, makeTerrain(stage)), ideal = push(id, stage, deep).travel;   // the same push without terrain
      expect(real.frozen, id).toBeLessThanOrEqual(2); expect(real.travel / ideal, id).toBeGreaterThanOrEqual(.9);
    }
  });
});

// Fix round 3 (re-review Minor 3): a Swimmer resting on a slope at seed 1501's start could not yaw 15–120° (the seabed), so a Bite toward a
// crab 145° behind it never turned the body. A refused large turn now goes the other way round toward the same target (every pose admitted).
describe('player step: a refused turn goes the long way round', () => {
  it('turns toward a target behind it the other way when the short way is blocked', () => {
    const base = makeWorldQueries(deep), DEG = Math.PI / 180;
    const blocked = (yaw: number) => { const d = ((yaw / DEG) % 360 + 360) % 360; return d > 10 && d < 120; };
    const queries = { ...base, overlapHull: (a: Actor, at: Vec3, o: { yaw: number; pitch: number }, c: never) => blocked(o.yaw) ? { ok: false, constraint: 'ground' as const, point: at, normal: { x: 0, y: 1, z: 0 } } : base.overlapHull(a, at, o, c) };
    const rt = newRuntime(), target = 145 * DEG, face = { dir: { x: Math.sin(target), y: 0, z: Math.cos(target) }, yawRateFactor: 1 };
    const ctx = ctxFor('swimmer', rod, deep, { queries, dt: 1 / 60, combat: { speedFactor: 1, face, dashVelocity: null, forcedDisplacement: null, frozen: false } });
    for (let i = 0; i < 240; i++) { stepPlayer({ x: 0, y: 0, z: 0 }, rt, intent(), ctx); expect(blocked(rt.orientation.yaw)).toBe(false); }
    expect(Math.abs(Math.atan2(Math.sin(rt.orientation.yaw - target), Math.cos(rt.orientation.yaw - target)))).toBeLessThan(2 * DEG);
  });
});
