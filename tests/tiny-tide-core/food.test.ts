// tests/tiny-tide-core/food.test.ts
import { describe, expect, it } from 'vitest';
import { canApproachFood, reachableFoodDna } from '../../src/tiny-tide/food-access';
import { playerActor } from '../../src/tiny-tide/mount';
import { makeTerrain, makeWorldQueries, stageBounds } from '../../src/tiny-tide/world-queries';
import { breachPermit, habitat } from '../../src/tiny-tide/profiles';
import { eligibleChildren, plan, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { starterFor } from '../../src/tiny-tide/genome';
import { STAGES } from '../../src/tiny-tide/state';
import { PLAYER_HALF, populate, SIZES, WATER_LEVEL } from '../../src/tiny-tide/biomes';
import type { Actor, Terrain } from '../../src/tiny-tide/combat-types';

const visible = () => { const out: string[] = []; const walk = (path: string[]) => { out.push(path.at(-1)!); for (const c of eligibleChildren(path, { coast: false })) walk([...path, c.id]); }; walk([ROOT_PLAN]); return [...new Set(out)]; };
const dietsOf = (size: number) => size >= 3 ? (['herbivore'] as const) : (['herbivore', 'carnivore', 'omnivore'] as const);
const sea = (stage: number) => ({ queries: makeWorldQueries(makeTerrain(stage)) });

describe('one source for the stage bounds (final review M7)', () => {
  it('stageBounds holds the hard bound of every stage and the sky cap from stage 3', () => {
    SIZES.forEach((size, stage) => expect(stageBounds(stage)).toEqual({ half: PLAYER_HALF * size, maxY: stage >= 3 ? 30 * size : undefined }));
  });
  it('food above the sky cap is not approachable with the stage bounds', () => {
    const p = plan('sky_drifter')!, actor = playerActor(p, starterFor(p), 3, 1), q = makeWorldQueries(makeTerrain(3)), food = { x: 0, y: 30 * 64 + 400, z: 0, radius: 0 }, bite = { stage: 3, growth: 1, reach: 0 };
    expect(canApproachFood(actor, 'fly', food, bite, { queries: q, bounds: { half: stageBounds(3).half } })).toBe(true);
    expect(canApproachFood(actor, 'fly', food, bite, { queries: q, bounds: stageBounds(3) })).toBe(false);
  });
});
describe('food approach', () => {
  it('lets a wading Colossus reach the first seed-1 boat', () => {
    const p = plan('colossus')!, boat = populate(1).find(s => s.spec.key === '3:boat')!;
    expect(canApproachFood(playerActor(p, starterFor(p), 3, 1), 'ground', { ...boat, radius: 0 }, { stage: 3, growth: 1, reach: 0 }, sea(3))).toBe(true);
  });
  it('does not let a Shellback reach a gull', () => {
    const p = plan('shellback')!, gull = populate(1).find(s => s.spec.key === '2:bird')!;
    expect(canApproachFood(playerActor(p, starterFor(p), 2, 1), 'ground', { ...gull, radius: 0 }, { stage: 2, growth: 1, reach: 0 }, sea(2))).toBe(false);
  });
  it('does not count hovering food for a grounded body that cannot rise to it', () => {
    const flat: Terrain = { groundAt: () => 0, surface: 85, space: false, slopeBound: 0 }, q = { queries: makeWorldQueries(flat) };
    const a: Actor = { id: 'p', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 2.5 }], habitat: habitat('seabed'), bodyLength: 10 };
    const food = { x: 0, y: 18, z: 0, radius: 0 }, bite = { stage: 1, growth: 1, reach: 0 };
    expect(canApproachFood(a, 'ground', food, bite, q)).toBe(false);   // support 2.5 + .1: |2.6 − 18| = 15.4 > V = 2.2 × 4 = 8.8
    expect(canApproachFood(a, 'swim', food, bite, q)).toBe(true);      // 18 − .9 × 8.8 = 10.08; lowest 7.58 ≤ 1.1 × 10
  });
  it('separates an active Breach from a hypothetical one, and respects the permit times', () => {
    const p = plan('darter')!, a = playerActor(p, starterFor(p), 2, 1), gull = { x: 0, y: WATER_LEVEL + 36, z: 0, radius: 0 }, bite = { stage: 2, growth: 1, reach: 0 };
    expect(canApproachFood(a, 'swim', gull, bite, sea(2))).toBe(false);
    expect(canApproachFood(a, 'swim', gull, bite, { ...sea(2), traversal: { kind: 'hypothetical-breach', now: 0 } })).toBe(true);
    const permit = breachPermit(10);
    for (const [now, ok] of [[9.9, false], [10, true], [11.89, true], [11.9, false]] as const) expect(canApproachFood(a, 'swim', gull, bite, { ...sea(2), traversal: { kind: 'active', permit, now } }), `${now}`).toBe(ok);
  });
  it('gives every visible plan and diet a peaceful food supply worth more than its goal, on three seeds', () => {
    for (const id of visible()) { const p = plan(id)!; if (p.size === 4) continue;
      for (const diet of dietsOf(p.size)) for (const seed of [1, 2, 3]) expect(reachableFoodDna(p, diet, seed, { peacefulOnly: true }), `${id} ${diet} ${seed}`).toBeGreaterThan(STAGES[p.size]!.goal);
    }
  });
});
