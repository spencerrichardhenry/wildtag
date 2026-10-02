// tests/tiny-tide-core/edge.test.ts — the soft world edge (owner playtest P2): an inward current near the hard bound.
import { describe, expect, it } from 'vitest';
import { EDGE_CURRENT_MAX, EDGE_REACH, EDGE_SOFT_START, edgeCurrent, inEdgeZone } from '../../src/tiny-tide/edge';
import { canApproachFood } from '../../src/tiny-tide/food-access';
import { stepPlayer } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { newRuntime, type Actor, type CombatRuntime, type Vec3 } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { PLANS, plan, type BodyPlan } from '../../src/tiny-tide/plans';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { PLAYER_HALF, SIZES, SPAWN_HALF, WATER_LEVEL, WORLD_HALF, spawnPoint, makeBiomes, random } from '../../src/tiny-tide/biomes';
import { STAGES } from '../../src/tiny-tide/state';
import { derive, effectiveStats, starterFor } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { tierSpecies } from '../../src/tiny-tide/species';

describe('edge current (pure)', () => {
  const half = 50, size = 4;
  it('is zero inside the soft start, on each axis', () => {
    for (const p of [{ x: 0, y: 0, z: 0 }, { x: 39.99, y: 5, z: -39.99 }, { x: -40, y: 0, z: 40 }]) expect(edgeCurrent(p, half, size)).toEqual({ x: 0, y: 0, z: 0 });
    expect(EDGE_SOFT_START).toBe(.8);
    expect(inEdgeZone({ x: 40, y: 0, z: 0 }, half)).toBe(false); expect(inEdgeZone({ x: 0, y: 0, z: -40.01 }, half)).toBe(true);
  });
  it('points to the centre, grows monotonically and reaches its maximum at the hard bound', () => {
    let last = 0;
    for (let x = 40; x <= 50 + 1e-9; x += .25) {
      const c = edgeCurrent({ x, y: 0, z: 0 }, half, size), m = -c.x;
      expect(c.y).toBe(0); expect(c.z).toBe(0); expect(m).toBeGreaterThanOrEqual(last); last = m;
      expect(edgeCurrent({ x: -x, y: 0, z: 0 }, half, size).x).toBeCloseTo(m, 12);   // symmetric, toward the centre
    }
    expect(last).toBeCloseTo(EDGE_CURRENT_MAX * size, 9);
    expect(-edgeCurrent({ x: 80, y: 0, z: 0 }, half, size).x).toBeCloseTo(EDGE_CURRENT_MAX * size, 9);   // clamped past the bound
    const corner = edgeCurrent({ x: 47, y: 0, z: -47 }, half, size); expect(corner.x).toBeLessThan(0); expect(corner.z).toBeGreaterThan(0); expect(corner.x).toBeCloseTo(-corner.z, 12);
  });
  it('is stronger than every top speed a creature can reach', () => {
    const fastest = Math.max(...STAGES.map(s => s.speed)) * 1.65 * Math.max(...['darter', 'swimmer', 'bulk', 'crawler', 'flyer', 'space'].map(id => movement(id).speedMultiplier));
    expect(EDGE_CURRENT_MAX).toBeGreaterThan(1.5 * fastest);
  });
});

