import { describe, expect, it } from 'vitest';
import { findRecoveryPose, projectVelocity, resolveMotion } from '../../src/tiny-tide/motion';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { seabedHeight } from '../../src/tiny-tide/biomes';
import { starterFor } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { plan } from '../../src/tiny-tide/plans';
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
describe('resolveMotion on the curved seabed (playtest stalls)', () => {
  // The starter Swimmer (stage 1) and Darter (stage 2) at growth 1: the hulls of the playtest fixtures.
  const swimActor = (id: 'swimmer' | 'darter', stage: number) => playerActor(plan(id)!, starterFor(plan(id)!), stage, 1);
  const move = (a: Actor, stage: number, from: V, d: V, o: Orientation, bounds?: { half: number }) =>
    resolveMotion({ actorId: 'player', from, displacement: d, orientation: o, hull: a.hull, habitatProfileId: a.habitat.id, cause: 'locomotion' },
      { queries: makeWorldQueries(makeTerrain(stage)), actor: a, interval: { start: 0, end: 1 / 60 }, bounds });
  it('slides a Darter along the seabed from the replayed stall pose', () => {
    // The replay pose of the investigation (probe-stuck, Darter, heading 45°, frame 170): the body touches the seabed, d is tangent.
    const a = swimActor('darter', 2), o = { yaw: Math.PI / 4, pitch: 0 }, q = makeWorldQueries(makeTerrain(2));
    const from = { x: 26.59556485410397, y: 21.87451239776108, z: 26.681934445099913 }, d = { x: 1.4145296383723478, y: .2657150390029284, z: 1.4469136184714597 };
    const n = { x: -.1526, y: .9878, z: -.0322 }, dn = d.x * n.x + d.y * n.y + d.z * n.z;   // the replay's contact normal
    const t = { x: d.x - dn * n.x, y: d.y - dn * n.y, z: d.z - dn * n.z }, ideal = Math.hypot(t.x, t.y, t.z);
    expect(q.overlapHull(a, from, o, { time: 0 }).ok).toBe(true);
    const r = move(a, 2, from, d, o), along = ((r.position.x - from.x) * t.x + (r.position.y - from.y) * t.y + (r.position.z - from.z) * t.z) / ideal;
    expect(along / ideal).toBeGreaterThanOrEqual(.9);
    expect(r.status).not.toBe('needs-recovery'); expect(q.overlapHull(a, r.position, o, { time: 1 / 60 }).ok).toBe(true);
  });
  it('slides along the crease of a box bound and the seabed instead of stopping in the corner', () => {
    // A synthetic square bound (the world edge will change later). The body is settled into the bound and the floor, then pushed
    // forward, down and sideways each frame. The ideal is the push along the crease of the two faces.
    for (const [id, stage, half, heading, speed] of [['swimmer', 1, 10, .4, 6.5 * 4], ['swimmer', 1, 10, -.4, 6.5 * 4], ['darter', 2, 22, .4, 7.65 * 16]] as const) {
      const a = swimActor(id, stage), L = a.bodyLength, bounds = { half: half * L }, o = { yaw: 0, pitch: 0 }, q = makeWorldQueries(makeTerrain(stage));
      let p: V = { x: 0, y: 0, z: bounds.half - 3 * L }; p.y = supportHeight(a, p.x, p.z, o, makeTerrain(stage)) + .2 * L;
      for (let i = 0; i < 30; i++) p = move(a, stage, p, { x: 0, y: -.5 * L, z: .5 * L }, o, bounds).position;
      const s = speed / 60, d = { x: s * Math.sin(heading), y: -.3 * s, z: s * Math.cos(heading) };
      let frozen = 0, along = 0, ideal = 0;
      for (let f = 0; f < 120; f++) {
        const r = move(a, stage, p, d, o, bounds);
        // Crease direction: (terrain normal) × (0, 0, −1), from the analytic seabed gradient at the body.
        const gx = seabedHeight(p.x + .5, p.z) - seabedHeight(p.x - .5, p.z), el = Math.hypot(1, gx), ex = -1 / el, ey = -gx / el;
        ideal += Math.abs(d.x * ex + d.y * ey); along += Math.abs((r.position.x - p.x) * ex + (r.position.y - p.y) * ey);
        if (Math.hypot(r.position.x - p.x, r.position.y - p.y, r.position.z - p.z) < 1e-6) frozen++;
        expect(r.status, `${id} ${heading} frame ${f}`).not.toBe('needs-recovery'); expect(q.overlapHull(a, r.position, o, { time: 0, bounds }).ok).toBe(true);
        p = r.position;
      }
      expect(frozen, `${id} ${heading}`).toBeLessThanOrEqual(2); expect(along / ideal, `${id} ${heading}`).toBeGreaterThanOrEqual(.9);
    }
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
