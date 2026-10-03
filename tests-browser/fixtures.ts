// Development-only fixture page for the Tiny Tide browser tests (served by the dev server; vite.config.ts adds it to the
// build input only in development mode). Saves are built with the game's own modules, so goals, costs and ledgers come
// from the code: freshRun, adaptToPlan, applyDesign, prepareEvolution and commitEvolution.
import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, freshRun, growthOf, maxHealthOf, prepareEvolution, STAGES, validateRun, type Build, type Run } from '../src/tiny-tide/state';
import { adaptToPlan, cloneGenome, derive, effectiveStats, nextUid, starterGenome, uidSerial, type Genome } from '../src/tiny-tide/genome';
import { COAST_READY, eligibleChildren, plan as planById, type BodyPlan } from '../src/tiny-tide/plans';
import { quoteDesign } from '../src/tiny-tide/economy';
import { PLAYER_HALF, SIZES } from '../src/tiny-tide/biomes';
import { stageBounds, stageWorldQueries } from '../src/tiny-tide/world-queries';
import { startAnchor } from '../src/tiny-tide/motion';
import { playerActor } from '../src/tiny-tide/mount';
import { Ecosystem, entityRadius } from '../src/tiny-tide/ecosystem';
import { recoverPlayer } from '../src/tiny-tide/lifecycle';
import { BREACH_REACH } from '../src/tiny-tide/player-motion';
import { orientHull } from '../src/tiny-tide/orientation';
import { PARTS, part } from '../src/tiny-tide/parts';
import type { Actor, SlotPin, Tuple4, Vec3, WorldQueries } from '../src/tiny-tide/combat-types';

const SAVE_KEY = 'tiny-tide-adventure-v4';
const LINES: Record<'swimmer' | 'crawler', string[]> = { swimmer: ['swimmer', 'darter', 'sky_drifter', 'star_swimmer'], crawler: ['crawler', 'shellback', 'colossus', 'star_crawler'] };

interface Legality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
const legalities = new Map<string, Legality>();
/** The player's world queries (with the world seed's reef solids) and bounds for a stage, as in the game (main.ts `legality`). */
function legality(stage: number, seed: number): Legality {
  let l = legalities.get(`${seed}:${stage}`);
  if (!l) {
    l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) };
    legalities.set(`${seed}:${stage}`, l);
  }
  return l;
}
/** The game's build (main.ts `BUILD`). A coast build (kept-save fixtures) has no anchor check: this world has no coast to stand on. */
const buildOf = (coast: boolean, seed: number): Build => coast ? { coast } : { coast, anchorCheck: (g, p) => [1, 1.38].every(growth => startAnchor(playerActor(p, g, p.size, growth), p.size, legality(p.size, seed)).ok) };

interface PartIn { id: string; t?: number; angle?: number; scale?: number; mirror?: boolean; roll?: number }
export interface FixtureSpec {
  seed?: number;
  /** The plans after the Speck, in order (for example ['crawler', 'shellback']). Default: `line` up to `stage`. */
  path?: string[];
  stage?: number; line?: 'swimmer' | 'crawler';
  /** The growth bar is full (stageDna = goal). */
  ready?: boolean;
  /** The wallet afterwards (banked). Default: unchanged for a plain start, 100 when the fixture had to be paid for. */
  dna?: number;
  health?: number;
  /** The at-risk wallet afterwards (the faint check). */
  atRisk?: number;
  /** The growth bar afterwards; overrides `ready`. */
  stageDna?: number;
  /** Parts added to the design of a stage before it is committed (stage 0: through applyDesign). */
  add?: Record<number, PartIn[]>;
  /** The mouth of a stage's design. */
  mouth?: Record<number, string>;
  /** The run's slot pins (spec §7.2): four entries, each null or a kind the final design grants. */
  pins?: Tuple4<SlotPin>;
  /** Builds a coast path (a kept save in this version). */
  coast?: boolean;
  pendingRespawn?: boolean;
  unlocked?: string[];
  /** A legacy save instead of a v4 run; `legacyFields` replace its fields. */
  legacy?: 'v1' | 'v2'; legacyFields?: Record<string, unknown>;
}
export interface Fixture { key: string; json: string; run: Run | null; info: Record<string, unknown> }