describe('edge current in the player step (600 frames of full push)', () => {
  interface Body { p: BodyPlan; actor: Actor; stage: number; size: number; top: number; L: number }
  const body = (id: string, stage: number, speedFactor?: number, growth = 1.38): Body => {
    const p = plan(id)!, g = starterFor(p), actor = playerActor(p, g, stage, growth), size = SIZES[stage]!;   // default: the grown hull, the longest one
    return { p, actor, stage, size, top: STAGES[stage]!.speed * (speedFactor ?? derive(effectiveStats(g, p)).speedFactor), L: actor.bodyLength };
  };
  const run = (b: Body, dir: { x: number; z: number }, frames: number, start?: { p: Vec3; rt: CombatRuntime }, opts: { y?: number; breach?: boolean } = {}) => {
    const t = makeTerrain(b.stage), queries = makeWorldQueries(t), half = PLAYER_HALF * b.size, bounds = { half }, inner = { half: half - .5 * b.L };
    const rt = start?.rt ?? newRuntime({ yaw: Math.atan2(dir.x, dir.z), pitch: 0 }), caps = movementCapabilities(b.p);
    const s = .7 * half;
    let p: Vec3 = start?.p ?? { x: dir.x === 0 ? 0 : Math.sign(dir.x) * s, y: 0, z: dir.z === 0 ? 0 : Math.sign(dir.z) * s };
    if (!start) p = { ...p, y: opts.y ?? (caps.ground ? supportHeight(b.actor, p.x, p.z, rt.orientation, t) + .02 * b.L : (t.groundAt(p.x, p.z) + WATER_LEVEL) / 2) };
    const startY = p.y, startZone = queries.sampleEnvironment(p);
    const len = Math.hypot(dir.x, dir.z), wish = len > 0 ? { x: dir.x / len, y: 0, z: dir.z / len } : { x: 0, y: 0, z: 0 };
    let maxReach = 0, boundsContacts = 0, refused = 0, outsideInner = 0, breaches = 0;
    for (let f = 0; f < frames; f++) {
      const r = stepPlayer(p, rt, opts.breach ? { ...RELEASED, traversal: 'breach' } : RELEASED, { plan: b.p, profile: movement(b.p.movement), caps, actor: b.actor, queries, bounds, size: b.size, topSpeedLocal: b.top,
        now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
      if (r.needsRecovery) refused++; else p = r.position;
      if (r.breachStarted) breaches++;
      if (r.contacts.some(c => c.constraint.startsWith('bounds'))) boundsContacts++;
      if (!queries.overlapHull(b.actor, p, rt.orientation, { time: (f + 1) / 60, permit: rt.permit, bounds }).ok) refused++;
      const inside = queries.overlapHull(b.actor, p, rt.orientation, { time: (f + 1) / 60, permit: rt.permit, bounds: inner });
      if (!inside.ok && inside.constraint?.startsWith('bounds')) outsideInner++;
      maxReach = Math.max(maxReach, Math.abs(p.x), Math.abs(p.z));
    }
    return { p, rt, maxReach, boundsContacts, refused, outsideInner, half, breaches, startY, startZone };
  };
  const cases: [string, Body][] = [['Darter', body('darter', 2)], ['Darter at the top speed factor', body('darter', 2, 1.65)], ['Crawler', body('crawler', 1)], ['Swimmer', body('swimmer', 1)]];
  for (const [name, b] of cases) for (const [label, dir] of [['+x', { x: 1, z: 0 }], ['a corner', { x: 1, z: -1 }]] as const) {
    it(`keeps a ${name} pushing toward ${label} 0.5 L inside the hard bound, then drifts it inward on release`, () => {
      const r = run(b, dir, 600);
      expect(r.refused, 'refused poses').toBe(0); expect(r.boundsContacts, 'bounds contacts').toBe(0); expect(r.outsideInner, 'frames past the bound minus 0.5 L').toBe(0);
      expect(r.maxReach, 'entered the push zone').toBeGreaterThan(EDGE_SOFT_START * r.half);
      const before = Math.max(Math.abs(r.p.x), Math.abs(r.p.z)), after = run(b, { x: 0, z: 0 }, 120, { p: r.p, rt: r.rt });
      expect(after.refused).toBe(0);
      expect(Math.max(Math.abs(after.p.x), Math.abs(after.p.z)), 'drifts inward after release').toBeLessThan(before - .5 * b.L);
    });
  }
  it('keeps a Sky drifter flying in the air at stage 3 inside the hard bound (sky limit and edge together)', () => {
    const b = body('sky_drifter', 3), r = run(b, { x: 1, z: -1 }, 600, undefined, { y: WATER_LEVEL + 4 * b.L });
    expect(r.startY).toBe(WATER_LEVEL + 4 * b.L); expect(r.startZone.medium).toBe('air');
    expect(r.refused, 'refused poses').toBe(0); expect(r.boundsContacts, 'bounds contacts').toBe(0); expect(r.outsideInner).toBe(0);
    expect(r.maxReach).toBeGreaterThan(EDGE_SOFT_START * r.half);
    const after = run(b, { x: 0, z: 0 }, 120, { p: r.p, rt: r.rt });
    expect(after.refused).toBe(0); expect(Math.max(Math.abs(after.p.x), Math.abs(after.p.z))).toBeLessThan(r.maxReach - .5 * b.L);
  });
  it('keeps a Star swimmer in space at stage 4 inside the hard bound', () => {
    const b = body('star_swimmer', 4), r = run(b, { x: 1, z: 0 }, 600, undefined, { y: 0 });
    expect(r.startY).toBe(0); expect(r.startZone.medium).toBe('space');
    expect(r.refused).toBe(0); expect(r.boundsContacts).toBe(0); expect(r.outsideInner).toBe(0); expect(r.maxReach).toBeGreaterThan(EDGE_SOFT_START * r.half);
  });
  it('pushes a Darter back during Breach arcs at the edge', () => {
    // A starter-size hull: the grown Darter's hull does not fit at the arc's end depth (surface − 1.3 × size), so its landing
    // goes through recovery in the game (an existing limit of the arc, not of the edge).
    const b = body('darter', 2, undefined, 1), r = run(b, { x: 1, z: 0 }, 600, undefined, { y: WATER_LEVEL - 1.3 * b.size, breach: true });
    expect(r.startY).toBe(WATER_LEVEL - 1.3 * b.size); expect(r.startZone.medium).toBe('water');
    expect(r.breaches, 'Breach arcs started').toBeGreaterThanOrEqual(3);
    expect(r.refused, 'refused poses').toBe(0); expect(r.boundsContacts, 'bounds contacts').toBe(0); expect(r.outsideInner).toBe(0);
    expect(r.maxReach).toBeGreaterThan(EDGE_SOFT_START * r.half);
  });
});

describe('food near the edge (reach bound)', () => {
  it('keeps roaming inside the reach bound, which every creature can bite at', () => {
    expect(WORLD_HALF).toBeCloseTo(EDGE_REACH * PLAYER_HALF, 12);
    // The slowest possible top speed (lowest stage speed × speed-factor floor .7 × slowest plan multiplier) settles where
    // the current equals it; the smallest bite radius (radius × 1 + .5) must reach the reach bound from there.
    const slowest = Math.min(...STAGES.map(s => s.speed)) * .7 * Math.min(...PLANS.map(p => movement(p.movement).speedMultiplier));
    let u = 0; while (EDGE_CURRENT_MAX * u * u * (3 - 2 * u) < slowest) u += 1e-4;
    const settle = PLAYER_HALF * (EDGE_SOFT_START + (1 - EDGE_SOFT_START) * u), bite = Math.min(...STAGES.map(s => s.radius)) + .5;
    expect(settle + bite).toBeGreaterThanOrEqual(EDGE_REACH * PLAYER_HALF);
  });
  it('does not call food past the reach bound approachable', () => {
    const p = plan('swimmer')!, g = starterFor(p), stage = 1, size = SIZES[stage]!, actor = playerActor(p, g, stage, 1), terrain = makeTerrain(stage);
    const ctx = { queries: makeWorldQueries(terrain), bounds: { half: PLAYER_HALF * size } }, bite = { stage, growth: 1, reach: derive(effectiveStats(g, p)).reach };
    const at = (x: number) => canApproachFood(actor, 'swim', { x: x * size, y: 10 * size, z: 0, radius: 0 }, bite, ctx);
    expect(at(30)).toBe(true); expect(at(43.5)).toBe(true);
    expect(at(EDGE_REACH * PLAYER_HALF + .5)).toBe(false); expect(at(47)).toBe(false);
  });
});

describe('spawns stay out of the push zone', () => {
  it('places every spawn point inside the soft start', () => {
    expect(SPAWN_HALF).toBe(EDGE_SOFT_START * PLAYER_HALF);
    for (let tier = 0; tier < 4; tier++) {
      const size = SIZES[tier]!, biomes = makeBiomes(3, tier), rand = random(11 + tier);
      for (const spec of tierSpecies(tier)) for (let i = 0; i < 30; i++) {
        const q = spawnPoint(spec, biomes, rand);
        expect(Math.max(Math.abs(q.x), Math.abs(q.z)) / size).toBeLessThanOrEqual(SPAWN_HALF + 1e-9);
      }
    }
  });
});
