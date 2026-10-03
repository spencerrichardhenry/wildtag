// tests/tiny-tide-core/combat-shapes.test.ts
import { describe, expect, it } from 'vitest';
import { actionShapes, aimFrame, crossingOk, horizontalExtent, hurtboxesHit, hurtboxHit, nearestTargets, obstructionClear, pointInShape, shapeCentroid, sphereHitsShape, telegraphDescriptor, truncateCapsule, worldShape } from '../../src/tiny-tide/combat-shapes';
import { ATTACKS } from '../../src/tiny-tide/registries';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { solidOf, SolidIndex } from '../../src/tiny-tide/solids';
import type { Terrain, Vec3, WorldShape } from '../../src/tiny-tide/combat-types';

const O: Vec3 = { x: 0, y: 10, z: 0 }, Z: Vec3 = { x: 0, y: 0, z: 1 };
const DEG = Math.PI / 180;
const cone = (range: number, half: number): WorldShape => ({ kind: 'cone', apex: O, axis: Z, range, halfAngle: half * DEG });
const flat = (surface = 85): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });

describe('combat shapes', () => {
  it('sphere-cone hits at the edges', () => {
    const c = cone(1, 30);
    expect(sphereHitsShape({ x: 0, y: 10, z: 1.09 }, .1, c)).toBe(true);    // range + r = 1.1
    expect(sphereHitsShape({ x: 0, y: 10, z: 1.11 }, .1, c)).toBe(false);
    // At 45° off the axis, 1 away: the angle 45° ≤ 30° + asin(.3) = 47.5° hits; r = .2 gives 30° + 11.5° = 41.5° and misses.
    const p = { x: Math.SQRT1_2, y: 10, z: Math.SQRT1_2 };
    expect(sphereHitsShape(p, .3, c)).toBe(true); expect(sphereHitsShape(p, .2, c)).toBe(false);
    expect(sphereHitsShape({ x: 0, y: 10, z: -.05 }, .1, c)).toBe(true);   // contains the apex
    expect(sphereHitsShape({ x: 0, y: 10, z: -.5 }, .1, c)).toBe(false);   // behind
  });
  it('sphere-capsule hits', () => {
    const cap: WorldShape = { kind: 'capsule', start: O, end: { x: 0, y: 10, z: 2 }, radius: .3 };
    expect(sphereHitsShape({ x: .49, y: 10, z: 1 }, .2, cap)).toBe(true); expect(sphereHitsShape({ x: .51, y: 10, z: 1 }, .2, cap)).toBe(false);
    expect(sphereHitsShape({ x: 0, y: 10, z: 2.49 }, .2, cap)).toBe(true); expect(sphereHitsShape({ x: 0, y: 10, z: 2.51 }, .2, cap)).toBe(false);
    const sphere: WorldShape = { kind: 'capsule', start: O, end: O, radius: 1 };   // start = end is a sphere
    expect(sphereHitsShape({ x: 1.1, y: 10, z: 0 }, .2, sphere)).toBe(true); expect(sphereHitsShape({ x: 1.3, y: 10, z: 0 }, .2, sphere)).toBe(false);
    // A capsule hurtbox is tested as spheres; the hit point is on its axis, nearest the shape's axis.
    const body = { start: { x: -1, y: 10, z: .5 }, end: { x: 1, y: 10, z: .5 }, radius: .1 };
    expect(hurtboxHit(body, [cone(1, 30)])).toEqual({ x: 0, y: 10, z: .5 });
    expect(hurtboxHit({ ...body, start: { x: 3, y: 10, z: .5 }, end: { x: 5, y: 10, z: .5 } }, [cone(1, 30)])).toBeNull();
  });
  it('worldShape matches hand-worked numbers at a rotated, pitched pose with body length 4', () => {
    // aim (.6, .8, 0): frame z = aim, y = (-.8, .6, 0), x = y × z = (0, 0, -1).
    const aim = { x: .6, y: .8, z: 0 }, f = aimFrame(O, aim, Z);
    expect(f.z).toEqual(aim);
    expect(f.y.x).toBeCloseTo(-.8); expect(f.y.y).toBeCloseTo(.6); expect(f.y.z).toBeCloseTo(0);
    expect(f.x.x).toBeCloseTo(0); expect(f.x.y).toBeCloseTo(0); expect(f.x.z).toBeCloseTo(-1);
    const cone = worldShape({ kind: 'cone', range: .5, halfAngle: .4 }, f, 4);
    expect(cone).toMatchObject({ kind: 'cone', range: 2, halfAngle: .4, apex: O });
    if (cone.kind === 'cone') { expect(cone.axis.x).toBeCloseTo(.6); expect(cone.axis.y).toBeCloseTo(.8); expect(cone.axis.z).toBeCloseTo(0); }
    // local (.5, .25, 1) → 4 × (.5 x + .25 y + z) = 4 × (0 - .2 + .6, 0 + .15 + .8, -.5 + 0) = (1.6, 3.8, -2), plus O.
    const cap = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: .25 }, end: { x: .5, y: .25, z: 1 }, radius: .1 }, f, 4);
    if (cap.kind !== 'capsule') throw new Error('capsule');
    expect(cap.start.x).toBeCloseTo(.6); expect(cap.start.y).toBeCloseTo(10.8); expect(cap.start.z).toBeCloseTo(0);
    expect(cap.end.x).toBeCloseTo(1.6); expect(cap.end.y).toBeCloseTo(13.8); expect(cap.end.z).toBeCloseTo(-2);
    expect(cap.radius).toBeCloseTo(.4);
  });
  it('classifies points just inside and just outside a pitched cone and capsule', () => {
    const aim = { x: .6, y: .8, z: 0 }, f = aimFrame(O, aim, Z);
    const cone = worldShape({ kind: 'cone', range: .5, halfAngle: .4 }, f, 4);   // range 2
    const at = (angle: number, dist: number): Vec3 => {   // rotate from the axis toward (0, 0, 1), which is perpendicular to the axis
      const c = Math.cos(angle), s = Math.sin(angle);
      return { x: O.x + dist * c * .6, y: O.y + dist * c * .8, z: O.z + dist * s };
    };
    const eps = 1e-3;
    expect(pointInShape(at(.4 - eps, 1.5), cone)).toBe(true);
    expect(pointInShape(at(.4 + eps, 1.5), cone)).toBe(false);
    expect(pointInShape(at(-(.4 - eps), 1.5), cone)).toBe(true);
    expect(pointInShape(at(-(.4 + eps), 1.5), cone)).toBe(false);
    expect(pointInShape(at(0, 2 - eps), cone)).toBe(true);
    expect(pointInShape(at(0, 2 + eps), cone)).toBe(false);
    expect(pointInShape(at(Math.PI, 1), cone)).toBe(false);   // directly behind
    // A sphere widens the cone angle by asin(r / d): d = 1.5, r = .15 adds asin(.1).
    const widen = Math.asin(.1);
    expect(sphereHitsShape(at(.4 + widen - eps, 1.5), .15, cone)).toBe(true);
    expect(sphereHitsShape(at(.4 + widen + eps, 1.5), .15, cone)).toBe(false);
    // Capsule from (.6,10.8,0) to (1.6,13.8,-2), radius .4. The axis (1,3,-2) is perpendicular to n = (3,-1,0)/√10.
    const cap = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: .25 }, end: { x: .5, y: .25, z: 1 }, radius: .1 }, f, 4);
    const mid = { x: 1.1, y: 12.3, z: -1 }, n = { x: 3 / Math.sqrt(10), y: -1 / Math.sqrt(10), z: 0 };
    const off = (d: number): Vec3 => ({ x: mid.x + n.x * d, y: mid.y + n.y * d, z: mid.z });
    expect(pointInShape(off(.4 - eps), cap)).toBe(true); expect(pointInShape(off(.4 + eps), cap)).toBe(false);
    expect(pointInShape(off(-(.4 - eps)), cap)).toBe(true); expect(pointInShape(off(-(.4 + eps)), cap)).toBe(false);
    const ax = { x: 1 / Math.sqrt(14), y: 3 / Math.sqrt(14), z: -2 / Math.sqrt(14) };
    const beyond = (d: number): Vec3 => ({ x: 1.6 + ax.x * d, y: 13.8 + ax.y * d, z: -2 + ax.z * d });
    expect(pointInShape(beyond(.4 - eps), cap)).toBe(true); expect(pointInShape(beyond(.4 + eps), cap)).toBe(false);
    expect(pointInShape(beyond(-.2), cap)).toBe(true);
  });
  it('hit volume stays inside the locked telegraph (lunge truncated by a wall)', () => {
    // A lunge capsule (0,0,0)–(0,0,1.4) r .22 with lunge 1.2 (the crab's), L = 5.6; the attacker stopped after .5 L.
    const L = 5.6, f = aimFrame(O, Z, Z), locked = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1.4 }, radius: .22 }, f, L);
    if (locked.kind !== 'capsule') throw new Error('capsule');
    const hit = truncateCapsule(locked, 1.4, 1.2, .5);
    if (hit.kind !== 'capsule') throw new Error('capsule');
    expect(hit.end.z).toBeCloseTo(O.z + .7 * L);   // 1.4 − 1.2 + .5 = .7 L
    for (let i = 0; i <= 40; i++) for (const off of [-.2, 0, .2]) {
      const p = { x: off * L * .22, y: 10, z: hit.start.z + (hit.end.z - hit.start.z) * i / 40 };
      if (pointInShape(p, hit)) expect(pointInShape(p, locked)).toBe(true);
    }
    expect(truncateCapsule(locked, 1.4, 1.2, 1.2)).toEqual(locked);   // the whole lunge: the whole capsule
  });
  it('units are attacker body lengths', () => {
    const f = aimFrame(O, Z, Z);
    expect(worldShape({ kind: 'cone', range: .6, halfAngle: .5 }, f, 1)).toMatchObject({ range: .6 });
    expect(worldShape({ kind: 'cone', range: .6, halfAngle: .5 }, f, 4)).toMatchObject({ range: 2.4, halfAngle: .5 });
    const cap = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: .1 }, end: { x: 0, y: 0, z: .75 }, radius: .12 }, f, 10);
    expect(cap).toMatchObject({ radius: 1.2 }); if (cap.kind === 'capsule') { expect(cap.start.z).toBeCloseTo(1); expect(cap.end.z).toBeCloseTo(7.5); }
    // The frame: z = aim, y = up made orthogonal; a vertical aim uses the body forward.
    const up = aimFrame(O, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(up.y.x).toBeCloseTo(1); expect(up.z.y).toBeCloseTo(1);
  });
  it('obstruction by terrain and by a reef solid', () => {
    const rock = solidOf('r1', 'rock', [{ kind: 'ellipsoid', x: 0, y: 5, z: 5, a: 1, b: 1, c: 1, yaw: 0 }]);
    const q = makeWorldQueries(flat(), { solids: new SolidIndex([rock], 8) }), plain = makeWorldQueries(flat());
    expect(obstructionClear(q, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);    // through the rock
    expect(obstructionClear(q, { x: 0, y: 5, z: 0 }, { x: 3, y: 5, z: 10 }, 1)).toBe(true);     // beside it
    expect(obstructionClear(plain, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(true);
    const hill = makeWorldQueries({ ...flat(), groundAt: (_x, z) => z > 4 && z < 6 ? 8 : 0 });
    expect(obstructionClear(hill, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);   // under the ridge
    const noSegment = { ...hill, segmentClear: undefined };
    expect(obstructionClear(noSegment, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);   // terrain-only fallback
  });
  it('crossing same-medium', () => {
    const q = makeWorldQueries(flat(10));
    expect(crossingOk('same-medium', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 8, z: 0 }, 1)).toBe(true);
    expect(crossingOk('same-medium', q, { x: 0, y: 9.5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(false);   // water to air
    expect(crossingOk('water-surface', q, { x: 0, y: 9.5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(true);
    expect(crossingOk('water-surface', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(false);
    expect(crossingOk('any-medium', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 50, z: 0 }, 1)).toBe(true);
    for (const a of Object.values(ATTACKS)) expect(a.crossing, a.id).toBe('same-medium');
  });
  it('maxTargets nearest first', () => {
    expect(nearestTargets([{ id: 'e3', distance: 2 }, { id: 'e1', distance: 1 }, { id: 'e2', distance: 1 }, { id: 'e0', distance: 5 }], 2).map(t => t.id)).toEqual(['e1', 'e2']);
  });
  it('mirrored pair shape is the union with one hit group', () => {
    // Two pinch origins 1 apart; a target in front of the second copy only is still hit by the action.
    const shapes = actionShapes({ kind: 'cone', range: .5, halfAngle: .3 }, [O, { x: 2, y: 10, z: 0 }], Z, Z, 1);
    expect(shapes).toHaveLength(2);
    const target = [{ start: { x: 2, y: 10, z: .4 }, end: { x: 2, y: 10, z: .4 }, radius: .05 }];
    expect(hurtboxesHit(target, shapes)).not.toBeNull(); expect(hurtboxesHit(target, shapes.slice(0, 1))).toBeNull();
  });
  it('gives the depth ring a centroid and a horizontal extent', () => {
    expect(shapeCentroid(cone(2, 30))).toEqual({ x: 0, y: 10, z: 1 });
    expect(horizontalExtent({ kind: 'capsule', start: O, end: { x: 0, y: 10, z: 2 }, radius: .5 })).toBeCloseTo(1.5);
    expect(horizontalExtent(cone(2, 30))).toBeCloseTo(Math.hypot(1, 2 * Math.cos(30 * DEG) - 1));   // a rim point (x 1, z 1.73) is farthest from (0, 1)
  });
  it('telegraph descriptor carries the shapes, a clamped fill and the ring from independent numbers', () => {
    const cap: WorldShape = { kind: 'capsule', start: { x: 0, y: 10, z: 0 }, end: { x: 0, y: 10, z: 4 }, radius: .5 };
    const d = telegraphDescriptor([cap], 1.7, 'red', 'stripes', true, (x, z) => 2 + x + z);
    expect(d.shapes).toEqual([cap]); expect(d.fill).toBe(1);
    expect(d.centroid).toEqual({ x: 0, y: 10, z: 2 });
    expect(d.ringRadius).toBeCloseTo(2.5);    // 2 from the centroid to an end, plus the radius
    expect(d.groundY).toBe(4);                // 2 + 0 + 2
    expect(d).toMatchObject({ color: 'red', pattern: 'stripes', locked: true });
    expect(telegraphDescriptor([cap], -1, 'amber', 'solid', false, () => 0).fill).toBe(0);
  });
});
