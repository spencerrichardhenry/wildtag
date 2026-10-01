import { describe, expect, it } from 'vitest';
import { findRecoveryPose, projectVelocity, resolveMotion } from '../../src/tiny-tide/motion';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { orientHull } from '../../src/tiny-tide/orientation';
import { habitat } from '../../src/tiny-tide/profiles';
import type { Actor, Orientation, Terrain, TraversalPermit } from '../../src/tiny-tide/combat-types';

// Discontinuous fixtures use slopeBound 0 and test motion mechanics only.
const T = (groundAt: (x: number, z: number) => number, surface = 20): Terrain => ({ groundAt, surface, space: false, slopeBound: 0 });
const flat = T(() => 0), strip = T(x => x > 10 && x < 11 ? 30 : 0), wall = T(x => x > .8 ? 30 : 0);
const ball = (id: string, r = .2, L = 2): Actor => ({ id: 'p', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r }], habitat: habitat(id), bodyLength: L });
const rod = (id = 'open-water'): Actor => ({ id: 'p', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat(id), bodyLength: 2 });
type V = { x: number; y: number; z: number };
const run = (a: Actor, t: Terrain, from: V, d: V, extra: { turn?: Orientation; traversalPermit?: TraversalPermit } = {}, bounds?: { half: number; maxY?: number }, interval = { start: 0, end: 1 }) =>
  resolveMotion({ actorId: 'p', from, displacement: d, orientation: { yaw: 0, pitch: 0 }, hull: a.hull, habitatProfileId: a.habitat.id, cause: 'locomotion', ...extra },
    { queries: makeWorldQueries(t), actor: a, interval, bounds });

