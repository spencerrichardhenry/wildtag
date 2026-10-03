import { bankAll, commitDesign, earn, faintCombat, legacyEconomy, validateLedger, walletTotal, type Economy } from './economy';
import { adaptToPlan, cloneGenome, derive, dietOf, effectiveStats, partCost, problems, repairLegacyGenome, sanitizeGenome, starterFor, starterGenome, STARTER_NEXT_SERIAL, uidSerial, type DesignContext, type Genome } from './genome';
import { PARTS, part, type Diet, type PartSpec } from './parts';
import { closedLinesOf, commitmentsOf, eligibleChildren, plan, ROOT_PLAN, violates, type BodyPlan } from './plans';
import { PLANET_COUNT } from './biomes';
import type { FoodTag, Species } from './species';
import type { CombatLoadout } from './combat-types';

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
export const OMNIVORE_RATE = .7;

export interface ArchivedDesign { genome: Genome; name: string; savedAt: string; reason: string }
export interface Run {
  version: 4; seed: number; name: string; stage: number;
  /** Body plan ids from the root to the current plan. */
  plans: string[]; diet: Diet;
  /** Banked and at-risk DNA, with the cost basis of each installed part. */
  economy: Economy;
  /** DNA earned in the current stage. It fills the growth bar. */
  stageDna: number; totalDna: number; bites: number; elapsed: number; deaths: number; health: number;
  genome: Genome; nextPartSerial: number; unlocked: string[]; eatenPlanets: number[]; completed: boolean;
  loadout: CombatLoadout; pendingRespawn: boolean; mechanics: Record<string, unknown>; archive: ArchivedDesign[]; notices: string[];
}
export interface Build { coast: boolean; anchorCheck?: DesignContext['anchorCheck'] }
export type Commit = { ok: true; clearedBindings: number[] } | { ok: false; reason: string; shortfall?: number };
export interface Prepared { planId: string; genome: Genome; name: string; economy: Economy; diet: Diet; nextSerial: number }
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
export const dnaOf = (run: Run) => walletTotal(run.economy);
export const currentPlan = (run: Run): BodyPlan => plan(run.plans.at(-1)!)!;
export const maxHealthOf = (run: Run) => derive(effectiveStats(run.genome, currentPlan(run))).maxHealth;
export function freshRun(seed = newSeed()): Run {
  const genome = starterGenome();
  const run: Run = { version: 4, seed, name: 'Little Tide', stage: 0, plans: [ROOT_PLAN], diet: dietOf(genome), economy: legacyEconomy(START_DNA, genome), stageDna: 0, totalDna: 0,
    bites: 0, elapsed: 0, deaths: 0, health: 0, genome, nextPartSerial: STARTER_NEXT_SERIAL, unlocked: [], eatenPlanets: [], completed: false,
    loadout: { active: [null, null] }, pendingRespawn: false, mechanics: {}, archive: [], notices: [] };
  run.health = maxHealthOf(run); return run;
}
export const dietCanEat = (diet: Diet, tag: FoodTag) => tag === 'any' || diet === 'omnivore' || (diet === 'herbivore' ? tag === 'plant' : tag === 'meat');
export function dnaFor(diet: Diet, spec: Species) {
  if (!dietCanEat(diet, spec.tag)) return 0;
  return Math.round(spec.dna * (diet === 'omnivore' && spec.tag !== 'any' ? OMNIVORE_RATE : 1));
}
/** DNA for one meal on a plan: diet rate and the plan's foraging bonus for the food's habitat, rounded once. */
export function mealDna(p: BodyPlan, diet: Diet, spec: Species): number {
  if (!dietCanEat(diet, spec.tag)) return 0;
  const forage = p.foraging.find(f => f.habitat === spec.habitatProfileId)?.dnaMultiplier ?? 1;
  return Math.round(spec.dna * (diet === 'omnivore' && spec.tag !== 'any' ? OMNIVORE_RATE : 1) * forage);
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
/** Adds earned DNA at risk. Only food of the current stage fills the growth bar. */
export function reward(run: Run, dna: number, countsForStage: boolean) {
  run.economy = earn(run.economy, dna); run.totalDna += dna;
  if (countsForStage && run.stage < 4) run.stageDna += dna;
}
/** Records a meal. Returns the DNA earned and whether the run ended. */
export function eat(run: Run, spec: Species, id: number): { dna: number; win: boolean } {
  if (run.completed || (spec.kind === 'planet' && run.eatenPlanets.includes(id))) return { dna: 0, win: false };
  const dna = mealDna(currentPlan(run), run.diet, spec);
  run.bites++; reward(run, dna, spec.tier === run.stage);
  if (spec.kind === 'planet') run.eatenPlanets.push(id);
  if (run.stage === 4 && run.eatenPlanets.length >= PLANET_COUNT) { run.completed = true; return { dna, win: true }; }
  return { dna, win: false };
}
/** Damage after armor. Every hit costs at least one point. */
export const damageAfterArmor = (damage: number, armor: number) => Math.max(1, damage - Math.floor(armor / 2));
/** Applies damage in half-hearts (spec §10.1, D19): health is in hearts with .5 steps. Returns true when the creature faints. */
export function hurt(run: Run, damage: number, armor: number): boolean {
  run.health = Math.max(0, run.health - damageAfterArmor(damage, armor) / 2);
  return run.health <= 0;
}
/** DNA from a combat kill (spec §10.4, R8): a meat eater gets the meal DNA (omnivore × .7, foraging; one rounding) and a bite; a herbivore gets
 *  nothing (the creature is driven off). It counts for the growth bar for a species of the player's tier or one that hunts its size. */
export function killReward(run: Run, spec: Species): { dna: number; counts: boolean } {
  if (run.diet === 'herbivore') return { dna: 0, counts: false };
  const dna = mealDna(currentPlan(run), run.diet, spec); if (dna <= 0) return { dna: 0, counts: false };   // nothing paid: no bite, no growth
  const counts = spec.tier === run.stage || spec.hunts.includes(run.stage);
  run.bites++; reward(run, dna, counts);
  return { dna, counts };
}
/** The survivor bonus share of a hunter's DNA (D22), and its conditions: an engagement of at least SURVIVOR_SECONDS with at least one wind-up. */
export const SURVIVOR_SHARE = .35, SURVIVOR_SECONDS = 4;
export function survivorBonusDue(run: Run, behaviourType: string | undefined, engagement: { seconds: number; windups: number }): boolean {
  return run.diet === 'herbivore' && !run.pendingRespawn && (behaviourType === 'hunter' || behaviourType === 'hunter-ambush') && engagement.seconds >= SURVIVOR_SECONDS - 1e-9 && engagement.windups >= 1;
}
/** A herbivore survived a hunter (spec §10.4): round(.35 × its DNA), counting for the growth bar. */
export function survivorReward(run: Run, spec: Species): number {
  const dna = Math.round(SURVIVOR_SHARE * spec.dna); reward(run, dna, true); return dna;
}
/** Unlocks a part found early; a rare part at any stage (it is never available in another way, spec §7.6). */
export function unlock(run: Run, id: string | undefined) {
  const spec = id ? part(id) : undefined;
  if (!id || !spec || run.unlocked.includes(id) || (!spec.rare && spec.stage <= run.stage)) return false;
  run.unlocked.push(id); return true;
}
/** An alpha's defeat (spec §10.4, D23): its reward DNA (counting for the growth bar) and its rare part. Once: the part in `unlocked` records
 *  the defeat (no other save field), so a second call, also after a save and load, pays nothing. */
export function alphaReward(run: Run, spec: Species): { dna: number; part: string | null } {
  const a = spec.alpha; if (!a || run.unlocked.includes(a.rewardPartId)) return { dna: 0, part: null };
  unlock(run, a.rewardPartId); reward(run, a.rewardDna, true);
  return { dna: a.rewardDna, part: a.rewardPartId };
}
const serialAfter = (g: Genome, ...floors: number[]) => Math.max(...floors, ...g.parts.map(p => uidSerial(p.uid) + 1));
type Failure = { ok: false; reason: string; shortfall?: number };
/** Clears bindings whose part is gone or whose catalog spec no longer has the grant. */
function clearMissing(run: Run, catalog: readonly PartSpec[]) {
  const cleared: number[] = [];
  run.loadout.active = run.loadout.active.map((binding, i) => {
    if (!binding) return binding;
    const placed = run.genome.parts.find(p => p.uid === binding.partUid), spec = placed && catalog.find(s => s.id === placed.id);
    if (!placed || !spec?.activeGrants.some(g => g.id === binding.grantId)) { cleared.push(i); return null; } return binding;
  }) as CombatLoadout['active'];
  return cleared;
}
/** Runs every check on a copy; returns the copy only when it is valid. Never mutates `run`. */
function candidate(run: Run, change: (c: Run) => void, build: Build, catalog: readonly PartSpec[]): { run: Run; cleared: number[] } | Failure {
  const c = structuredClone(run); change(c); const cleared = clearMissing(c, catalog);
  const issues = validateRun(c, build, catalog); return issues.length ? { ok: false, reason: `Internal check failed: ${issues[0]}` } : { run: c, cleared };
}
const notEnough = (tx: { shortfall: number; invalid?: string[] }): Failure =>
  tx.invalid ? { ok: false, reason: `Internal check failed: ${tx.invalid[0]}` } : { ok: false, reason: 'Not enough DNA.', shortfall: tx.shortfall };
/** Applies an editor design on the current plan. The ledger pays for it. Nothing changes unless every check passes. */
export function applyDesign(run: Run, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Commit {
  const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
  const issue = problems(g, currentPlan(run), { unlocked: run.unlocked, diet: run.diet, anchorCheck: build.anchorCheck }, catalog).find(x => x.code !== 'dna');
  if (issue) return { ok: false, reason: issue.message };
  const tx = commitDesign(run.economy, run.genome, g);
  if (!tx.ok) return notEnough(tx);
  const next = candidate(run, c => { c.economy = tx.economy; c.genome = cloneGenome(g); c.name = name.trim().slice(0, 24) || c.name;
    c.nextPartSerial = serialAfter(g, c.nextPartSerial, nextSerial); c.health = Math.min(c.health, maxHealthOf(c)); }, build, catalog);
  if ('ok' in next) return next;
  Object.assign(run, next.run); return { ok: true, clearedBindings: next.cleared };
}
/** Checks an evolution and prices it. It never changes `run`. */
export function prepareEvolution(run: Run, planId: string, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Prepared | Failure {
  const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
  if (!evolveReady(run)) return { ok: false, reason: 'Not ready to evolve.' };
  const next = eligibleChildren(run.plans, build).find(p => p.id === planId); if (!next) return { ok: false, reason: 'That path is not open.' };
  const diet = dietOf(g), issue = problems(g, next, { unlocked: run.unlocked, diet, anchorCheck: build.anchorCheck }, catalog).find(x => x.code !== 'dna');
  if (issue) return { ok: false, reason: issue.message };
  const tx = commitDesign(run.economy, run.genome, g);
  if (!tx.ok) return notEnough(tx);
  const prepared: Prepared = { planId, genome: cloneGenome(g), name: name.trim().slice(0, 24) || run.name, economy: tx.economy, diet, nextSerial: serialAfter(g, run.nextPartSerial, nextSerial) };
  const check = candidate(run, c => applyEvolution(c, prepared), build, catalog);
  return 'ok' in check ? check : prepared;
}
function applyEvolution(c: Run, p: Prepared) {
  c.economy = bankAll(p.economy); c.genome = cloneGenome(p.genome); c.name = p.name; c.diet = p.diet; c.plans.push(p.planId);
  c.stage++; c.stageDna = 0; c.nextPartSerial = Math.max(c.nextPartSerial, p.nextSerial); c.health = maxHealthOf(c);
}
/** Applies a validated Prepared atomically. Returns the cleared binding slots. */
export function commitEvolution(run: Run, p: Prepared, catalog: readonly PartSpec[] = PARTS): number[] {
  const c = structuredClone(run); applyEvolution(c, p); const cleared = clearMissing(c, catalog); Object.assign(run, c); return cleared;
}
/** THE FAINT RULE: the one place that decides what a faint takes (spec §10.3). Change it here only.
 *  - R7 (owner's rule): a faint is a soft respawn, and all DNA collected at the current size is lost (the at-risk wallet).
 *  - D20 (spec-writer decision, to be confirmed by the owner with the probe results): the growth bar also resets to 0, and the at-risk
 *    credit of the parts bought at this size is lost (`faintCombat` zeroes it).
 *  Basis, banked credit, the design and the parts stay. */
export function applyFaintRule(run: Run): void { run.economy = faintCombat(run.economy); run.stageDna = 0; }
/** The faint, once: THE FAINT RULE and a pending respawn. A second call while a respawn is pending changes nothing. */
export function faint(run: Run): boolean {
  if (run.pendingRespawn) return false;
  run.deaths++; applyFaintRule(run); run.pendingRespawn = true; return true;
}

const int = (v: unknown, min = 0) => Number.isInteger(v) && (v as number) >= min;
const finite = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const safe = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function validPlanets(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(id => Number.isInteger(id) && id >= 0 && id < PLANET_COUNT) && new Set(v).size === v.length;
}
/** Every rule a run must keep. A candidate that passes here reloads unchanged. Returns the issues, empty when valid. */
export function validateRun(run: Run, build: Build, catalog: readonly PartSpec[] = PARTS): string[] {
  if (!isObject(run) || sanitizeGenome(run.genome) === null) return ['genome shape'];
  const out: string[] = [];
  if (!safe(run.seed) || typeof run.name !== 'string') out.push('identity');
  if (!safe(run.stage) || run.stage > 4) out.push('stage');
  for (const [key, v] of [['stageDna', run.stageDna], ['totalDna', run.totalDna], ['bites', run.bites], ['deaths', run.deaths]] as const) if (!safe(v)) out.push(`counter ${key}`);
  if (!finite(run.elapsed)) out.push('counter elapsed');
  if (typeof run.completed !== 'boolean' || !validPlanets(run.eatenPlanets)) out.push('progress');
  else if ((run.stage !== 4 && run.eatenPlanets.length) || (run.completed && (run.stage !== 4 || run.eatenPlanets.length !== PLANET_COUNT))) out.push('progress');
  if (!Array.isArray(run.unlocked) || !run.unlocked.every(id => typeof id === 'string' && part(id))) out.push('unlocked');
  // Path: root, one plan per stage, parents, commitments and closed lines.
  const path = run.plans, steps = Array.isArray(path) ? path.map(id => plan(id)) : [];
  let pathOk = Array.isArray(path) && path.length > 0 && steps.every(Boolean);
  if (!pathOk) out.push('path unknown');
  else {
    const before = out.length;
    if (path[0] !== ROOT_PLAN) out.push('path root');
    if (path.length !== run.stage + 1) out.push('path length');
    steps.forEach((p, i) => {
      if (p!.size !== i) out.push(`path size ${p!.id}`);
      if (i === 0) return;
      if (!p!.parents.includes(path[i - 1]!)) out.push(`path parent ${p!.id}`);
      if (commitmentsOf(path.slice(0, i)).some(c => violates(p!, c))) out.push(`path commitment ${p!.id}`);
      if (closedLinesOf(path.slice(0, i)).includes(p!.line)) out.push(`path closed ${p!.id}`);
    });
    if (steps.some(p => p!.needs === 'coast') && !build.coast) out.push('needs coast');
    pathOk = out.length === before;
  }
  if (!safe(run.nextPartSerial) || run.genome.parts.some(p => run.nextPartSerial <= uidSerial(p.uid))) out.push('serial');
  out.push(...validateLedger(run.economy, run.genome));
  if (pathOk) {
    if (run.diet !== dietOf(run.genome)) out.push('diet');
    for (const x of problems(run.genome, currentPlan(run), { unlocked: run.unlocked, diet: run.diet }, catalog).filter(x => x.code !== 'dna' && x.code !== 'anchor')) out.push(`design ${x.code}: ${x.message}`);
    if (!finite(run.health) || run.health > maxHealthOf(run) || !Number.isInteger(run.health * 2)) out.push('health');
  }
  const active = run.loadout?.active;
  if (!isObject(run.loadout) || !Array.isArray(active) || active.length !== 2) out.push('loadout');
  else {
    active.forEach((b, i) => {
      if (b === null) return;
      if (!isObject(b) || Object.keys(b).length !== 2 || typeof b.partUid !== 'string' || typeof b.grantId !== 'string') { out.push(`loadout ${i}: shape`); return; }
      const placed = run.genome.parts.find(p => p.uid === b.partUid);
      if (!placed) out.push(`loadout ${i}: part ${b.partUid}`);
      else if (!catalog.find(s => s.id === placed.id)?.activeGrants.some(g => g.id === b.grantId)) out.push(`loadout ${i}: grant ${b.grantId}`);
    });
    const [x, y] = active as unknown[];
    if (isObject(x) && isObject(y) && x.partUid === y.partUid && x.grantId === y.grantId) out.push('loadout: duplicate binding');
  }
  if (typeof run.pendingRespawn !== 'boolean') out.push('pendingRespawn');
  if (!isObject(run.mechanics)) out.push('mechanics');
  if (!Array.isArray(run.archive) || !run.archive.every(a => isObject(a) && sanitizeGenome(a.genome) !== null && typeof a.name === 'string' && typeof a.savedAt === 'string' && typeof a.reason === 'string')) out.push('archive');
  if (!Array.isArray(run.notices) || !run.notices.every(n => typeof n === 'string')) out.push('notices');
  return out;
}

/** What a v1 or v2 save keeps. A7 turns it into a v4 run. `genomeRaw` is the genome as saved, unchecked. */
export interface LegacyRunV2 {
  stage: number; dna: number; stageDna: number; totalDna: number; bites: number; elapsed: number; deaths: number; health: number; seed: number; name: string;
  unlocked: string[]; eatenPlanets: number[]; completed: boolean; genomeRaw: unknown;
}
/** Reads a v2 save into the legacy shape. Returns null for anything inconsistent. */
export function readLegacyV2(v: Record<string, unknown>): LegacyRunV2 | null {
  if (v.version !== 2 || !isObject(v.genome) || !int(v.seed) || typeof v.name !== 'string' || !int(v.stage) || (v.stage as number) > 4 || !finite(v.dna) || !finite(v.stageDna) || !finite(v.totalDna) ||
      !int(v.bites) || !finite(v.elapsed) || !int(v.deaths) || !finite(v.health) || typeof v.completed !== 'boolean' || !validPlanets(v.eatenPlanets) ||
      !Array.isArray(v.unlocked) || !v.unlocked.every(id => typeof id === 'string' && part(id))) return null;
  const stage = v.stage as number, planets = v.eatenPlanets as number[];
  if ((stage !== 4 && planets.length) || (v.completed && (stage !== 4 || planets.length !== PLANET_COUNT))) return null;
  return { stage, dna: v.dna as number, stageDna: v.stageDna as number, totalDna: v.totalDna as number, bites: v.bites as number, elapsed: v.elapsed as number, deaths: v.deaths as number,
    health: v.health as number, seed: v.seed as number, name: (v.name as string).slice(0, 24) || 'Little Tide', unlocked: [...v.unlocked as string[]], eatenPlanets: [...planets], completed: v.completed as boolean, genomeRaw: v.genome };
}
const V1_GOALS = [10, 12, 14, 16, 12];
/** v1 saved a fixed form and a bite count. Keep the stage, the planets and the time. */
export function readLegacyV1(v: Record<string, unknown>): LegacyRunV2 | null {
  if (!int(v.stage) || (v.stage as number) > 4 || !int(v.bites) || !int(v.total) || (v.total as number) < (v.bites as number) || !finite(v.elapsed) ||
      typeof v.completed !== 'boolean' || !validPlanets(v.eatenPlanets)) return null;
  const stage = v.stage as number, bites = v.bites as number, planets = v.eatenPlanets as number[];
  if (bites > V1_GOALS[stage]! || (stage === 4 && planets.length !== bites) || (stage !== 4 && planets.length) || (v.completed && (stage !== 4 || bites !== PLANET_COUNT))) return null;
  const stageDna = stage === 4 ? 0 : Math.round(bites / V1_GOALS[stage]! * STAGES[stage]!.goal), genome = starterGenome();
  return { stage, dna: START_DNA + stage * 30, stageDna, totalDna: stageDna + stage * 120, bites: v.total as number, elapsed: v.elapsed as number, deaths: 0,
    health: derive(effectiveStats(genome, plan(ROOT_PLAN)!)).maxHealth, seed: newSeed(), name: 'Little Tide', unlocked: [], eatenPlanets: [...planets], completed: v.completed as boolean,
    genomeRaw: { ...genome, parts: genome.parts.map(({ uid: _uid, ...legacy }) => legacy) } };
}

// ---- Saves: the strict v4 reader and the v1/v2 migration (spec section 11) ----
export type Loaded = { status: 'ok'; run: Run; notes: string[] } | { status: 'kept'; message: string };
const COAST_KEPT = 'This creature lives on the coast. The coast is not in this version yet; your save is kept.';
const DIETS: readonly string[] = ['herbivore', 'carnivore', 'omnivore'];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const isCredit = (c: unknown) => isObject(c) && typeof c.banked === 'number' && typeof c.atRisk === 'number';
/** Reads a v4 save. Every field is type-checked. Health above the current maximum is clamped. Returns null for anything malformed. */
function readV4(v: Record<string, unknown>): Run | null {
  if (v.version !== 4 || !strings(v.plans) || !DIETS.includes(v.diet as string) || !isObject(v.economy) || !isCredit(v.economy.wallet) || !isObject(v.economy.parts) ||
      !Object.values(v.economy.parts).every(l => isObject(l) && typeof l.basis === 'number' && isCredit(l.credit)) || !Number.isInteger(v.nextPartSerial) ||
      !isObject(v.loadout) || !Array.isArray(v.loadout.active) || typeof v.pendingRespawn !== 'boolean' || !isObject(v.mechanics) || !Array.isArray(v.archive) || !strings(v.notices) ||
      !strings(v.unlocked) || !Array.isArray(v.eatenPlanets) || typeof v.name !== 'string' || typeof v.health !== 'number') return null;
  const genome = sanitizeGenome(v.genome); if (!genome) return null;
  const archive: ArchivedDesign[] = [];
  for (const a of v.archive) {
    if (!isObject(a) || typeof a.name !== 'string' || typeof a.savedAt !== 'string' || typeof a.reason !== 'string') return null;
    const g = sanitizeGenome(a.genome); if (!g) return null;
    archive.push({ genome: g, name: a.name, savedAt: a.savedAt, reason: a.reason });
  }
  // Only the Run fields (final review M18): an unknown top-level key is dropped, so it is never written back.
  const run = { version: 4, seed: v.seed, name: v.name, stage: v.stage, plans: v.plans, diet: v.diet, economy: v.economy, stageDna: v.stageDna, totalDna: v.totalDna,
    bites: v.bites, elapsed: v.elapsed, deaths: v.deaths, health: v.health, genome, nextPartSerial: v.nextPartSerial, unlocked: v.unlocked, eatenPlanets: v.eatenPlanets,
    completed: v.completed, loadout: v.loadout, pendingRespawn: v.pendingRespawn, mechanics: v.mechanics, archive, notices: v.notices } as unknown as Run;
  // Health has .5 steps (spec §10.1): a value between them rounds to the nearest half heart, at least .5.
  if (run.plans.length && run.plans.every(id => plan(id)) && Number.isFinite(run.health)) { const max = maxHealthOf(run); run.health = run.health <= 0 ? max : Math.max(.5, Math.min(Math.round(run.health * 2) / 2, max)); }
  return run;
}
const count = (v: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v)));
type Candidate = { path: string[]; genome: Genome; changes: string[]; nextSerial: number };
function pathsOf(length: number, line: string): string[][] {
  let paths: string[][] = [[ROOT_PLAN, line]];
  while (paths[0]!.length < length) paths = paths.flatMap(path => eligibleChildren(path, { coast: false }).map(p => [...path, p.id]));
  return paths;
}
/** The lowest score wins. Order: kept value, diet, exact fit, segment count, segment shape, moved parts, path order. */
function scoreOf(original: Genome, c: Candidate, index: number): number[] {
  const kept = new Map(c.genome.parts.map(p => [p.uid, p]));
  const keptCost = original.parts.reduce((n, p) => n + (kept.has(p.uid) ? partCost(p) : 0), 0);
  let shape = 0; for (let i = 0; i < Math.min(original.spine.length, c.genome.spine.length); i++) {
    const a = original.spine[i]!, b = c.genome.spine[i]!; shape += Math.abs(a.radius - b.radius) + Math.abs(a.height - b.height) + Math.abs(a.lift - b.lift);
  }
  const moved = original.parts.filter(p => { const q = kept.get(p.uid); return q && (q.t !== p.t || q.angle !== p.angle || q.scale !== p.scale); }).length;
  return [-keptCost, dietOf(c.genome) === dietOf(original) ? 0 : 1, JSON.stringify(c.genome) === JSON.stringify(original) ? 0 : 1, Math.abs(c.genome.spine.length - original.spine.length), shape, moved, index];
}
const before = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!; return false; };
/** Turns a v1/v2 save into a v4 run. The original design goes to the archive. Throws when the legacy genome cannot be repaired. */
export function migrateV2(old: LegacyRunV2, _build: Build): Run { return migrate(old).run; }
function migrate(old: LegacyRunV2): { run: Run; notes: string[] } {
  const original = repairLegacyGenome(old.genomeRaw); if (!original) throw new Error('Legacy genome cannot be repaired.');
  const kindOf = (id: string) => part(id)?.kind, legs = original.parts.some(p => kindOf(p.id) === 'leg'), tail = original.parts.some(p => kindOf(p.id) === 'tail');
  const line = legs && !tail ? 'crawler' : 'swimmer', diet = dietOf(original), maxSerial = Math.max(0, ...original.parts.map(p => uidSerial(p.uid)));
  const paths = old.stage === 0 ? [[ROOT_PLAN]] : pathsOf(old.stage + 1, line);
  let best: { c: Candidate; score: number[] } | null = null;
  paths.forEach((path, index) => {
    const r = adaptToPlan(original, plan(path.at(-1)!)!, { unlocked: old.unlocked, diet }, maxSerial + 1); if (!r.ok) return;
    const c: Candidate = { path, genome: r.genome, changes: r.changes, nextSerial: r.nextSerial }, score = scoreOf(original, c, index);
    if (!best || before(score, best.score)) best = { c, score };
  });
  const chosen = best as { c: Candidate } | null, path = chosen?.c.path ?? paths[0] ?? [ROOT_PLAN], finalPlan = plan(path.at(-1)!)!;
  const adapted = chosen?.c.genome ?? starterFor(finalPlan), notes = [`${old.name} became a ${finalPlan.name}.`];
  if (chosen) notes.push(...chosen.c.changes); else notes.push(`Your old design could not fit a ${finalPlan.name}; it is saved in your archive.`);
  let economy = legacyEconomy(count(old.dna), original), tx = commitDesign(economy, original, adapted);
  if (!tx.ok && !tx.invalid) {
    economy = { ...economy, wallet: { ...economy.wallet, banked: economy.wallet.banked + tx.shortfall } }; notes.push(`We covered ${tx.shortfall} DNA for required parts.`);
    tx = commitDesign(economy, original, adapted);
  }
  if (!tx.ok) throw new Error('Legacy ledger cannot be built.');
  const used = Math.max(maxSerial, ...adapted.parts.map(p => uidSerial(p.uid)), (chosen?.c.nextSerial ?? 1) - 1);
  const run: Run = { version: 4, seed: old.seed, name: old.name, stage: old.stage, plans: path, diet: dietOf(adapted), economy: tx.economy, stageDna: count(old.stageDna), totalDna: count(old.totalDna),
    bites: count(old.bites), elapsed: Math.max(0, old.elapsed), deaths: count(old.deaths), health: 0, genome: adapted, nextPartSerial: used + 1, unlocked: [...old.unlocked], eatenPlanets: [...old.eatenPlanets],
    completed: old.completed, loadout: { active: [null, null] }, pendingRespawn: false, mechanics: {},
    archive: [{ genome: original, name: old.name, savedAt: new Date().toISOString(), reason: 'Saved before the body-plan update.' }], notices: notes };
  const max = maxHealthOf(run); run.health = old.health <= 0 ? max : Math.max(1, Math.min(old.health, max));
  return { run, notes };
}
/** Reads any save. Null means no save or unreadable data. */
export function parseSaveWithNotes(raw: string | null, build: Build, catalog: readonly PartSpec[] = PARTS): Loaded | null {
  if (!raw) return null;
  let v: unknown; try { v = JSON.parse(raw); } catch { return null; }
  if (!isObject(v)) return null;
  if (v.version === 4) {
    const run = readV4(v); if (!run) return null;
    const issues = validateRun(run, build, catalog);
    if (issues.length === 1 && issues[0] === 'needs coast') return { status: 'kept', message: COAST_KEPT };
    return issues.length ? null : { status: 'ok', run, notes: run.notices };
  }
  const old = v.version === 2 ? readLegacyV2(v) : v.version === undefined ? readLegacyV1(v) : null; if (!old) return null;
  try { const { run, notes } = migrate(old); return validateRun(run, build, catalog).length ? null : { status: 'ok', run, notes }; } catch { return null; }
}
/** The run from a save, or null (tests). */
export function parseSave(raw: string | null, build: Build = { coast: false }): Run | null {
  const loaded = parseSaveWithNotes(raw, build); return loaded?.status === 'ok' ? loaded.run : null;
}