/** The design of one stage: the mouth and the added parts, with fresh serials. */
function design(g: Genome, serial: number, mouth: string | undefined, add: readonly PartIn[] | undefined): { genome: Genome; next: number } {
  const out = cloneGenome(g);
  if (mouth) { const m = out.parts.find(p => part(p.id)?.kind === 'mouth'); if (!m) throw new Error('fixture: no mouth to swap'); m.id = mouth; }
  for (const x of add ?? []) {
    const spec = part(x.id); if (!spec) throw new Error(`fixture: unknown part ${x.id}`);
    out.parts.push({ uid: nextUid(serial++), id: x.id, t: x.t ?? spec.t, angle: x.angle ?? spec.angle, scale: x.scale ?? 1, mirror: x.mirror ?? spec.mirror, roll: x.roll ?? 0 });
  }
  return { genome: out, next: serial };
}

function legacyFixture(kind: 'v1' | 'v2', seed: number, fields: Record<string, unknown> = {}): Fixture {
  if (kind === 'v1') {
    const v1 = { stage: 1, bites: 0, total: 10, elapsed: 20, eatenPlanets: [], completed: false, ...fields };
    return { key: 'tiny-tide-adventure-v1', json: JSON.stringify(v1), run: null, info: {} };
  }
  const g = starterGenome();
  const v2 = { version: 2, seed, name: 'Old Tide', stage: 0, dna: 30, stageDna: 10, totalDna: 10, bites: 1, elapsed: 30, deaths: 0, health: 6, completed: false,
    eatenPlanets: [], unlocked: [], genome: { ...g, parts: g.parts.map(({ uid: _uid, ...legacy }) => legacy) }, ...fields };
  return { key: 'tiny-tide-adventure-v2', json: JSON.stringify(v2), run: null, info: {} };
}

export function makeFixture(spec: FixtureSpec = {}): Fixture {
  const seed = spec.seed ?? 1501;
  if (spec.legacy) return legacyFixture(spec.legacy, seed, spec.legacyFields);
  const catalog = PARTS, build = buildOf(!!spec.coast, seed);
  const run = freshRun(seed);
  run.unlocked = [...(spec.unlocked ?? [])];
  const path = spec.path ?? LINES[spec.line ?? 'swimmer'].slice(0, spec.stage ?? 0);
  let funded = false;
  /** Construction money, so that every design is affordable; the wallet is set at the end. */
  const fund = () => { if (!funded) { run.economy = { ...run.economy, wallet: { banked: run.economy.wallet.banked + 100000, atRisk: 0 } }; funded = true; } };
  // A size-0 mouth is the start's choice: it is set on the fresh run with its diet (applyDesign refuses a diet change between evolutions).
  if (spec.mouth?.[0]) {
    const m = run.genome.parts.find(p => part(p.id)?.kind === 'mouth'); if (!m) throw new Error('fixture: no mouth to swap');
    m.id = spec.mouth[0]; run.diet = part(spec.mouth[0])?.diet ?? run.diet;
  }
  if (spec.add?.[0]) {
    fund();
    const d = design(run.genome, run.nextPartSerial, undefined, spec.add?.[0]);
    const r = applyDesign(run, d.genome, run.name, build, d.next, catalog);
    if (!r.ok) throw new Error(`fixture: stage 0 design: ${r.reason}`);
  }
  path.forEach((id, i) => {
    const next = planById(id); if (!next) throw new Error(`fixture: unknown plan ${id}`);
    fund(); run.stageDna = STAGES[run.stage]!.goal;
    const a = adaptToPlan(run.genome, next, { unlocked: run.unlocked, anchorCheck: build.anchorCheck }, run.nextPartSerial);
    if (!a.ok) throw new Error(`fixture: ${id}: ${a.reasons[0]}`);
    const d = design(a.genome, a.nextSerial, spec.mouth?.[i + 1], spec.add?.[i + 1]);
    const prepared = prepareEvolution(run, id, d.genome, run.name, build, d.next, catalog);
    if (!('planId' in prepared)) throw new Error(`fixture: ${id}: ${prepared.reason}`);
    commitEvolution(run, prepared, catalog);
  });
  if (spec.dna !== undefined || funded || spec.atRisk !== undefined) run.economy = { ...run.economy, wallet: { banked: spec.dna ?? (funded ? 100 : run.economy.wallet.banked), atRisk: spec.atRisk ?? 0 } };
  if (spec.pins) run.loadout = { slots: [...spec.pins] as Tuple4<SlotPin> };
  run.stageDna = spec.stageDna ?? (spec.ready && run.stage < 4 ? STAGES[run.stage]!.goal : 0);
  run.health = spec.health ?? maxHealthOf(run);
  run.pendingRespawn = !!spec.pendingRespawn;
  const issues = validateRun(run, build, catalog);
  if (issues.length) throw new Error(`fixture: invalid run: ${issues.join(', ')}`);
  return { key: SAVE_KEY, json: JSON.stringify(run), run, info: infoOf(run, build) };
}

