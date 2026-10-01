import { describe, expect, it } from 'vitest';
import { makeTerrain, makeWorldQueries, sampleEnvironment, supportHeight, zoneLabel } from '../../src/tiny-tide/world-queries';
import { forwardOf, orientHull } from '../../src/tiny-tide/orientation';
import { habitat } from '../../src/tiny-tide/profiles';
import type { Actor, Capsule, Terrain } from '../../src/tiny-tide/combat-types';

const T = (groundAt: (x: number, z: number) => number, slopeBound = 0, surface = 20, space = false): Terrain => ({ groundAt, surface, space, slopeBound });
const flat = T(() => 0), island = T(x => x > 30 ? 24 : 0), wall = T(x => x > .5 ? 30 : 0);
const ball = (r: number, extra: Partial<Capsule> = {}): Capsule[] => [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r, ...extra }];
const actor = (id: string, hull: Capsule[], L: number): Actor => ({ id: 'a', hull, habitat: habitat(id), bodyLength: L });
const admit = (id: string, hull: Capsule[], L: number, t: Terrain, at: { x: number; y: number; z: number }, ctx = {}, extras = {}) =>
  makeWorldQueries(t, extras).overlapHull(actor(id, hull, L), at, { yaw: 0, pitch: 0 }, { time: 0, ...ctx });
/** Independent dense check: true when no point under the hull is below the ground. */
const clearOf = (t: Terrain, hull: Capsule[], at: { x: number; y: number; z: number }) => {
  for (const c of hull) for (let k = 0; k <= 40; k++) {
    const f = k / 40, ax = at.x + c.start.x + (c.end.x - c.start.x) * f, ay = at.y + c.start.y + (c.end.y - c.start.y) * f, az = at.z + c.start.z + (c.end.z - c.start.z) * f;
    for (let ring = 0; ring <= 8; ring++) for (let s = 0; s < 24; s++) {
      const d = c.radius * ring / 8, a = s / 24 * Math.PI * 2, x = ax + Math.cos(a) * d, z = az + Math.sin(a) * d;
      if (ay - Math.sqrt(Math.max(0, c.radius ** 2 - d * d)) < t.groundAt(x, z) - 1e-9) return false;
    }
  }
  return true;
};

