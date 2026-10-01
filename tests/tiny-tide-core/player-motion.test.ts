// tests/tiny-tide-core/player-motion.test.ts
import { describe, expect, it } from 'vitest';
import { blockHint, stepPlayer, type PlayerStepContext } from '../../src/tiny-tide/player-motion';
import { breachPermit, habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { newRuntime, type Actor, type CombatInput, type MovementProfile, type Terrain, type Vec3 } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { plan } from '../../src/tiny-tide/plans';
import { makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
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
