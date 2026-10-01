import { describe, expect, it } from 'vitest';
import { applyDesign, damageAfterArmor, dietCanEat, dnaFor, eat, evolve, evolveReady, faint, freshRun, hurt, inReach, parseSave, PLANET_COUNT, STAGES, unlock } from '../src/tiny-tide/state';
import { derive, dietOf, genomeCost, instanceCount, PART_LIMITS, problems, repairLegacyGenome, sanitizeGenome, starterGenome, statsOf, type Genome } from '../src/tiny-tide/genome';
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
    const g = starterGenome(), base = statsOf(g);
    const finned = { ...g, parts: [...g.parts, { uid: 'p10', id: 'fin_side', t: .45, angle: 1.8, scale: 1, mirror: true, roll: 0 }] };
    expect(statsOf(finned).speed).toBeCloseTo(base.speed + .8, 5);
    const armored = derive(statsOf({ ...g, parts: [...g.parts, { uid: 'p10', id: 'spike', t: .5, angle: 0, scale: 1, mirror: false, roll: 0 }, { uid: 'p11', id: 'spike', t: .6, angle: 0, scale: 1, mirror: false, roll: 0 }] }));
    expect(armored.armor).toBe(2);
    expect(derive(statsOf(withMouth(g, 'mouth_snapper'))).bite).toBeGreaterThan(derive(base).bite);
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
  it('fills the stage bar with DNA, then evolves only when ready', () => {
    const run = freshRun(1), sprout = species(0, 'plant');
    expect(evolve(run)).toBe(false);
    while (!evolveReady(run)) eat(run, sprout, 0);
    const wallet = run.dna; expect(wallet).toBeGreaterThan(STAGES[0]!.goal);
    expect(evolve(run)).toBe(true); expect(run.stage).toBe(1); expect(run.stageDna).toBe(0); expect(run.dna).toBe(wallet);
    // Food from a lower tier still gives DNA to spend, but not stage progress.
    eat(run, sprout, 1); expect(run.stageDna).toBe(0); expect(run.dna).toBe(wallet + sprout.dna);
  });
  it('wins only after all 12 distinct planets', () => {
    const run = { ...freshRun(2), stage: 4 }, planet = species(4, 'planet');
    for (let i = 0; i < PLANET_COUNT - 1; i++) expect(eat(run, planet, i).win).toBe(false);
    expect(eat(run, planet, 3).dna).toBe(0);
    expect(eat(run, planet, 11).win).toBe(true); expect(run.completed).toBe(true);
  });
  it('applies an editor design by refunding the old one and paying for the new one', () => {
    const run = freshRun(3), before = run.dna;
    const cheaper = { ...run.genome, parts: run.genome.parts.filter(p => p.id !== 'leg_little') };
    expect(applyDesign(run, cheaper, 'Nibs', genomeCost)).toBe(true);
    expect(run.dna).toBe(before + 14); expect(run.name).toBe('Nibs');
    const pricey = { ...cheaper, parts: [...cheaper.parts, { uid: 'p10', id: 'claw_pincer', t: .2, angle: 2, scale: 1, mirror: true, roll: 0 }, { uid: 'p11', id: 'fin_side', t: .4, angle: 1.7, scale: 1, mirror: true, roll: 0 }] };
    run.dna = 10; expect(applyDesign(run, pricey, '', genomeCost)).toBe(false); expect(run.genome).toEqual(cheaper);
  });
  it('unlocks a part early only once, and only if its stage is still ahead', () => {
    const run = freshRun(4);
    expect(unlock(run, 'leg_crab')).toBe(true); expect(unlock(run, 'leg_crab')).toBe(false);
    expect(problems({ ...run.genome, parts: [...run.genome.parts, { uid: 'p10', id: 'leg_crab', t: .6, angle: 2.4, scale: 1, mirror: false, roll: 0 }] }, plan('speck')!, { unlocked: run.unlocked }).map(p => p.code)).not.toContain('locked');
    run.stage = 2; expect(unlock(run, 'glow_bulb')).toBe(false);
  });
});

