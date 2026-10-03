import { describe, expect, it } from 'vitest';
import { Ecosystem, engage, HUNTER_MARGIN, provoke, speciesActor, type Entity, type EntityMotion } from '../../src/tiny-tide/ecosystem';
import { HAZARDS } from '../../src/tiny-tide/registries';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { habitat } from '../../src/tiny-tide/profiles';
import { SIZES, SPAWN_HALF, WATER_LEVEL, WORLD_HALF } from '../../src/tiny-tide/biomes';
import { FOOD_MODEL_KINDS, SPECIES } from '../../src/tiny-tide/species';
import type { Terrain, Vec3 } from '../../src/tiny-tide/combat-types';

const hullAt = (p: Vec3, r = .6) => [{ start: p, end: p, radius: r }];
const ctx = (player: Vec3, now: number, extra: { stage?: number; playerHull?: ReturnType<typeof hullAt>; perceivable?: boolean } = {}) =>
  ({ stage: 0, dt: .1, now, player, playerHull: hullAt(player), perceivable: true, stealthFactor: 1, unlocked: [] as string[], ...extra });
/** The crab nearest the centre: a stage 0 player (bound ±50, push zone past 40) can meet it, and hunters do not chase into the push
 *  zone (owner ruling M11). */
const crabOf = (eco: Ecosystem) => eco.entities.filter(e => e.spec.key === '1:crab' && !e.eaten).sort((a, b) => Math.max(Math.abs(a.x), Math.abs(a.z)) - Math.max(Math.abs(b.x), Math.abs(b.z)))[0]!;
const at = (e: Entity, dx: number, dy: number, dz = 0) => ({ x: e.x + dx, y: e.y + dy, z: e.z + dz });
const tick = (t: number) => Math.round(t * 10) / 10;
const legal = (e: Entity) => makeWorldQueries(makeTerrain(e.spec.tier === 4 ? 4 : 0))
  .overlapHull(speciesActor(e), { x: e.x, y: e.y, z: e.z }, { yaw: 0, pitch: 0 }, { time: 0, bounds: { half: WORLD_HALF * SIZES[e.spec.tier]! } }).ok;
const legalAll = (eco: Ecosystem) => eco.entities.filter(e => !e.eaten && !habitat(e.spec.habitatProfileId).isStaticProp).every(legal);
const flatSea: Terrain = { groundAt: () => 0, surface: WATER_LEVEL, space: false, slopeBound: 0 };

