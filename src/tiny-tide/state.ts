import { cloneGenome, derive, dietOf, sanitizeGenome, starterGenome, statsOf, type Genome } from './genome';
import { part, type Diet } from './parts';
import { PLANET_COUNT } from './biomes';
import type { FoodTag, Species } from './species';

export { PLANET_COUNT, SIZES, WATER_LEVEL, random, seabedHeight } from './biomes';
export interface Stage {
  title: string; biome: string; size: string; description: string;
  /** DNA earned in the stage to evolve. Stage 4 ends with the planets instead. */
  goal: number; speed: number; radius: number; color: string; action: string;
}
export const STAGES: readonly Stage[] = [
  { title: 'Tiny', biome: 'THE SUNLIT SHALLOWS', size: '2 cm', description: 'Scuttle along the seabed. Nibble greens or chase copepods. Watch out for crabs.', goal: 100, speed: 5.8, radius: 1.7, color: '#ffad92', action: '' },
  { title: 'Small', biome: 'THE CORAL GARDEN', size: '30 cm', description: 'Hold Rise to swim up. Crabs are snacks now, but they pinch back. Squid hunt the middle water.', goal: 150, speed: 6.5, radius: 2, color: '#ffc769', action: 'Rise' },
  { title: 'Big', biome: 'THE OPEN OCEAN', size: '8 m', description: 'Breach out of the water for gulls. Squid fight back. Rays sting.', goal: 210, speed: 7.5, radius: 2.5, color: '#b4e7ed', action: 'Breach' },
  { title: 'Huge', biome: 'THE WHOLE WIDE WORLD', size: '120 m', description: 'Eat everything. Seaplanes will try to chase you off.', goal: 260, speed: 7, radius: 2.7, color: '#d4b1f5', action: 'Rise' },
  { title: 'Cosmic', biome: 'THE FINAL FRONTIER', size: '∞', description: 'Float through the stars and eat all 12 planets.', goal: PLANET_COUNT, speed: 8, radius: 3, color: '#bfc0ff', action: 'Rise' },
];
export const START_DNA = 20;
export const DEATH_KEEP = .7;
export const OMNIVORE_RATE = .7;