describe('Tiny Tide health', () => {
  it('reduces damage with armor, never below one, and faints at zero health', () => {
    expect(damageAfterArmor(3, 0)).toBe(3); expect(damageAfterArmor(3, 2)).toBe(2); expect(damageAfterArmor(1, 9)).toBe(1);
    const run = freshRun(5); run.dna = 100;
    let fainted = false; for (let i = 0; i < 20 && !fainted; i++) fainted = hurt(run, 2, 0);
    expect(fainted).toBe(true); faint(run);
    expect(run.deaths).toBe(1); expect(run.dna).toBe(70); expect(run.health).toBe(derive(statsOf(run.genome)).maxHealth); expect(run.stage).toBe(0);
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
  const ctx = (_eco: Ecosystem, stage: number, player: { x: number; y: number; z: number }, extra = {}) => ({ stage, dt: .1, time: 0, player, playerRadius: .6 * SIZES[stage]!, stealthFactor: 1, vulnerable: true, ...extra });
  it('lets a crab notice, hunt and bite a nearby tiny creature, and stealth hides it', () => {
    const eco = new Ecosystem(7), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    const player = { x: crab.x + 6, y: crab.y, z: crab.z };
    eco.step(ctx(eco, 0, player)); expect(crab.mode).toBe('hunt');
    let events: ReturnType<Ecosystem['step']> = [];
    for (let i = 0; i < 40 && !events.length; i++) events = eco.step(ctx(eco, 0, player)).filter(e => e.entity === crab);
    expect(events[0]?.type).toBe('attack'); expect(events[0]!.damage).toBe(3);
    const quiet = new Ecosystem(7), crab2 = quiet.entities.find(e => e.spec.key === '1:crab')!;
    quiet.step(ctx(quiet, 0, { x: crab2.x + 6, y: crab2.y, z: crab2.z }, { stealthFactor: .35 })); expect(crab2.mode).toBe('calm');
  });
  it('makes crabs prey for a stage-one creature until provoked, then they fight back', () => {
    const eco = new Ecosystem(7), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    const player = { x: crab.x + 4, y: crab.y, z: crab.z };
    eco.step(ctx(eco, 1, player)); expect(crab.mode).toBe('calm');
    provoke(crab); expect(crab.mode).toBe('angry');
    let attacked = false; for (let i = 0; i < 60 && !attacked; i++) attacked = eco.step(ctx(eco, 1, player)).some(e => e.entity === crab && e.type === 'attack');
    expect(attacked).toBe(true);
  });
  it('gives up a hunt when the player escapes, and never hurts an invulnerable player', () => {
    const eco = new Ecosystem(9), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    eco.step(ctx(eco, 0, { x: crab.x + 5, y: crab.y, z: crab.z })); expect(crab.mode).toBe('hunt');
    eco.step(ctx(eco, 0, { x: crab.x + 500, y: crab.y, z: crab.z })); expect(crab.mode).toBe('return');
    const safe = new Ecosystem(9), crab2 = safe.entities.find(e => e.spec.key === '1:crab')!;
    for (let i = 0; i < 50; i++) expect(safe.step(ctx(safe, 0, { x: crab2.x, y: crab2.y, z: crab2.z }, { vulnerable: false }))).toEqual([]);
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

describe('Tiny Tide saves', () => {
  it('round-trips a v2 save', () => {
    const run = freshRun(42); run.stage = 4; run.eatenPlanets = [1, 2]; run.dna = 33.5;
    expect(parseSave(JSON.stringify(run))).toEqual(run);
  });
  it('migrates a v1 save, keeping stage, planets and time', () => {
    const v1 = { stage: 2, bites: 7, total: 29, elapsed: 312, eatenPlanets: [], completed: false };
    const run = parseSave(JSON.stringify(v1))!;
    expect(run.version).toBe(2); expect(run.stage).toBe(2); expect(run.bites).toBe(29); expect(run.elapsed).toBe(312);
    expect(run.stageDna).toBe(Math.round(7 / 14 * STAGES[2]!.goal)); expect(problems(run.genome, plan('crawler')!, { unlocked: [] })).toEqual([]);
    const space = parseSave(JSON.stringify({ stage: 4, bites: 3, total: 60, elapsed: 900, eatenPlanets: [0, 5, 9], completed: false }))!;
    expect(space.eatenPlanets).toEqual([0, 5, 9]);
  });
  it('ignores corrupt and inconsistent saves', () => {
    const ok = freshRun(1);
    for (const value of [null, 'oops', '{}', '[]', JSON.stringify({ ...ok, version: 3 }), JSON.stringify({ ...ok, stage: 5 }), JSON.stringify({ ...ok, dna: -1 }), JSON.stringify({ ...ok, completed: true }),
      JSON.stringify({ ...ok, eatenPlanets: [1] }), JSON.stringify({ ...ok, stage: 4, eatenPlanets: [0, 0] }), JSON.stringify({ ...ok, unlocked: ['laser'] }), JSON.stringify({ ...ok, genome: { ...ok.genome, parts: 'x' } }),
      JSON.stringify({ stage: -1, bites: 0, total: 0, elapsed: 0, eatenPlanets: [], completed: false }), JSON.stringify({ stage: 4, bites: 2, total: 9, elapsed: 0, eatenPlanets: [0, 13], completed: false })]) expect(parseSave(value)).toBeNull();
  });
  it('keeps reach checks local to the stage', () => {
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 1, y: .7, z: 0 })).toBe(true);
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 3, y: .7, z: 0 })).toBe(false);
    expect(inReach(0, { x: 0, y: .7, z: 0 }, { x: 3, y: .7, z: 0 }, 1, 1)).toBe(true);
  });
});