describe('species installation', () => {
  it('installs every species legally with its full population on four seeds, keeping balloons up and boats afloat', () => {
    for (const seed of [1, 2, 3, 7]) {
      const eco = new Ecosystem(seed); expect(eco.installFailures, `seed ${seed}`).toBe(0); expect(legalAll(eco)).toBe(true);
      for (const s of SPECIES) expect(eco.entities.filter(e => e.spec === s && !e.eaten).length, `${seed} ${s.key}`).toBe(s.count);
      for (const b of eco.entities.filter(e => e.spec.key === '3:balloon')) expect(b.y).toBeGreaterThan(WATER_LEVEL + 100);
      for (const b of eco.entities.filter(e => e.spec.key === '3:boat')) { expect(b.y).toBeGreaterThan(WATER_LEVEL - 10); expect(b.y).toBeLessThan(WATER_LEVEL + 10); }
    }
  });
  it('re-installs on reset to the same legal poses as construction', () => {
    const eco = new Ecosystem(7), installed = eco.entities.map(e => [e.x, e.y, e.z]);
    for (const e of eco.entities) e.y -= 500; eco.reset([]);
    expect(eco.entities.map(e => [e.x, e.y, e.z])).toEqual(installed); expect(legalAll(eco)).toBe(true);
  });
  it('keeps a planet that failed to install eaten after reset', () => {
    const reject = (tier: number) => { const q = makeWorldQueries(makeTerrain(tier)); return tier === 4 ? { ...q, overlapHull: () => ({ ok: false, constraint: 'space' as const, point: null, normal: null }) } : q; };
    const eco = new Ecosystem(7, { queries: reject }), planets = () => eco.entities.filter(e => e.spec.kind === 'planet');
    expect(planets().every(e => e.eaten)).toBe(true); expect(eco.installFailures).toBe(12);
    eco.reset([0]); expect(planets().every(e => e.eaten)).toBe(true);
  });
  it('re-installs an entity when its tier becomes relevant', () => {
    const eco = new Ecosystem(7), squid = eco.entities.find(e => e.spec.key === '2:squid')!, far = { x: 0, y: 900, z: 0 };
    eco.step(ctx(far, 0, { stage: 4 })); squid.y = -400; eco.step(ctx(far, .1, { stage: 4 })); expect(squid.y).toBeLessThan(-300);   // inactive: unchecked
    eco.step(ctx(far, .2, { stage: 2 })); expect(squid.eaten || legal(squid)).toBe(true);
  });
});
// T16: the player point is 1.4 above the crab's origin (its hull centre height): acquisition needs a line of sight (review I9), and a
// point at the crab's ground level 6 units away can be under the seabed.
describe('pursuit', () => {
  it('giveUpAll (D27): every hunter of the player returns and acquires nothing inside the window', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), p = at(crab, 6, 1.4); eco.step(ctx(p, 0)); expect(crab.mode).toBe('hunt');   // without a give-up it hunts on
    expect(eco.givingUp(0)).toBe(false);
    eco.giveUpAll(.1, 6); expect(crab.mode).toBe('return'); expect(eco.givingUp(.1)).toBe(true); expect(eco.givingUp(6.1)).toBe(false);
    let again = -1;
    for (let t = .2; t < 9; t = tick(t + .1)) { eco.step(ctx(p, t)); if (crab.mode === 'hunt' && again < 0) again = t; }
    expect(again).toBeGreaterThanOrEqual(6.1); expect(again).toBeLessThan(9);   // the same player point, perceived again after the window
    eco.reset([]); expect(eco.givingUp(.2)).toBe(false);
  });
  it('keeps hunting through a one-frame escape', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), home = at(crab, 0, 0);
    eco.step(ctx(at(crab, 6, 1.4), 0)); expect(crab.mode).toBe('hunt');
    eco.step(ctx({ x: home.x + 6, y: home.y + 60, z: home.z }, .1)); expect(crab.mode).toBe('hunt');   // 60.3 < give-up 12 × 5.6 = 67.2
    eco.step(ctx(at(crab, 6, 1.4), .2)); expect(crab.mode).toBe('hunt');
  });
  it('gives up after its memory on a sustained escape and does not re-hunt inside the reacquire window', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco); eco.step(ctx(at(crab, 6, 1.4), 0));
    let returnedAt = -1;
    for (let t = .1; t <= 6.1; t = tick(t + .1)) { eco.step(ctx(at(crab, 6, 60), t)); if (crab.mode !== 'hunt' && returnedAt < 0) returnedAt = t; }
    expect(returnedAt).toBe(6.1);   // last seen at 0; memory 6; strict >
    eco.step(ctx(at(crab, 3, 1.4), 6.2)); expect(crab.mode).not.toBe('hunt');   // returnUntil = 8.1, even if it is already calm at home
    eco.step(ctx(at(crab, 3, 1.4), 8.2)); expect(crab.mode).toBe('hunt');
  });
  it('goes to the last seen point when the target hides, then gives up', () => {
    // Seed 4: its central crab (x −21) keeps both sightings inside the stage 0 soft start (seed 7's nearest crab is at x −38.4).
    let visible = true; const eco = new Ecosystem(4, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => visible ? 1 : 0 }) });
    const crab = crabOf(eco), start = at(crab, 0, 0); eco.step(ctx(at(crab, 6, 0), 0)); visible = false;
    for (let t = .1; t <= 1; t = tick(t + .1)) eco.step(ctx({ x: start.x - 6, y: start.y, z: start.z }, t));
    expect(crab.mode).toBe('hunt'); expect(crab.x).toBeGreaterThan(start.x);   // toward the old sighting (east), not the hidden player (west)
    for (let t = 1.1; t <= 6.1; t = tick(t + .1)) eco.step(ctx({ x: start.x - 6, y: start.y, z: start.z }, t));
    expect(crab.mode).toBe('return');
  });
  it('gives up on a visible but unreachable target after wait plus memory', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), above = { x: crab.x, y: g + 9.5, z: crab.z };   // floor gap 9.5 > 1.6 × 5.6 = 8.96
    eco.step(ctx(above, 0)); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(above, t)); expect(crab.mode).toBe('hunt');
    eco.step(ctx(above, 9.1)); expect(crab.mode).toBe('return');   // blocked since 0; 3 + 6 = 9; strict >
  });
  it('gives up on a target hovering inside its habitat but out of a grounded reach', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), hover = { x: crab.x, y: g + 8.5, z: crab.z };   // 8.5 ≤ 8.96 is admitted, but 8.5 − (support offset) > 3.4
    eco.step(ctx(hover, 0)); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(hover, t)); expect(crab.mode).toBe('hunt');
    eco.step(ctx(hover, 9.1)); expect(crab.mode).toBe('return');
  });
  it('tests touch against the remembered body, not a sphere at its root', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z);
    const root = { x: crab.x, y: g + 4.5, z: crab.z }, lifted = [{ start: { x: root.x, y: root.y + 2, z: root.z - 1 }, end: { x: root.x, y: root.y + 2, z: root.z + 1 }, radius: 2 }];
    eco.step(ctx(root, 0, { playerHull: lifted })); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);   // axis ≈ 6.5 − offset > 2.8 + 2, though the root is within 4.8
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(root, t, { playerHull: lifted }));
    eco.step(ctx(root, 9.1, { playerHull: lifted })); expect(crab.mode).toBe('return');
    const eco2 = new Ecosystem(7), crab2 = crabOf(eco2), high = { x: crab2.x, y: g + 6, z: crab2.z };
    const reaching = [{ start: high, end: { x: crab2.x, y: g + .5, z: crab2.z + .5 }, radius: .6 }];   // pitched down to the crab
    eco2.step(ctx(high, 0, { playerHull: reaching })); expect(crab2.reachable).toBe(true);
  });
  it('keeps the blocked timer through border jitter and gives up after the finite wait', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), gap = (h: number) => ({ x: crab.x, y: g + h, z: crab.z });
    eco.step(ctx(gap(2), 0)); expect(crab.reachable).toBe(true); expect(crab.blockedSince).toBeNull();   // within touch: 2 − offset ≤ 2.8 + .6
    let t = .1; for (; t <= 9.1; t = tick(t + .1)) { eco.step(ctx(gap(Math.round(t * 10) % 2 ? 5 : 2), t)); expect(crab.blockedSince).toBe(.1); }   // 5 is out of touch; 2 is in touch for only .1 s
    expect(crab.mode).toBe('hunt'); eco.step(ctx(gap(5), 9.2)); expect(crab.mode).toBe('return');   // 9.2 − .1 > 3 + 6
  });
  it('starts a new hunt with a fresh blocked timer', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco);
    const above = () => ({ x: crab.x, y: makeTerrain(0).groundAt(crab.x, crab.z) + 9.5, z: crab.z });
    eco.step(ctx(above(), 0)); expect(crab.reachable).toBe(false);
    for (let t = .1; t <= 9.1; t = tick(t + .1)) eco.step(ctx(above(), t)); expect(crab.mode).toBe('return');   // first hunt ends while blocked
    for (let t = 9.2; t <= 11.9; t = tick(t + .1)) eco.step(ctx(above(), t, { perceivable: false }));
    eco.step(ctx(above(), 12)); expect(crab.mode).toBe('hunt'); expect(crab.blockedSince).toBe(12);
    for (let t = 12.1; t <= 21; t = tick(t + .1)) { eco.step(ctx(above(), t)); expect(crab.mode).toBe('hunt'); }
    eco.step(ctx(above(), 21.1)); expect(crab.mode).toBe('return');   // 21.1 − 12 > 3 + 6
  });
  it('clears the blocked timer after one second of reachability', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), gap = (h: number) => ({ x: crab.x, y: g + h, z: crab.z });
    eco.step(ctx(gap(2), 0)); eco.step(ctx(gap(5), .1)); expect(crab.blockedSince).toBe(.1);
    for (let t = .2; t <= 1.1; t = tick(t + .1)) eco.step(ctx(gap(2), t)); expect(crab.blockedSince).not.toBeNull();   // reachable since .2: .9 s so far
    eco.step(ctx(gap(2), 1.3)); expect(crab.blockedSince).toBeNull();                                                   // 1.1 s ≥ 1
  });
  it('lets the leash win while the player is still seen', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco); eco.step(ctx(at(crab, 6, 1.4), 0)); crab.hx = crab.x - 200;   // 200 > 30 × 5.6 = 168
    eco.step(ctx(at(crab, 6, 1.4), .1)); expect(crab.mode).toBe('return');
  });
  it('perceives with visibility and the perceivable flag, independent of damage', () => {
    const hidden = new Ecosystem(9, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), a = crabOf(hidden);
    hidden.step(ctx(at(a, 5, 0), 0)); expect(a.mode).toBe('calm');
    const eco = new Ecosystem(9), b = crabOf(eco); eco.step(ctx(at(b, 5, 0), 0, { perceivable: false })); expect(b.mode).toBe('calm');
  });
});
describe('provocation and hazards', () => {
  it('lets a provoked ray retaliate against a bigger stage-3 player it cannot see', () => {
    // The ray stings stages 1 and 2 only; at stage 3 only its provoked (angry) mode makes it sting (the crab has no hazard since sub-project 3a).
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
    eco.step(ctx({ x: 0, y: 900, z: 0 }, 0, { stage: 3, perceivable: false, playerHull: [] }));   // the ray becomes active and is installed
    const p = at(ray, 0, 0);
    expect(eco.step(ctx(p, .05, { stage: 3 })).filter(e => e.entity === ray)).toEqual([]);
    provoke(ray, p, .1); expect(ray.mode).toBe('angry'); expect(ray.lastKnown).toEqual(p);
    const events = eco.step(ctx(p, .1, { stage: 3 })).filter(e => e.entity === ray); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(2);   // 2 + 2 × max(0, 2 − 3)
  });
  it('lets a provoked ray retaliate with its own policy and forget a hidden player', () => {
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
    provoke(ray, at(ray, 10, 0), 0); expect(ray.mode).toBe('angry');
    for (let t = .1; t <= 4; t = tick(t + .1)) eco.step(ctx(at(ray, 10, 0), t, { stage: 2 })); expect(ray.mode).toBe('angry');
    eco.step(ctx(at(ray, 10, 0), 4.1, { stage: 2 })); expect(ray.mode).toBe('return');   // retaliate memory 4
  });
  it('emits a hazard at t = 0 and the next only after the cadence, from the translated hull', () => {
    // The ray stings stage 2 on contact (calm, not engaged).
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(tier === 4 ? makeTerrain(4) : flatSea) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!, events: ReturnType<Ecosystem['step']> = [];
    eco.step(ctx({ x: 0, y: 500, z: 0 }, 0, { stage: 2, perceivable: false, playerHull: [] }));   // settle onto the flat ground first
    for (let i = 0; i <= 18; i++) events.push(...eco.step(ctx(at(ray, 0, 0), i / 10, { stage: 2, perceivable: false })).filter(e => e.entity === ray));   // the player point follows the grazing ray
    expect(events.map(e => e.time)).toEqual([0, 1.8]); expect(events[0]!.damage).toBe(2);   // ray-sting: 2 half-hearts, every 1.8 s
  });
  it('emits nothing when the hull is far away, even while the player point is seen', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), events: ReturnType<Ecosystem['step']> = [];
    for (let i = 0; i <= 14; i++) events.push(...eco.step(ctx(at(crab, 0, 0), i / 10, { playerHull: hullAt(at(crab, 100, 0)) })).filter(e => e.entity === crab));
    expect(events).toEqual([]); expect(crab.mode).toBe('hunt');
  });
});

