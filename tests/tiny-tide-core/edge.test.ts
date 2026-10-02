// tests/tiny-tide-core/edge.test.ts — the soft world edge (owner playtest P2): an inward current near the hard bound.
import { describe, expect, it } from 'vitest';
import { EDGE_CURRENT_MAX, EDGE_SOFT_START, edgeCurrent, inEdgeZone } from '../../src/tiny-tide/edge';
import { stepPlayer } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { newRuntime, type Actor, type CombatRuntime, type Vec3 } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { plan, type BodyPlan } from '../../src/tiny-tide/plans';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { PLAYER_HALF, SIZES, SPAWN_HALF, WATER_LEVEL, spawnPoint, makeBiomes, random } from '../../src/tiny-tide/biomes';
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
  const body = (id: string, stage: number, speedFactor?: number): Body => {
    const p = plan(id)!, g = starterFor(p), actor = playerActor(p, g, stage, 1.38), size = SIZES[stage]!;   // the grown hull: the longest one
    return { p, actor, stage, size, top: STAGES[stage]!.speed * (speedFactor ?? derive(effectiveStats(g, p)).speedFactor), L: actor.bodyLength };
  };
  const run = (b: Body, dir: { x: number; z: number }, frames: number, start?: { p: Vec3; rt: CombatRuntime }) => {
    const t = makeTerrain(b.stage), queries = makeWorldQueries(t), half = PLAYER_HALF * b.size, bounds = { half }, inner = { half: half - .5 * b.L };
    const rt = start?.rt ?? newRuntime({ yaw: Math.atan2(dir.x, dir.z), pitch: 0 }), caps = movementCapabilities(b.p);
    const s = .7 * half;
    let p: Vec3 = start?.p ?? { x: dir.x === 0 ? 0 : Math.sign(dir.x) * s, y: 0, z: dir.z === 0 ? 0 : Math.sign(dir.z) * s };
    if (!start) p = { ...p, y: caps.ground ? supportHeight(b.actor, p.x, p.z, rt.orientation, t) + .02 * b.L : (t.groundAt(p.x, p.z) + WATER_LEVEL) / 2 };
    const len = Math.hypot(dir.x, dir.z), wish = len > 0 ? { x: dir.x / len, y: 0, z: dir.z / len } : { x: 0, y: 0, z: 0 };
    let maxReach = 0, boundsContacts = 0, refused = 0, outsideInner = 0;
    for (let f = 0; f < frames; f++) {
      const r = stepPlayer(p, rt, RELEASED, { plan: b.p, profile: movement(b.p.movement), caps, actor: b.actor, queries, bounds, size: b.size, topSpeedLocal: b.top,
        now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
      if (r.needsRecovery) refused++; else p = r.position;
      if (r.contacts.some(c => c.constraint.startsWith('bounds'))) boundsContacts++;
      if (!queries.overlapHull(b.actor, p, rt.orientation, { time: (f + 1) / 60, bounds }).ok) refused++;
      const inside = queries.overlapHull(b.actor, p, rt.orientation, { time: (f + 1) / 60, bounds: inner });
      if (!inside.ok && inside.constraint?.startsWith('bounds')) outsideInner++;
      maxReach = Math.max(maxReach, Math.abs(p.x), Math.abs(p.z));
    }
    return { p, rt, maxReach, boundsContacts, refused, outsideInner, half };
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