/** Facts the tests compare with: they come from the same code the game runs. */
function infoOf(run: Run, build: Build) {
  const p = currentPlan(run), d = derive(effectiveStats(run.genome, p));
  const children = eligibleChildren(run.plans, { coast: COAST_READY }).map((c: BodyPlan) => {
    const a = adaptToPlan(run.genome, c, { unlocked: run.unlocked, anchorCheck: build.anchorCheck }, run.nextPartSerial);
    return { id: c.id, ok: a.ok, changes: a.ok ? a.changes : a.reasons, uids: a.ok ? a.genome.parts.map(x => x.uid) : [], quote: a.ok ? quoteDesign(run.economy, run.genome, a.genome) : null };
  });
  return { plan: p.id, stage: run.stage, armor: d.armor, maxHealth: d.maxHealth, uids: run.genome.parts.map(x => x.uid), parts: run.genome.parts.map(x => ({ uid: x.uid, id: x.id })),
    maxSerial: Math.max(0, ...run.genome.parts.map(x => uidSerial(x.uid))), nextPartSerial: run.nextPartSerial, children };
}

/** The smallest gap between an entity's contact sphere and the posed hull (≤ 0 is contact, as the ecosystem's hazard rule). */
function contactGap(e: Vec3, R: number, actor: Actor, at: Vec3): number {
  let best = Infinity;
  for (const c of orientHull(actor.hull, { yaw: 0, pitch: 0 })) {
    const a = { x: c.start.x + at.x, y: c.start.y + at.y, z: c.start.z + at.z }, b = { x: c.end.x + at.x, y: c.end.y + at.y, z: c.end.z + at.z };
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, len2 = abx * abx + aby * aby + abz * abz;
    const f = len2 > 0 ? Math.max(0, Math.min(1, ((e.x - a.x) * abx + (e.y - a.y) * aby + (e.z - a.z) * abz) / len2)) : 0;
    best = Math.min(best, Math.hypot(e.x - a.x - abx * f, e.y - a.y - aby * f, e.z - a.z - abz * f) - (R + c.radius));
  }
  return best;
}

/** `touching` (T18, check 15 on the ray): a start straight above the home (or at it) whose hull already touches the entity's contact
 *  sphere, within BREACH_REACH × L of the surface (a Breach can start there). The ray lives just above the seabed, so no start fits below it. */
export interface HazardSpec { stage: number; key: string; below?: boolean; touching?: boolean; minLeadSeconds?: number; fixture?: FixtureSpec }
export interface HazardPick { seed: number; entityId: number; home: Vec3; start: Vec3; separation?: number; lead?: number }
/** Scans seeds 1–50 with an installed Ecosystem for the first live entity of `key` whose home is inside the playable square with a
 *  10-unit margin. With `below`, the entity also needs a legal player start straight below it whose no-input lead-in is at least
 *  `minLeadSeconds` at the entity's speed (separation ≥ contact distance + speed × lead), checked with the game's admission and
 *  recovery. Positions are stage-local. The player is the fixture's (default: `makeFixture({ stage })`). */