describe('hunters and the world edge (owner ruling M11)', () => {
  it('hunters roam inside SPAWN_HALF + HUNTER_MARGIN, even when chasing a player at the edge of their bound', () => {
    for (const seed of [1, 2, 3]) {
      const eco = new Ecosystem(seed);
      for (const stage of [0, 1, 2]) {
        // The player sits just inside its soft start, beyond each hunter: they chase it toward the edge.
        const size = SIZES[stage]!, player = { x: 39.5 * size, y: 30, z: 0 }, hull = [{ start: player, end: player, radius: .5 * size }];
        for (let f = 0; f < 600; f++) eco.step({ stage, dt: 1 / 30, now: stage * 100 + f / 30, player, playerHull: hull, perceivable: true, stealthFactor: 1, unlocked: [] });
      }
      for (const e of eco.entities) if (!e.eaten && e.spec.tier <= 3 && (e.spec.hunts.length > 0 || e.spec.fights)) {
        const reach = Math.max(Math.abs(e.x), Math.abs(e.z)) / SIZES[e.spec.tier]!;
        expect(reach, `${e.spec.key} ${e.id}`).toBeLessThanOrEqual(SPAWN_HALF + HUNTER_MARGIN + 1e-9);
      }
    }
  }, 60_000);   // about 1 s alone; the full suite runs files in parallel
  it('a hunter gives up a target in the push zone and does not acquire one there', () => {
    const eco = new Ecosystem(1), crab = eco.entities.find(e => e.spec.key === '1:crab' && !e.eaten)!;
    // A Speck (stage 0) right next to the crab: inside the soft start it is acquired; in the push zone it is given up / never acquired.
    const at = (x: number) => ({ x, y: crab.y, z: crab.z });
    const step = (p: Vec3, now: number) => eco.step({ stage: 0, dt: 1 / 60, now, player: p, playerHull: [{ start: p, end: p, radius: .3 }], perceivable: true, stealthFactor: 1, unlocked: [] });
    crab.x = crab.hx = 38; crab.z = crab.hz = 0; crab.y = crab.hy;
    step(at(36), 0); expect(crab.mode).toBe('hunt');
    step(at(41), 1 / 60); expect(crab.mode).toBe('return');
    for (let f = 2; f < 400; f++) step(at(41), f / 60);
    expect(crab.mode === 'hunt' || crab.mode === 'angry').toBe(false);
  });
});

