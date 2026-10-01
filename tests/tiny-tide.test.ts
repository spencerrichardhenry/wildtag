import { describe, expect, it } from 'vitest';
import { dietCanEat, dnaFor, inReach, PLANET_COUNT, STAGES } from '../src/tiny-tide/state';
import { derive, dietOf, genomeCost, instanceCount, PART_LIMITS, problems, repairLegacyGenome, sanitizeGenome, starterGenome, partStats, type Genome } from '../src/tiny-tide/genome';
import { plan } from '../src/tiny-tide/plans';
import { PARTS, part } from '../src/tiny-tide/parts';
import { SPECIES, species, tierSpecies } from '../src/tiny-tide/species';
import { biomeAt, makeBiomes, populate, SIZES, WORLD_HALF } from '../src/tiny-tide/biomes';
import { Ecosystem, entityRadius, provoke } from '../src/tiny-tide/ecosystem';

const withMouth = (g: Genome, id: string): Genome => ({ ...g, parts: g.parts.map(p => part(p.id)!.kind === 'mouth' ? { ...p, id } : p) });

describe('Tiny Tide genome and parts', () => {
  it('has 34 unique parts, each mouth has a diet, and every stage offers both a herbivore and a carnivore mouth', () => {
    expect(PARTS).toHaveLength(34); expect(new Set(PARTS.map(p => p.id)).size).toBe(34);
    for (const mouth of PARTS.filter(p => p.kind === 'mouth')) expect(mouth.diet).toBeTruthy();
    expect(PARTS.filter(p => p.kind === 'mouth' && p.stage === 0).map(p => p.diet).sort()).toEqual(['carnivore', 'herbivore']);
  });
  it('starts with a valid, affordable herbivore', () => {
    const g = starterGenome();
    expect(problems(g, plan('speck')!, { unlocked: [] })).toEqual([]); expect(dietOf(g)).toBe('herbivore');
    expect(instanceCount(g)).toBeLessThanOrEqual(PART_LIMITS[0]);
  });
  it('rejects designs without exactly one mouth, too many parts, locked parts and unaffordable designs', () => {
    const g = starterGenome();
    expect(problems({ ...g, parts: g.parts.filter(p => p.id !== 'mouth_nibbler') }, plan('speck')!, { unlocked: [] }).map(p => p.code)).toContain('mouth');
    expect(problems({ ...g, parts: [...g.parts, { ...g.parts[0]!, uid: 'p10' }] }, plan('speck')!, { unlocked: [] }).map(p => p.code)).toContain('mouth');
    const many = { ...g, parts: [...g.parts, ...Array.from({ length: 5 }, (_, i) => ({ uid: `p${10 + i}`, id: 'spike', t: .5, angle: 0, scale: 1, mirror: false, roll: 0 }))] };
    expect(problems(many, plan('speck')!, { unlocked: [] }).map(p => p.code)).toContain('parts');
    expect(problems(many, plan('crawler')!, { unlocked: [] }).map(p => p.code)).not.toContain('parts');
    const winged = { ...g, parts: [...g.parts, { uid: 'p10', id: 'wing_feather', t: .4, angle: 1, scale: 1, mirror: true, roll: 0 }] };
    expect(problems(winged, plan('speck')!, { unlocked: [] }).map(p => p.code)).toContain('locked');
    expect(problems(winged, plan('sky_drifter')!, { unlocked: [] }).map(p => p.code)).not.toContain('locked');
    expect(problems(g, plan('speck')!, { unlocked: [], budget: genomeCost(g) - 1 }).map(p => p.code)).toContain('dna');
  });
  it('derives stats from parts, counting mirrored pairs twice', () => {
    const g = starterGenome(), base = partStats(g);
    const finned = { ...g, parts: [...g.parts, { uid: 'p10', id: 'fin_side', t: .45, angle: 1.8, scale: 1, mirror: true, roll: 0 }] };
    expect(partStats(finned).speed).toBeCloseTo(base.speed + .8, 5);
    const armored = derive(partStats({ ...g, parts: [...g.parts, { uid: 'p10', id: 'spike', t: .5, angle: 0, scale: 1, mirror: false, roll: 0 }, { uid: 'p11', id: 'spike', t: .6, angle: 0, scale: 1, mirror: false, roll: 0 }] }));
    expect(armored.armor).toBe(2);
    expect(derive(partStats(withMouth(g, 'mouth_snapper'))).bite).toBeGreaterThan(derive(base).bite);
  });
  it('sanitizes saved genomes and rejects unknown parts and colors', () => {
    const g = starterGenome();
    expect(sanitizeGenome(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(sanitizeGenome({ ...g, parts: [{ ...g.parts[0], id: 'laser' }] })).toBeNull();
    expect(sanitizeGenome({ ...g, paint: { ...g.paint, base: 'red' } })).toBeNull();
    expect(sanitizeGenome({ ...g, spine: g.spine.slice(0, 2) })).toBeNull();
    expect(repairLegacyGenome({ ...g, parts: g.parts.map(({ uid: _u, ...rest }) => rest), spine: [{ radius: 9, height: -1, lift: 0 }, ...g.spine.slice(1)] })!.spine[0]).toEqual({ radius: 1.2, height: .25, lift: 0 });
    expect(sanitizeGenome({ ...g, spine: [{ radius: 9, height: -1, lift: 0 }, ...g.spine.slice(1)] })).toBeNull();
  });
});

describe('Tiny Tide diet and DNA', () => {
  it('feeds herbivores plants, carnivores meat, omnivores both at a lower rate, and everyone the any-food', () => {
    expect(dietCanEat('herbivore', 'plant')).toBe(true); expect(dietCanEat('herbivore', 'meat')).toBe(false);
    expect(dietCanEat('carnivore', 'meat')).toBe(true); expect(dietCanEat('carnivore', 'plant')).toBe(false);
    expect(dietCanEat('omnivore', 'plant') && dietCanEat('omnivore', 'meat')).toBe(true);
    for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) expect(dietCanEat(diet, 'any')).toBe(true);
    const sprout = species(0, 'plant');
    expect(dnaFor('omnivore', sprout)).toBeLessThan(dnaFor('herbivore', sprout));
    expect(dnaFor('omnivore', species(3, 'tree'))).toBe(dnaFor('carnivore', species(3, 'tree')));
  });
  it('gives every diet enough food to evolve in every seabed stage', () => {
    for (let tier = 0; tier < 3; tier++) for (const tag of ['plant', 'meat'] as const) {
      const foods = tierSpecies(tier).filter(s => s.tag === tag);
      expect(foods.length).toBeGreaterThanOrEqual(2);
      expect(foods.reduce((sum, s) => sum + s.count * s.dna, 0)).toBeGreaterThan(STAGES[tier]!.goal);
    }
    expect(tierSpecies(3).every(s => s.tag === 'any')).toBe(true);
    expect(tierSpecies(4).map(s => s.kind)).toEqual(['planet']);
  });
});

describe('Tiny Tide world generation', () => {
  it('creates a different, deterministic layout for each seed inside the world bounds', () => {
    const a = populate(11), b = populate(11), c = populate(12);
    expect(a).toEqual(b); expect(a.map(s => s.x)).not.toEqual(c.map(s => s.x));
    expect(a.length).toBe(SPECIES.reduce((sum, s) => sum + s.count, 0));
    for (const spawn of a) {
      const size = SIZES[spawn.spec.tier]!;
      expect(Math.abs(spawn.x) / size).toBeLessThanOrEqual(WORLD_HALF + 20);
      expect(Math.abs(spawn.z) / size).toBeLessThanOrEqual(WORLD_HALF + 20);
      expect(Number.isFinite(spawn.y)).toBe(true);
    }
    expect(a.filter(s => s.spec.kind === 'planet')).toHaveLength(PLANET_COUNT);
  });
  it('places biomes per seed and biases species toward their biomes', () => {
    expect(makeBiomes(1, 0).map(b => b.x)).not.toEqual(makeBiomes(2, 0).map(b => b.x)); expect(makeBiomes(1, 0)).toEqual(makeBiomes(1, 0));
    let inHome = 0, total = 0;
    for (let seed = 0; seed < 20; seed++) {
      const biomes = makeBiomes(seed, 1);
      for (const s of populate(seed).filter(s => s.spec.key === '1:crab')) { total++; if (biomeAt(biomes, s.x / 4, s.z / 4).name === 'Crab flats') inHome++; }
    }
    expect(inHome / total).toBeGreaterThan(.35);
  });
});

describe('Tiny Tide ecosystem', () => {
  const ctx = (_eco: Ecosystem, stage: number, player: { x: number; y: number; z: number }, extra = {}) => ({ stage, dt: .1, now: 0, player, playerHull: [{ start: player, end: player, radius: .6 * SIZES[stage]! }], stealthFactor: 1, perceivable: true, ...extra });
  it('lets a crab notice, hunt and bite a nearby tiny creature, and stealth hides it', () => {
    const eco = new Ecosystem(7), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    const player = { x: crab.x + 6, y: crab.y, z: crab.z };
    eco.step(ctx(eco, 0, player)); expect(crab.mode).toBe('hunt');
    let events: ReturnType<Ecosystem['step']> = [];
    for (let i = 0; i < 40 && !events.length; i++) events = eco.step(ctx(eco, 0, player)).filter(e => e.entity === crab);
    expect(events[0]?.type).toBe('hazard'); expect(events[0]!.damage).toBe(3);
    const quiet = new Ecosystem(7), crab2 = quiet.entities.find(e => e.spec.key === '1:crab')!;
    quiet.step(ctx(quiet, 0, { x: crab2.x + 6, y: crab2.y, z: crab2.z }, { stealthFactor: .35 })); expect(crab2.mode).toBe('calm');
  });
  it('makes crabs prey for a stage-one creature until provoked, then they fight back', () => {
    const eco = new Ecosystem(7), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    const player = { x: crab.x + 4, y: crab.y, z: crab.z };
    eco.step(ctx(eco, 1, player)); expect(crab.mode).toBe('calm');
    provoke(crab, player, 0); expect(crab.mode).toBe('angry');
    let attacked = false; for (let i = 0; i < 60 && !attacked; i++) attacked = eco.step(ctx(eco, 1, player)).some(e => e.entity === crab && e.type === 'hazard');
    expect(attacked).toBe(true);
  });
  it('gives up a hunt when the player escapes, and perceives independently of damage', () => {
    const eco = new Ecosystem(9), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    eco.step(ctx(eco, 0, { x: crab.x + 5, y: crab.y, z: crab.z })); expect(crab.mode).toBe('hunt');
    eco.step(ctx(eco, 0, { x: crab.x + 500, y: crab.y, z: crab.z })); expect(crab.mode).toBe('return');
    const safe = new Ecosystem(9), crab2 = safe.entities.find(e => e.spec.key === '1:crab')!;
    // The ecosystem has no damage flag: only the perceivable flag decides whether the player is noticed.
    safe.step(ctx(safe, 0, { x: crab2.x, y: crab2.y, z: crab2.z }, { perceivable: false })); expect(crab2.mode).toBe('calm');
    safe.step(ctx(safe, 0, { x: crab2.x, y: crab2.y, z: crab2.z })); expect(crab2.mode).toBe('hunt');
  });
  it('makes prey flee from a player that can eat it', () => {
    const eco = new Ecosystem(3), pod = eco.entities.find(e => e.spec.key === '0:copepod')!;
    const player = { x: pod.x + 2, y: pod.y, z: pod.z };
    for (let i = 0; i < 20; i++) eco.step(ctx(eco, 0, player));
    expect(pod.mode).toBe('flee'); expect(Math.hypot(pod.x - player.x, pod.z - player.z)).toBeGreaterThan(2);
  });
  it('regrows plants in place only out of sight, moves animals elsewhere, and never respawns planets', () => {
    const eco = new Ecosystem(5), sprout = eco.entities.find(e => e.spec.key === '0:plant')!, pod = eco.entities.find(e => e.spec.key === '0:copepod')!, planet = eco.entities.find(e => e.spec.kind === 'planet')!;
    const home = { x: sprout.x, z: sprout.z };
    eco.consume(sprout); eco.consume(pod); eco.consume(planet);
    const near = { x: home.x + 2, y: 0, z: home.z };
    for (let i = 0; i < 260; i++) eco.step(ctx(eco, 0, near));
    expect(sprout.eaten).toBe(true); expect(pod.eaten).toBe(false); expect(Math.hypot(pod.x - near.x, pod.z - near.z)).toBeGreaterThan(16);
    eco.step(ctx(eco, 0, { x: home.x + 40, y: 0, z: home.z + 40 }));
    expect(sprout.eaten).toBe(false); expect([sprout.x, sprout.z]).toEqual([home.x, home.z]);
    expect(planet.eaten).toBe(true); expect(planet.respawn).toBe(-1);
  });
  it('restores eaten planets by index', () => {
    const eco = new Ecosystem(5); eco.reset([0, 4]);
    const planets = eco.entities.filter(e => e.spec.kind === 'planet');
    expect(planets.map(p => p.eaten)).toEqual(planets.map((_, i) => i === 0 || i === 4));
    expect(eco.planetIndex(planets[4]!)).toBe(4); expect(entityRadius(planets[0]!)).toBeGreaterThan(entityRadius(eco.entities[0]!));
  });
});

describe('Tiny Tide reach', () => {
  it('keeps reach checks local to the stage', () => {
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 1, y: .7, z: 0 })).toBe(true);
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 3, y: .7, z: 0 })).toBe(false);
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 3, y: .7, z: 0 }, 1, 1)).toBe(true);
  });
});