describe('resolveMotion', () => {
  it('never tunnels through a thin strip on a long dash', () => {
    const r = run(ball('open-water'), strip, { x: 0, y: 1, z: 0 }, { x: 1000, y: 0, z: 0 });
    expect(r.position.x).toBeLessThanOrEqual(9.8 + 1e-6); expect(r.position.x).toBeGreaterThan(9.7); expect(r.status).toBe('blocked'); expect(r.contacts[0]!.constraint).toBe('ground');
  });
  it('clamps very long moves and reports the rest', () => {
    const r = run(ball('open-water'), flat, { x: 0, y: 1, z: 0 }, { x: 200, y: 0, z: 0 });   // 2000 slots of .1; 512 run
    expect(r.status).toBe('clamped'); expect(r.position.x).toBeCloseTo(51.2); expect(r.unconsumed.x).toBeCloseTo(148.8);
  });
  it('stops on the floor with an upward normal, and the caller removes the inward velocity', () => {
    const r = run(ball('open-water', .3), flat, { x: 0, y: .5, z: 0 }, { x: 0, y: -2, z: 0 });
    expect(r.position.y).toBeGreaterThanOrEqual(.3); expect(r.position.y).toBeLessThan(.301); expect(r.status).toBe('blocked'); expect(r.contacts[0]!.normal.y).toBeCloseTo(1);
    expect(projectVelocity({ x: 3, y: -2, z: 0 }, r.contacts)).toEqual({ x: 3, y: 0, z: 0 }); expect(projectVelocity({ x: 0, y: 2, z: 0 }, r.contacts)).toEqual({ x: 0, y: 2, z: 0 });
  });
  it('slides along the water surface from any starting gap, keeping the sideways motion', () => {
    for (const y0 of [19.5, 19.59, 19.69]) {
      const r = run(ball('open-water', .3), flat, { x: 0, y: y0, z: 0 }, { x: 1, y: 1, z: 0 });
      expect(r.position.x, `${y0}`).toBeCloseTo(1, 6); expect(r.position.y).toBeLessThanOrEqual(19.7); expect(r.contacts[0]!.normal).toEqual({ x: 0, y: -1, z: 0 });
    }
  });
  it('reports an invalid start instead of moving', () => {
    expect(run(ball('open-water'), flat, { x: 0, y: 25, z: 0 }, { x: 1, y: 0, z: 0 })).toMatchObject({ status: 'invalid-start', position: { x: 0, y: 25, z: 0 } });
  });
  it('stops a turn that would swing a long body into a wall, without an invalid start', () => {
    const a = rod(), r = run(a, wall, { x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, { turn: { yaw: Math.PI / 2, pitch: 0 } });
    expect(r.status).not.toBe('invalid-start'); expect(r.orientation.yaw).toBeCloseTo(3 * Math.PI / 28, 6);   // steps of (π/2)/14; the 4th reaches the wall
    const rotated = orientHull(a.hull, r.orientation); expect(Math.max(...rotated.map(c => Math.max(c.start.x, c.end.x) + c.radius))).toBeLessThanOrEqual(.8);
  });
  it('lets a permit carry a body into the air only inside its interval', () => {
    const a = ball('open-water', .3), up = { x: 0, y: 3, z: 0 };
    const full = run(a, flat, { x: 0, y: 19, z: 0 }, up, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: 5, media: ['air'], landingRequired: true } });
    expect(full.status).toBe('moved'); expect(full.position.y).toBeCloseTo(22, 6);
    const half = run(a, flat, { x: 0, y: 19, z: 0 }, up, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: .5, media: ['air'], landingRequired: true } });
    expect(half.status).toBe('needs-recovery'); expect(half.position.y).toBeCloseTo(20.35, 6);   // slot 10 (t = .5) is the first without the permit
  });
  it('asks for recovery when a permit expires while standing still', () => {
    const r = run(ball('open-water', .3), flat, { x: 0, y: 20.5, z: 0 }, { x: 0, y: 0, z: 0 }, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: .5, media: ['air'], landingRequired: true } });
    expect(r).toMatchObject({ status: 'needs-recovery', position: { x: 0, y: 20.5, z: 0 } });
  });
  it('slides inside the interval: no query or result time passes its end', () => {
    // One substep (|d| = .1414 < s = .15) hits the x bound at 40 % of it; the slide must still finish z inside [0, 1].
    const permit = { id: 'b', startsAt: 0, expiresAt: 1.5, media: ['air' as const], landingRequired: true };
    const a = run(ball('open-water', .3), flat, { x: .66, y: 21, z: 0 }, { x: .1, y: 0, z: .1 }, { traversalPermit: permit }, { half: 1 });
    expect(a.position.x).toBeLessThanOrEqual(.7 + 1e-9); expect(a.position.z).toBeCloseTo(.1, 6); expect(a.time).toBeLessThanOrEqual(1);
    for (const c of a.contacts) { expect(c.time).toBeGreaterThanOrEqual(0); expect(c.time).toBeLessThanOrEqual(1); }
    const b = run(ball('open-water', .3), flat, { x: 0, y: 19.6999, z: 0 }, { x: Math.sqrt(.99), y: .1, z: 0 });   // a partial first step, then a long slide
    expect(b.position.x).toBeCloseTo(Math.sqrt(.99), 6); expect(b.time).toBeLessThanOrEqual(1); for (const c of b.contacts) expect(c.time).toBeLessThanOrEqual(1);
  });
  it('treats world bounds as a contact with a face normal', () => {
    const r = run(ball('open-water'), flat, { x: 9, y: 1, z: 0 }, { x: 5, y: 0, z: 0 }, {}, { half: 10 });
    expect(r.position.x).toBeLessThanOrEqual(9.8); expect(r.contacts[0]).toMatchObject({ constraint: 'bounds-x', normal: { x: -1, y: 0, z: 0 } });
  });
});
describe('findRecoveryPose', () => {
  const ctx = (t: Terrain, o: Orientation = { yaw: 0, pitch: 0 }, bounds?: { half: number; maxY?: number }) => ({ queries: makeWorldQueries(t), orientation: o, time: 0, bounds });
  it('recovers an air creature to just above the surface', () => {
    const r = findRecoveryPose(ball('sp-air', .3), { x: 0, y: 10, z: 0 }, ctx(flat), { maxDistance: 30 }); expect(r.ok && r.position.y).toBeCloseTo(20.32);   // 20 + .3 + .01 × 2
  });
  it('picks the nearest legal height within a 3D bound', () => {
    const a = ball('seabed', .3);   // floor band top: 0 + 1.1 × 2 + .3 − .02 = 2.48
    expect(findRecoveryPose(a, { x: 0, y: 12, z: 0 }, ctx(flat), { maxDistance: 5 }).ok).toBe(false);
    const r = findRecoveryPose(a, { x: 0, y: 12, z: 0 }, ctx(flat), { maxDistance: 12 }); expect(r.ok && r.position.y).toBeCloseTo(2.48);
  });
  it('fails explicitly, and then uses a legal anchor', () => {
    expect(findRecoveryPose(ball('shallow-shore', .3), { x: 0, y: 10, z: 0 }, ctx(flat), { maxDistance: 10 })).toEqual({ ok: false, reason: 'No legal pose within the search budget.' });
    const island = T(x => x > 30 ? 24 : 0);
    expect(findRecoveryPose(ball('land', .3), { x: 0, y: 10, z: 0 }, ctx(island), { maxDistance: 2, anchor: { x: 40, y: 24.4, z: 0 } })).toEqual({ ok: true, position: { x: 40, y: 24.4, z: 0 }, orientation: { yaw: 0, pitch: 0 } });
  });
  it('recovers a turned long body with its own orientation', () => {
    const o = { yaw: Math.PI / 2, pitch: 0 }, r = findRecoveryPose(rod(), { x: 0, y: 10, z: 0 }, ctx(wall, o), { maxDistance: 5 });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.position.x).toBeCloseTo(-Math.SQRT1_2); expect(r.position.z).toBeCloseTo(Math.SQRT1_2); expect(r.orientation).toEqual(o);   // ring 1, j = 6 is the first with its tip clear of x = .8
  });
  it('respects the sky bound', () => {
    const r = findRecoveryPose(ball('sp-air', .3), { x: 0, y: 40, z: 0 }, ctx(flat, undefined, { half: 50, maxY: 30 }), { maxDistance: 30 }); expect(r.ok && r.position.y).toBeCloseTo(20.32);
  });
});