export interface Run {
  version: 2; seed: number; name: string; stage: number;
  /** DNA the player can spend in the editor. */
  dna: number;
  /** DNA earned in the current stage. It fills the growth bar. */
  stageDna: number; totalDna: number; bites: number; elapsed: number; deaths: number; health: number;
  genome: Genome; unlocked: string[]; eatenPlanets: number[]; completed: boolean;
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
export function freshRun(seed = newSeed()): Run {
  const genome = starterGenome();
  return { version: 2, seed, name: 'Little Tide', stage: 0, dna: START_DNA, stageDna: 0, totalDna: 0, bites: 0, elapsed: 0, deaths: 0, health: derive(statsOf(genome)).maxHealth, genome, unlocked: [], eatenPlanets: [], completed: false };
}
export const dietCanEat = (diet: Diet, tag: FoodTag) => tag === 'any' || diet === 'omnivore' || (diet === 'herbivore' ? tag === 'plant' : tag === 'meat');
export function dnaFor(diet: Diet, spec: Species) {
  if (!dietCanEat(diet, spec.tag)) return 0;
  return Math.round(spec.dna * (diet === 'omnivore' && spec.tag !== 'any' ? OMNIVORE_RATE : 1));
}
export const evolveReady = (run: Run) => run.stage < 4 && run.stageDna >= STAGES[run.stage]!.goal;
export const growthOf = (run: Run) => 1 + Math.min(1, run.stage === 4 ? run.eatenPlanets.length / PLANET_COUNT : run.stageDna / STAGES[run.stage]!.goal) * .38;

export interface Point { x: number; y: number; z: number }
/** Bite range check in stage-local units. `extraReach` comes from parts. */
export function inReach(stage: number, player: Point, food: Point, growth = 1, extraReach = 0, foodRadius = 0) {
  const spec = STAGES[stage]!;
  return Math.hypot(player.x - food.x, player.z - food.z) < spec.radius * growth + .5 + extraReach + foodRadius &&
    Math.abs(player.y - food.y) < (stage === 0 ? 2 : 2.2) + extraReach * .5 + foodRadius;
}
/** Records a meal. Returns the DNA earned and whether the run ended. */
export function eat(run: Run, spec: Species, id: number): { dna: number; win: boolean } {
  if (run.completed || (spec.kind === 'planet' && run.eatenPlanets.includes(id))) return { dna: 0, win: false };
  const dna = dnaFor(dietOf(run.genome), spec);
  run.bites++; run.dna += dna; run.totalDna += dna;
  if (spec.tier === run.stage && run.stage < 4) run.stageDna += dna;
  if (spec.kind === 'planet') run.eatenPlanets.push(id);
  if (run.stage === 4 && run.eatenPlanets.length >= PLANET_COUNT) { run.completed = true; return { dna, win: true }; }
  return { dna, win: false };
}
/** Damage after armor. Every hit costs at least one point. */
export const damageAfterArmor = (damage: number, armor: number) => Math.max(1, damage - Math.floor(armor / 2));
/** Applies damage. Returns true when the creature faints. */
export function hurt(run: Run, damage: number, armor: number): boolean {
  run.health = Math.max(0, run.health - damageAfterArmor(damage, armor));
  return run.health <= 0;
}
/** The creature wakes at the stage start with most of its DNA. */
export function faint(run: Run) {
  run.deaths++; run.dna = Math.floor(run.dna * DEATH_KEEP); run.health = derive(statsOf(run.genome)).maxHealth;
}
export function evolve(run: Run) {
  if (!evolveReady(run)) return false;
  run.stage++; run.stageDna = 0; run.health = derive(statsOf(run.genome)).maxHealth; return true;
}
export function unlock(run: Run, id: string | undefined) {
  if (!id || !part(id) || run.unlocked.includes(id) || part(id)!.stage <= run.stage) return false;
  run.unlocked.push(id); return true;
}
/** Applies an editor result. The old design is refunded, the new one is paid. */
export function applyDesign(run: Run, genome: Genome, name: string, cost: (g: Genome) => number) {
  const budget = run.dna + cost(run.genome);
  if (cost(genome) > budget) return false;
  run.dna = budget - cost(genome); run.genome = cloneGenome(genome); run.name = name.trim().slice(0, 24) || run.name;
  run.health = Math.min(run.health, derive(statsOf(genome)).maxHealth);
  return true;
}

const int = (v: unknown, min = 0) => Number.isInteger(v) && (v as number) >= min;
const finite = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
function validPlanets(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(id => Number.isInteger(id) && id >= 0 && id < PLANET_COUNT) && new Set(v).size === v.length;
}
/** Reads a v2 save, or migrates a v1 save. Returns null for anything inconsistent. */
export function parseSave(raw: string | null): Run | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (v.version === 2) return parseV2(v);
    if (v.version === undefined) return migrateV1(v);
    return null;
  } catch { return null; }
}
function parseV2(v: Record<string, unknown>): Run | null {
  const genome = sanitizeGenome(v.genome);
  if (!genome || !int(v.seed) || typeof v.name !== 'string' || !int(v.stage) || (v.stage as number) > 4 || !finite(v.dna) || !finite(v.stageDna) || !finite(v.totalDna) ||
      !int(v.bites) || !finite(v.elapsed) || !int(v.deaths) || !finite(v.health) || typeof v.completed !== 'boolean' || !validPlanets(v.eatenPlanets) ||
      !Array.isArray(v.unlocked) || !v.unlocked.every(id => typeof id === 'string' && part(id))) return null;
  const stage = v.stage as number, planets = v.eatenPlanets as number[];
  if ((stage !== 4 && planets.length) || (v.completed && (stage !== 4 || planets.length !== PLANET_COUNT))) return null;
  const maxHealth = derive(statsOf(genome)).maxHealth;
  return { version: 2, seed: v.seed as number, name: (v.name as string).slice(0, 24) || 'Little Tide', stage, dna: v.dna as number, stageDna: v.stageDna as number, totalDna: v.totalDna as number,
    bites: v.bites as number, elapsed: v.elapsed as number, deaths: v.deaths as number, health: Math.min(maxHealth, Math.max(1, v.health as number)), genome, unlocked: [...v.unlocked as string[]], eatenPlanets: [...planets], completed: v.completed as boolean };
}
const V1_GOALS = [10, 12, 14, 16, 12];
/** v1 saved a fixed form and a bite count. Keep the stage, the planets and the time. */
function migrateV1(v: Record<string, unknown>): Run | null {
  if (!int(v.stage) || (v.stage as number) > 4 || !int(v.bites) || !int(v.total) || (v.total as number) < (v.bites as number) || !finite(v.elapsed) ||
      typeof v.completed !== 'boolean' || !validPlanets(v.eatenPlanets)) return null;
  const stage = v.stage as number, bites = v.bites as number, planets = v.eatenPlanets as number[];
  if (bites > V1_GOALS[stage]! || (stage === 4 && planets.length !== bites) || (stage !== 4 && planets.length) || (v.completed && (stage !== 4 || bites !== PLANET_COUNT))) return null;
  const run = freshRun();
  run.stage = stage; run.bites = v.total as number; run.elapsed = v.elapsed as number; run.eatenPlanets = [...planets]; run.completed = v.completed as boolean;
  run.stageDna = stage === 4 ? 0 : Math.round(bites / V1_GOALS[stage]! * STAGES[stage]!.goal);
  run.dna = START_DNA + stage * 30; run.totalDna = run.stageDna + stage * 120;
  return run;
}