export function pickHazard(h: HazardSpec): HazardPick | null {
  const size = SIZES[h.stage]!, margin = (PLAYER_HALF - 10) * size;
  const fx = makeFixture(h.fixture ?? { stage: h.stage }).run!, plan = currentPlan(fx), actor = playerActor(plan, fx.genome, h.stage, growthOf(fx));
  const o = { yaw: 0, pitch: 0 }, L = actor.bodyLength;
  const local = (v: Vec3): Vec3 => ({ x: v.x / size, y: v.y / size, z: v.z / size });
  for (let seed = 1; seed <= 50; seed++) {
    const eco = new Ecosystem(seed), legal = legality(h.stage, seed);
    let anchor: ReturnType<typeof startAnchor> | null = null, settled = false;
    for (const e of eco.entities) {
      if (e.spec.key !== h.key || e.eaten || Math.abs(e.hx) > margin || Math.abs(e.hz) > margin) continue;
      const home = { x: e.hx, y: e.hy, z: e.hz };
      if (h.touching) {
        // The entity where it stands once its tier is active: one ecosystem step settles it (a ground mover drops onto the seabed, below
        // a placed landmark height), as the game's first frame after the held start does.
        if (!settled) { eco.step({ stage: h.stage, dt: 1 / 60, now: 0, player: { x: 0, y: 1e6, z: 0 }, playerHull: [], perceivable: false, stealthFactor: 1, unlocked: [] }); settled = true; }
        if (e.eaten) continue;
        const R = entityRadius(e), surface = legal.queries.terrain.surface, at0 = { x: e.x, y: e.y, z: e.z };
        for (let k = 0; k < 400; k++) {
          const at = { x: at0.x, y: at0.y + k * .02 * L, z: at0.z }, gap = contactGap(at0, R, actor, at);
          if (gap > -.3 * R) break;   // well inside the contact sphere: the first frame's rise and drift keep the contact
          if (surface - at.y > BREACH_REACH * L) continue;
          if (!legal.queries.overlapHull(actor, at, o, { time: 0, permit: null, bounds: legal.bounds }).ok) continue;
          anchor ??= startAnchor(actor, h.stage, legal);
          const rec = recoverPlayer(actor, at, o, { ...legal, time: 0 }, anchor, 20 * L);
          if (!rec.ok || Math.hypot(rec.position.x - at.x, rec.position.y - at.y, rec.position.z - at.z) > 1e-9) continue;
          return { seed, entityId: e.id, home: local(at0), start: local(at), separation: gap / size };
        }
        continue;
      }
      if (!h.below) return { seed, entityId: e.id, home: local(home), start: local(home) };
      const R = entityRadius(e), lead = e.spec.speed * SIZES[e.spec.tier]! * (h.minLeadSeconds ?? 0);
      // The highest start straight below the home that keeps the lead-in and is admitted.
      for (let k = 0; k < 400; k++) {
        const at = { x: home.x, y: home.y - k * .02 * L, z: home.z }, gap = contactGap(home, R, actor, at);
        if (gap < lead) continue;
        if (!legal.queries.overlapHull(actor, at, o, { time: 0, permit: null, bounds: legal.bounds }).ok) continue;
        // forcedSpawn recovers the start; an admitted start must come back unchanged.
        anchor ??= startAnchor(actor, h.stage, legal);
        const rec = recoverPlayer(actor, at, o, { ...legal, time: 0 }, anchor, 20 * L);
        if (!rec.ok || Math.hypot(rec.position.x - at.x, rec.position.y - at.y, rec.position.z - at.z) > 1e-9) continue;
        return { seed, entityId: e.id, home: local(home), start: local(at), separation: gap / size, lead: lead / size };
      }
    }
  }
  return null;
}

/** The pose the game's `forcedSpawn` start computes for a fixture: `recoverPlayer` from a stage-local point with the start anchor's
 *  orientation, `20 × L` and the anchor fallback (main.ts `begin`). Also the anchor. Positions are physical. */
export function forcedStart(spec: FixtureSpec, local: Vec3): { start: Vec3 | null; anchor: Vec3 | null } {
  const run = makeFixture(spec).run!, plan = currentPlan(run), size = SIZES[run.stage]!, legal = legality(run.stage, run.seed);
  const actor = playerActor(plan, run.genome, run.stage, growthOf(run)), anchor = startAnchor(actor, run.stage, legal);
  if (!anchor.ok) return { start: null, anchor: null };
  const rec = recoverPlayer(actor, { x: local.x * size, y: local.y * size, z: local.z * size }, anchor.orientation, { ...legal, time: 0 }, anchor, 20 * actor.bodyLength);
  return { start: rec.ok ? rec.position : null, anchor: anchor.position };
}

declare global { interface Window { makeFixture: typeof makeFixture; pickHazard: typeof pickHazard; damageAfterArmor: typeof damageAfterArmor; forcedStart: typeof forcedStart } }
window.makeFixture = makeFixture;
window.pickHazard = pickHazard;
window.damageAfterArmor = damageAfterArmor;
window.forcedStart = forcedStart;
document.body.dataset.ready = 'true';