describe('combat species in the ecosystem (T16)', () => {
  it('has the size-0 rows, the crab as a combat species and no crab hazard; models default to the kind', () => {
    const drifter = SPECIES.find(s => s.key === '0:drifter')!, snail = SPECIES.find(s => s.key === '0:spiny_snail')!, crab = SPECIES.find(s => s.key === '1:crab')!;
    expect(drifter).toMatchObject({ tier: 0, model: 'shrimp', behaviourId: 'drifter', hp: 3 });
    expect(snail).toMatchObject({ tier: 0, model: 'snail', behaviourId: 'spiny-snail', attackIds: ['snail-poke'], fights: true, pursuitId: 'retaliate', hp: 6 });
    expect(crab).toMatchObject({ hp: 20, behaviourId: 'crab', attackIds: ['crab-pinch', 'crab-lunge', 'crab-sweep'] }); expect(crab.contactHazardId).toBeUndefined();
    expect(HAZARDS['crab-pinch']).toBeUndefined();
    expect(FOOD_MODEL_KINDS).not.toContain('drifter'); expect(FOOD_MODEL_KINDS).not.toContain('spiny_snail'); expect(FOOD_MODEL_KINDS).toContain('snail');
    // The new rows come after every legacy row, so the legacy spawns of each tier keep their seeded places.
    expect(SPECIES.findIndex(s => s.key === '0:drifter')).toBeGreaterThan(SPECIES.findIndex(s => s.key === '4:planet'));
  });
  it('R14 / D28: a hunter of the current size respawns in 30–40 s, every other species in 14–22 s', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), snail = eco.entities.find(e => e.spec.key === '1:snail')!, drifter = eco.entities.find(e => e.spec.key === '0:drifter')!;
    eco.step(ctx({ x: 0, y: 900, z: 0 }, 0, { perceivable: false, playerHull: [] }));   // the player's size is 0
    for (let i = 0; i < 20; i++) {
      eco.consume(crab); expect(crab.respawn).toBeGreaterThanOrEqual(30); expect(crab.respawn).toBeLessThanOrEqual(40);
      for (const e of [snail, drifter]) { eco.consume(e); expect(e.respawn).toBeGreaterThanOrEqual(14); expect(e.respawn).toBeLessThanOrEqual(22); }
    }
    eco.step(ctx({ x: 0, y: 900, z: 0 }, .1, { stage: 1, perceivable: false, playerHull: [] }));   // the crab does not hunt size 1
    eco.consume(crab); expect(crab.respawn).toBeLessThanOrEqual(22);
  });
  it('D37: a combat species that returns to calm gets its full HP back (a legacy one keeps its HP)', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
    eco.step(ctx({ x: 0, y: 900, z: 0 }, 0, { perceivable: false, playerHull: [] }));
    crab.hp = 5; crab.mode = 'return'; crab.returnUntil = 0;
    eco.step(ctx({ x: 0, y: 900, z: 0 }, .1, { perceivable: false, playerHull: [] })); expect(crab.mode).toBe('calm'); expect(crab.hp).toBe(20);
    eco.step(ctx({ x: 0, y: 900, z: 0 }, .2, { stage: 1, perceivable: false, playerHull: [] }));
    ray.hp = 1; ray.mode = 'return'; ray.returnUntil = 0; ray.x = ray.hx; ray.z = ray.hz;
    eco.step(ctx({ x: 0, y: 900, z: 0 }, .3, { stage: 1, perceivable: false, playerHull: [] })); expect(ray.mode).toBe('calm'); expect(ray.hp).toBe(1);
  });
  it('combat species flee by their AI, not by the legacy prey rule', () => {
    const eco = new Ecosystem(7), drifter = eco.entities.find(e => e.spec.key === '0:drifter' && !e.eaten)!, copepod = eco.entities.find(e => e.spec.key === '0:copepod' && !e.eaten)!;
    const modes = new Set<string>(), legacy = new Set<string>();
    for (let t = 0; t <= 3; t = tick(t + .1)) { eco.step(ctx(at(drifter, 1, 0), t)); modes.add(drifter.mode); }
    for (let t = 3.1; t <= 6; t = tick(t + .1)) { eco.step(ctx(at(copepod, 1, 0), t)); legacy.add(copepod.mode); }
    expect(modes.has('flee')).toBe(false); expect(legacy.has('flee')).toBe(true);
  });
  it('acquires only with a clear line of sight (review I9: visibility and segmentClear)', () => {
    const blocked = (tier: number) => ({ ...makeWorldQueries(makeTerrain(tier)), segmentClear: () => false });
    const hidden = new Ecosystem(7, { queries: blocked }), a = crabOf(hidden); hidden.step(ctx(at(a, 6, 1.4), 0)); expect(a.mode).toBe('calm');
    const open = new Ecosystem(7), b = crabOf(open); open.step(ctx(at(b, 6, 1.4), 0)); expect(b.mode).toBe('hunt');
    expect(open.lineOfSight(b, at(b, 6, 3))).toBe(true); expect(hidden.lineOfSight(a, at(a, 6, 3))).toBe(false);
  });
  it('engage (T16 carry 4): an ambusher that struck hunts the player, without the fights flag', () => {
    const eco = new Ecosystem(7), drifter = eco.entities.find(e => e.spec.key === '0:drifter' && !e.eaten)!, p = at(drifter, 2, 0);
    engage(drifter, p, 0); expect(drifter.mode).toBe('hunt'); expect(drifter.lastKnown).toEqual(p);
    drifter.mode = 'angry'; engage(drifter, p, 0); expect(drifter.mode).toBe('angry');   // an angry one stays angry
  });
  it('a combat hunter that gives up walks home and turns calm by distance, not by the timeout (T16a review I1)', () => {
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(tier === 4 ? makeTerrain(4) : flatSea) }), crab = crabOf(eco), still = { x: 0, y: 900, z: 0 };
    eco.step(ctx(still, 0, { perceivable: false, playerHull: [] }));
    crab.hx = crab.x + 15; crab.hz = crab.z; crab.mode = 'return' as Entity['mode']; crab.returnUntil = .1;
    let calmAt = -1;
    for (let t = .1; t < 6 && calmAt < 0; t = tick(t + .1)) {
      crab.combat = { intent: { kind: 'ambient', speedFactor: 1 }, face: null, lunge: null, external: { x: 0, y: 0, z: 0 }, frozen: false, held: null, moved: 0 };   // the AI's return state
      eco.step(ctx(still, t, { perceivable: false, playerHull: [] })); if ((crab.mode as Entity['mode']) === 'calm') calmAt = t;
    }
    expect(calmAt).toBeGreaterThan(0); expect(calmAt).toBeLessThan(.1 + 6);   // 15 − L at .7 × 5.2 per second: about 2.6 s
    expect(Math.hypot(crab.x - crab.hx, crab.z - crab.hz)).toBeLessThanOrEqual(speciesActor(crab).bodyLength + 1e-9);
  });
  it('moves a combat species by its motion through resolveMotion: toward, hold facing a point, knockback decay, the snap to an emerge point', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), still = { x: 0, y: 900, z: 0 };
    eco.step(ctx(still, 0, { perceivable: false, playerHull: [] }));
    const motion = (over: Partial<EntityMotion> = {}): EntityMotion => ({ intent: { kind: 'hold' }, face: null, lunge: null, external: { x: 0, y: 0, z: 0 }, frozen: false, held: null, snap: null, moved: 0, ...over });
    const x0 = crab.x;
    crab.combat = motion({ intent: { kind: 'toward', point: at(crab, 50, 0), speedFactor: 1 } });
    eco.step(ctx(still, .1, { perceivable: false, playerHull: [] })); expect(crab.x).toBeGreaterThan(x0); expect(crab.combat.moved).toBeGreaterThan(0); expect(legal(crab)).toBe(true);
    const x1 = crab.x; crab.combat = motion({ face: at(crab, 0, 0, 10) });
    eco.step(ctx(still, .2, { perceivable: false, playerHull: [] })); expect(crab.x).toBeCloseTo(x1, 6); expect(crab.heading).toBeCloseTo(0, 6);
    const kick = motion({ external: { x: 20, y: 0, z: 0 } }); crab.combat = kick;
    eco.step(ctx(still, .3, { perceivable: false, playerHull: [] })); expect(crab.x).toBeGreaterThan(x1); expect(kick.external.x).toBeLessThan(20 * Math.exp(-6 * .1) + 1e-9);
    const frozen = motion({ external: { x: 20, y: 0, z: 0 }, frozen: true }), x2 = crab.x; crab.combat = frozen;
    eco.step(ctx(still, .4, { perceivable: false, playerHull: [] })); expect(crab.x).toBeCloseTo(x2, 6); expect(frozen.external.x).toBe(20);
    const target = { x: crab.x + 3, y: crab.y, z: crab.z + 2 }; crab.combat = motion({ snap: target });
    eco.step(ctx(still, .5, { perceivable: false, playerHull: [] })); expect(Math.hypot(crab.x - target.x, crab.z - target.z)).toBeLessThan(1); expect(legal(crab)).toBe(true);
  });
});