describe('orientation', () => {
  it('points the nose up for positive pitch', () => { const f = forwardOf({ yaw: 0, pitch: .3 }); expect(f.y).toBeCloseTo(Math.sin(.3)); expect(f.z).toBeCloseTo(Math.cos(.3)); });
  it('turns +Z toward +X for positive yaw', () => { expect(forwardOf({ yaw: Math.PI / 2, pitch: 0 }).x).toBeCloseTo(1); });
  it('widens the envelope when pitched', () => {
    const h = orientHull(ball(1, { sway: .2, heave: .1 }), { yaw: 0, pitch: Math.PI / 2 })[0]!;
    expect(h.sway).toBeCloseTo(.3); expect(h.heave).toBeCloseTo(.2);   // .2 + .1 × 1, .1 × 0 + .2 × 1
  });
});
describe('conservative ground admission', () => {
  const plane = T(x => .5 * x, .5);
  it('rejects a sphere that touches a sloped plane between grid points', () => {
    expect(admit('open-water', ball(1), 2, plane, { x: 0, y: 1, z: 0 })).toMatchObject({ ok: false, constraint: 'ground' });   // true clearance 1/√1.25 = .894 < 1
    expect(admit('open-water', ball(1), 2, plane, { x: 0, y: 1.45, z: 0 }).ok).toBe(true);   // worst grid point (1, 0): .5 + .1768 + .7630 = 1.4398
  });
  it('never admits a pose that intersects a valid-bound terrain (dense check)', () => {
    const wavy = T((x, z) => .3 * Math.sin(2 * x) * Math.cos(1.5 * z), .75);   // |∇| ≤ √(.6² + .45²) = .75
    const bump = T((x, z) => .4 * Math.max(0, 1 - ((x - .3) ** 2 + z * z) / .04), 4);   // peak .4 at d = .3; slope ≤ .4 × 2 × .2 / .04 = 4
    const capsule: Capsule[] = [{ start: { x: -1, y: 0, z: 0 }, end: { x: 1, y: 0, z: .5 }, radius: .4 }];
    let admitted = 0;
    for (const [t, hull] of [[plane, ball(1)], [wavy, capsule], [bump, ball(1)]] as const) for (let x = -1; x <= 1; x += .25) for (let y = .4; y <= 3.6; y += .05) {
      const ok = admit('open-water', [...hull], 2, t, { x, y, z: 0 }).ok; if (ok) { admitted++; expect(clearOf(t, [...hull], { x, y, z: 0 }), `${x} ${y}`).toBe(true); }
    }
    expect(admitted).toBeGreaterThan(100);   // not vacuous
    expect(admit('open-water', ball(1), 2, bump, { x: 0, y: 1.2, z: 0 }).ok).toBe(false);   // the bump pierces the underside: 1.2 − √(1 − .09) = .246 < .4
  });
  it('covers the capsule between axis samples', () => {
    const ridge = T(x => .5 * Math.max(0, 1 - Math.abs(x - .0714) / .05), 10);
    const rod: Capsule[] = [{ start: { x: -1, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, radius: .3 }];
    expect(admit('open-water', rod, 2, ridge, { x: 0, y: .75, z: 0 }).ok).toBe(false);   // underside .45 < ridge .5
  });
  it('adds the sway to the ground reach', () => {
    expect(admit('open-water', ball(.3), 2, wall, { x: 0, y: 10, z: 0 }).ok).toBe(true);                     // reach .3 + h/√2 = .406: grid x ≤ .3
    expect(admit('open-water', ball(.3, { sway: .3 }), 2, wall, { x: 0, y: 10, z: 0 })).toMatchObject({ ok: false, constraint: 'ground' });   // grid x = .6 is in the wall
  });
  it('places a grounded body at its support height', () => {
    const y = supportHeight(actor('seabed', ball(.3), 2), 0, 0, { yaw: 0, pitch: 0 }, flat); expect(y).toBeCloseTo(.3, 6);
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: y + .02, z: 0 }).ok).toBe(true); expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: y - .01, z: 0 }).ok).toBe(false);
  });
  it('bounds the real seabed slope', () => {
    const t = makeTerrain(0); let worst = 0;
    for (let x = -400; x <= 400; x += 7) for (let z = -400; z <= 400; z += 7) worst = Math.max(worst, Math.hypot(t.groundAt(x + .01, z) - t.groundAt(x, z), t.groundAt(x, z + .01) - t.groundAt(x, z)) / .01);
    expect(worst).toBeLessThanOrEqual(t.slopeBound);
  });
});
describe('media, bounds and refuges', () => {
  it('admits a swimmer in water and rejects it when its top leaves the water', () => {
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 19.6, z: 0 }).ok).toBe(true);                                       // top 19.9
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 19.8, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });   // top 20.1
  });
  it('keeps a seabed body within its floor gap, measured from the lowest point', () => {
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: 2.4, z: 0 }).ok).toBe(true);                                        // lowest 2.1 ≤ 1.1 × 2
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: 2.6, z: 0 })).toMatchObject({ ok: false, constraint: 'floor-gap' });  // 2.3 > 2.2
  });
  it('lets a surface actor float within its band', () => {
    expect(admit('sp-surface', ball(.3), 2, flat, { x: 0, y: 20.8, z: 0 }).ok).toBe(true);    // top 21.1 ≤ 20 + .6 × 2
    expect(admit('sp-surface', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }).ok).toBe(false);     // top 21.3
  });
  it('lets wading bodies stand above the water, including shallow-shore with no floor gap', () => {
    for (const id of ['seabed-land', 'shallow-shore']) expect(admit(id, ball(15), 10, flat, { x: 0, y: 15.5, z: 0 }).ok, id).toBe(true);   // gap .5 ≤ 11; depth 20 ≤ 25
    expect(admit('open-water', ball(15), 10, flat, { x: 0, y: 15.5, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });
    expect(admit('shallow-shore', ball(.3), 2, flat, { x: 0, y: 25, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });   // wading does not mean flying
  });
  it('limits water depth over the whole footprint, not just six points', () => {
    const tilted = T((x, z) => .2 * (x + z), Math.sqrt(.08), 5);   // |∇| = .2√2
    expect(admit('shallow-shore', ball(1), 2.1, tilted, { x: 0, y: 2.5, z: 0 })).toMatchObject({ ok: false, constraint: 'depth' });   // the diagonal point sits in 5.28 > 2.5 × 2.1 = 5.25
    expect(admit('shallow-shore', ball(1), 2.1, tilted, { x: 2, y: 2.5, z: 2 }).ok).toBe(true);   // shallower: Gmin ≈ .8 − .3 − .1 = .4, depth 4.6
  });
  it('limits water depth', () => { expect(admit('shallow-shore', ball(.3), 2, T(() => -10), { x: 0, y: 5, z: 0 })).toMatchObject({ ok: false, constraint: 'depth' }); });   // 30 > 2.5 × 2
  it('admits land only near dry ground, and air anywhere for flyers', () => {
    expect(admit('land', ball(.3), 2, island, { x: 40, y: 24.5, z: 0 }).ok).toBe(true);                                   // .2 ≤ .6 × 2
    expect(admit('land', ball(.3), 2, island, { x: 40, y: 30, z: 0 })).toMatchObject({ ok: false, constraint: 'air' });     // 5.7 > 1.2
    expect(admit('sp-air', ball(.3), 2, island, { x: 40, y: 30, z: 0 }).ok).toBe(true);
  });
  it('treats space as its own medium with the documented sentinels', () => {
    const space = T(() => 0, 0, 20, true);
    expect(sampleEnvironment({ x: 0, y: 0, z: 0 }, space)).toMatchObject({ medium: 'space', groundClearance: Number.POSITIVE_INFINITY, surfaceHeight: null });
    expect(admit('space', ball(1), 2, space, { x: 0, y: 0, z: 0 }).ok).toBe(true); expect(admit('open-water', ball(1), 2, space, { x: 0, y: 0, z: 0 })).toMatchObject({ ok: false, constraint: 'space' });
  });
  it('uses the full extent for bounds, including radius and sky', () => {
    expect(admit('open-water', ball(1), 2, flat, { x: 9.9, y: 10, z: 0 }, { bounds: { half: 10 } })).toMatchObject({ ok: false, constraint: 'bounds-x' });
    expect(admit('open-water', ball(1), 2, flat, { x: 8.9, y: 10, z: 0 }, { bounds: { half: 10 } }).ok).toBe(true);
    expect(admit('open-water', ball(1), 2, flat, { x: 0, y: 10, z: 0 }, { bounds: { half: 50, maxY: 10.5 } })).toMatchObject({ ok: false, constraint: 'bounds-y' });
  });
  it('lets a permit admit its media only inside its interval', () => {
    const permit = { id: 'b', startsAt: 0, expiresAt: 5, media: ['air' as const], landingRequired: true };
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }).ok).toBe(false);
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }, { time: 1, permit }).ok).toBe(true);
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }, { time: 5, permit }).ok).toBe(false);
  });
  it('checks a refuge touched only by a flank, with the actor for access', () => {
    // An exact provider for the half-space x > .5: a capsule touches it when its farthest point in +x passes .5.
    const half = (n: { x: number; z: number }, d: number) => (world: readonly Capsule[]) => world.some(c => Math.max(c.start.x * n.x + c.start.z * n.z, c.end.x * n.x + c.end.z * n.z) + c.radius > d) ? { id: 'cave', normal: { x: -n.x, y: 0, z: -n.z } } : null;
    const extras = (access: boolean) => ({ refugeOverlap: half({ x: 1, z: 0 }, .5), refugeAccess: () => access });
    expect(admit('open-water', ball(.6), 2, flat, { x: 0, y: 10, z: 0 }, {}, extras(false))).toMatchObject({ ok: false, constraint: 'refuge' });   // +x point at .6
    expect(admit('open-water', ball(.6), 2, flat, { x: 0, y: 10, z: 0 }, {}, extras(true)).ok).toBe(true);
    expect(admit('open-water', ball(.6), 2, flat, { x: -1, y: 10, z: 0 }, {}, extras(false)).ok).toBe(true);
    const diagonal = { refugeOverlap: half({ x: Math.SQRT1_2, z: Math.SQRT1_2 }, .8), refugeAccess: () => false };   // a sphere of radius 1 at the origin reaches projection 1 > .8
    expect(admit('open-water', ball(1), 2, flat, { x: 0, y: 10, z: 0 }, {}, diagonal)).toMatchObject({ ok: false, constraint: 'refuge', normal: { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } });
  });
  it('returns a tilted floor-gap normal on a slope, and an upward one for water entry', () => {
    const slope = T(x => .2 * x, .2), r = admit('seabed', ball(.3), 2, slope, { x: 0, y: 3, z: 0 });   // lowest 2.7 > 2.2 above the ground at 0
    expect(r.constraint).toBe('floor-gap'); expect(r.normal!.x).toBeCloseTo(.2 / Math.hypot(.2, 1)); expect(r.normal!.y).toBeCloseTo(-1 / Math.hypot(.2, 1));
    expect(admit('sp-air', ball(.3), 2, flat, { x: 0, y: 19.9, z: 0 })).toMatchObject({ ok: false, constraint: 'water', normal: { x: 0, y: 1, z: 0 } });   // bottom 19.6 is in the water
  });
  it('labels zones for the UI', () => {
    expect(zoneLabel(sampleEnvironment({ x: 0, y: 1, z: 0 }, flat), 2)).toBe('seabed'); expect(zoneLabel(sampleEnvironment({ x: 0, y: 10, z: 0 }, flat), 2)).toBe('deep');
    expect(zoneLabel(sampleEnvironment({ x: 40, y: 24.5, z: 0 }, island), 2)).toBe('land');
  });
});
