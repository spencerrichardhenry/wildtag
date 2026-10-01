# Tiny Tide Evolution Core — Plan A: Evolution Rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure evolution rules: body geometry, the body-plan tree with lineage commitments and typed capability comparison, part identity, size-based cost and slots, effective stats, design problems and `adaptToPlan`, the DNA ledger with atomic transactions, and Run v4 with validation and v2 migration.

**Architecture:** Pure TypeScript modules with unit tests. No module in this plan reads the DOM or WebGL. Services that Plan B provides (start anchors) are injected as functions, so Plan A has no dependency on Plan B. `main.ts` and `editor.ts` change only where a signature change forces it; the game stays playable after every task.

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`), three.js 0.185 math, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md` (revision 4). Sections used: 2, 4, 5, 7, 8 (ledger), 11.

**Plan order:** Plan A → Plan B (`2026-10-01-tiny-tide-core-b-services.md`) → Plan C (`2026-10-01-tiny-tide-core-c-integration.md`).

## Global Constraints

- Repo `/Users/spencerhenry/projects/wildtag`, branch `tiny-tide-evolution`; paths are relative to it.
- Ask the user once, before Task A1, whether commits are approved. Without approval, skip every `git commit` line.
- Never touch Mineral Wage work (`src/miner/`, `e2e/miner*.mjs`, `tests/miner*.test.ts`, `mineral-wage.html`, `public/miner/`, `scripts/sc2/`, `docs/MINERAL-WAGE.md`, Mineral Wage lines of `README.md`).
- Dev server `http://127.0.0.1:5199` already runs; never start another on 5199.
- **Checkpoint after every task:** `npx tsc -b` (src) and `npx tsc -p tsconfig.tests.json` (src + Tiny Tide tests, created in A1) have no errors; `npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-core` passes; `node e2e/tiny-tide.mjs --visual-only` prints `{"errors":[]}`. Tasks that list extra browser scripts run them too.
- All DNA, cost, basis and credit values are non-negative safe integers.
- A task that removes the last use of an import or local removes the import or local in the same task.
- Numbers in tests are computed by hand from the formulas in the spec; every non-obvious number has its arithmetic in a comment.

## Review Focus

1. Editing an unchanged design after the future combat faint (all part credit forfeited) — expected: costs 0 DNA. Pinned in A5.
2. Resizing two parts in opposite directions with a zero wallet — expected: the result does not depend on array order and matches the quote. Pinned in A5.
3. A v2 starter with legs and a tail — expected: Swimmer line (rule: legs **and no tail** → Crawler); wallet 30 + refunded legs 14 = 44. Pinned in A7.
4. Adapting the starter to Shellback — expected: required armor goes to the middle; the eyes stay. Pinned in A4.
5. A Strider run — expected: its only eligible child is Dune giant; every complete path reaches size 4. Pinned in A2.

---

## Shared names produced by Plan A

```ts
// body-geometry.ts (A1)
SPACING; PART_SCALE; type Layout; layout(g); profile(g, l, z); zAt(l, t); point(g, l, t, angle, target?); surface(g, l, t, angle); partFrame(normal, roll?); locate(g, l, p)
// plans.ts (A2)
type Region; type Commitment; interface BodyPlan; PLANS; ROOT_PLAN; COAST_READY; plan(id); regionOf(t); segmentRule(p, i, n)
commitmentsOf(path, plans?); closedLinesOf(path, plans?); violates(p, c); eligibleChildren(path, build, plans?); leadsTo(p, path, build)
type CapabilityChange (typed union; each has good: boolean and rendered text); type WaterAccess; waterAccess(p); compareCapabilities(a, b): CapabilityChange[]; COMMIT_TEXT
cardSummary(a, b, path): { playstyle: string; cost: string; sacrifice: string }
// plans.ts also exports the habitat/movement facts it needs as plain data (A2) — Plan B's profiles.ts re-exports them:
HABITAT_FACTS: Record<string, { media: readonly Medium[]; maxDepth: number | null; floorGap: number | null; wading: number | null; surfaceBand: number | null }>; MOVEMENT_FACTS: Record<string, { mode; speed; acceleration; braking; yaw; pitch }>
// genome.ts (A3, A4)
PlacedPart.uid; uidSerial(uid); nextUid(serial); slotWeight(scale); partSlots(p); partCost(p); genomeCost(g); instanceCount(g)
partStats(g); effectiveStats(g, plan); derive(stats)  // maxHealth = max(3, 6 + round(health))
interface DesignContext { unlocked; diet?; budget?; anchorCheck?: (g: Genome, p: BodyPlan) => boolean }
problems(g, plan, ctx, catalog?) (alias validateDesign); adaptToPlan(g, plan, ctx, nextSerial): Adaptation; starterFor(plan): Genome; sanitizeGenome(raw); repairLegacyGenome(raw)
// economy.ts (A5)
interface PartLedger { basis; credit: DnaCredit }; interface Economy { wallet: DnaCredit; parts: Record<string, PartLedger> }
walletTotal(e); earn(e, n); legacyEconomy(dna, g); quoteDesign(e, from, to): Quote; commitDesign(e, from, to): { ok: true; economy } | { ok: false; shortfall; invalid? }; bankAll(e); faintLegacy(e); faintCombat(e); validateLedger(e, g): string[]
// state.ts (A6, A7)
Run (v4); dnaOf(run); currentPlan(run); freshRun(seed?); maxHealthOf(run); mealDna(plan, diet, spec); eat(run, spec, id); reward(run, dna, countsForStage); faint(run): boolean
interface Build { coast: boolean; anchorCheck?: DesignContext['anchorCheck'] }
applyDesign(run, g, name, build, nextSerial, catalog?): Commit; prepareEvolution(run, planId, g, name, build, nextSerial, catalog?): Prepared | failure; commitEvolution(run, prepared): number[]
validateRun(run, build, catalog?): string[]; parseSaveWithNotes(raw, build): Loaded | null
```

`DnaCredit` is defined in A5 (`economy.ts`) and re-exported by Plan B's `combat-types.ts`.

---

### Task A1: Pure body geometry module

**Files:**
- Create: `src/tiny-tide/body-geometry.ts`
- Modify: `src/tiny-tide/creature.ts` (move code out, re-export)
- Test: `tests/tiny-tide-core/geometry.test.ts`

**Interfaces:**
- Produces: `SPACING`, `PART_SCALE`, `Layout`, `layout`, `profile`, `zAt`, `point`, `surface`, `partFrame`, `locate` (signatures unchanged from today's `creature.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tiny-tide-core/geometry.test.ts
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { layout, locate, partFrame, surface } from '../../src/tiny-tide/body-geometry';
import { starterGenome } from '../../src/tiny-tide/genome';

describe('body geometry', () => {
  it('puts the front tip at t=0 facing forward and the rear tip at t=1 facing back', () => {
    const g = starterGenome(), l = layout(g);
    expect(surface(g, l, 0, 0).normal.z).toBe(1); expect(surface(g, l, 1, 0).normal.z).toBe(-1);
    expect(surface(g, l, 0, 0).position.z).toBeCloseTo(l.front);
  });
  it('locates a surface point back to its t and angle', () => {
    const g = starterGenome(), l = layout(g), back = locate(g, l, surface(g, l, .4, 1.1).position);
    expect(back.t).toBeCloseTo(.4, 2); expect(back.angle).toBeCloseTo(1.1, 1);
  });
  it('builds a right-handed part frame with +Y along the normal', () => {
    const q = partFrame(new T.Vector3(1, 0, 0)), y = new T.Vector3(0, 1, 0).applyQuaternion(q);
    expect(y.x).toBeCloseTo(1); expect(new T.Matrix4().makeRotationFromQuaternion(q).determinant()).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/geometry.test.ts`. Expected: FAIL, cannot resolve `body-geometry`.

- [ ] **Step 3: Add the test type-check config**

Create `tsconfig.tests.json`:

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "composite": false, "noEmit": true, "tsBuildInfoFile": null },
  "include": ["src", "src/**/*.json", "tests/tiny-tide.test.ts", "tests/tiny-tide-core"] }
```

Run `npx tsc -p tsconfig.tests.json`. Expected today: the existing Tiny Tide test file compiles (fix any pre-existing type error in `tests/tiny-tide.test.ts` in this step; it must compile before A2).

- [ ] **Step 4: Move the code**

Create `src/tiny-tide/body-geometry.ts` with this header, then move from `creature.ts` (unchanged) everything from `export const SPACING = .55;` to the end of `export function locate(...)`, except two lines: the `RINGS, SIDES` constant and the `FORWARD`/`UP` constant line (the header below defines `FORWARD` and `UP`; moving that line too would declare them twice):

```ts
// Pure body maths for a genome: spine layout, surface points and part frames.
import * as T from 'three';
import type { Genome } from './genome';

const FORWARD = new T.Vector3(0, 0, 1), UP = new T.Vector3(0, 1, 0);
```

In `creature.ts`, replace the moved code with an import of exactly the names `creature.ts` still uses, plus a re-export. Today `creature.ts` uses `layout`, `partFrame`, `PART_SCALE`, `SPACING`, `surface` and the type `Layout`:

```ts
import { layout, partFrame, PART_SCALE, SPACING, surface, type Layout } from './body-geometry';
export * from './body-geometry';
```

Remove `FORWARD` and `UP` from `creature.ts` (no remaining use there). Do not import `profile`.

- [ ] **Step 5: Checkpoint** (see Global Constraints). Expected: 3 new tests pass.

- [ ] **Step 6: Commit** `git add tsconfig.tests.json src/tiny-tide/body-geometry.ts src/tiny-tide/creature.ts tests && git commit -m "Tiny Tide: pure body geometry module and test type-checking"`

---

### Task A2: Body plans, commitments, eligibility and typed comparison

**Files:**
- Create: `src/tiny-tide/plans.ts`
- Test: `tests/tiny-tide-core/plans.test.ts`

**Interfaces:**
- Consumes: `PartKind`, `Stats` (`parts.ts`).
- Produces: see "Shared names" (plans.ts). `HABITAT_FACTS` and `MOVEMENT_FACTS` are the authoritative numeric facts for plan habitats and movement until Plan B's `profiles.ts` takes ownership (Plan B Task B2 makes them derived views of the profiles, with the same values).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/plans.test.ts
import { describe, expect, it } from 'vitest';
import { cardSummary, closedLinesOf, commitmentsOf, compareCapabilities, eligibleChildren, leadsTo, plan, PLANS, regionOf, ROOT_PLAN, segmentRule, violates, type BodyPlan } from '../../src/tiny-tide/plans';

const noCoast = { coast: false }, coast = { coast: true };
const completePaths = (build: { coast: boolean }, plans?: readonly BodyPlan[]) => {
  const out: string[][] = []; const walk = (path: string[]) => { const kids = eligibleChildren(path, build, plans); if (!kids.length) out.push(path); for (const k of kids) walk([...path, k.id]); };
  walk([ROOT_PLAN]); return out;
};
const texts = (a: string, b: string, good: boolean) => compareCapabilities(plan(a)!, plan(b)!).filter(c => c.good === good).map(c => c.text);

describe('body plans', () => {
  it('has unique ids, one root, and parents exactly one size lower', () => {
    expect(new Set(PLANS.map(p => p.id)).size).toBe(PLANS.length);
    expect(PLANS.filter(p => !p.parents.length).map(p => p.id)).toEqual([ROOT_PLAN]);
    for (const p of PLANS) for (const parent of p.parents) expect(plan(parent)!.size).toBe(p.size - 1);
  });
  it('makes every complete path reach size 4, with and without the coast', () => {
    for (const build of [noCoast, coast]) for (const path of completePaths(build)) expect(plan(path.at(-1)!)!.size, path.join('>')).toBe(4);
    expect(completePaths(noCoast)).toHaveLength(4);   // swimmer→darter|bulk, crawler→shellback|burrower
    expect(completePaths(coast)).toHaveLength(6);     // + shore_walker→strider→dune_giant, →mudskipper→shore_giant
  });
  it('gives both visible size-1 lines two size-2 choices', () => {
    expect(eligibleChildren([ROOT_PLAN], noCoast).map(p => p.id)).toEqual(['swimmer', 'crawler']);
    for (const id of ['swimmer', 'crawler']) expect(eligibleChildren([ROOT_PLAN, id], noCoast)).toHaveLength(2);
  });
  it('gives every size-1 line a lasting commitment that holds on every path', () => {
    for (const id of ['swimmer', 'crawler', 'shore_walker']) expect(plan(id)!.commits.length, id).toBeGreaterThan(0);
    for (const path of completePaths(coast)) for (let i = 1; i < path.length; i++)
      for (const c of commitmentsOf(path.slice(0, i))) expect(violates(plan(path[i]!)!, c), `${path.join('>')} ${c}`).toBe(false);
    expect(eligibleChildren([ROOT_PLAN, 'shore_walker', 'strider'], coast).map(p => p.id)).toEqual(['dune_giant']);
  });
  it('defines what each commitment forbids', () => {
    expect(violates(plan('sky_drifter')!, 'seabed-bound')).toBe(true); expect(violates(plan('colossus')!, 'seabed-bound')).toBe(false);
    expect(violates(plan('star_crawler')!, 'seabed-bound')).toBe(false); expect(violates(plan('mudskipper')!, 'no-swim')).toBe(true);
    expect(violates(plan('crawler')!, 'no-legs')).toBe(true); expect(violates(plan('star_swimmer')!, 'no-legs')).toBe(false);
    expect(violates(plan('sky_drifter')!, 'no-flight')).toBe(true); expect(violates(plan('dune_giant')!, 'no-flight')).toBe(false);
  });
  it('lets a keystone close a line, on eligibility', () => {
    // A probe child of Darter on the crawler line, with no legs and no commitment conflict: eligible until a keystone closes its line.
    const path = [ROOT_PLAN, 'swimmer', 'darter'], probe: BodyPlan = { ...plan('sky_drifter')!, id: 'probe', name: 'Probe', line: 'crawler' };
    const open: BodyPlan[] = [...PLANS, probe];
    expect(eligibleChildren(path, noCoast, open).map(p => p.id)).toEqual(['sky_drifter', 'probe']);
    const closed: BodyPlan[] = open.map(p => p.id === 'darter' ? { ...p, keystone: { closesLines: ['crawler'], note: 'test' } } : p);
    expect(closedLinesOf(path, closed)).toEqual(['crawler']); expect(eligibleChildren(path, noCoast, closed).map(p => p.id)).toEqual(['sky_drifter']);
  });
  it('maps t to regions with no mouth special case', () => {
    expect([0, .249, .25, .75, .751].map(regionOf)).toEqual(['head', 'head', 'middle', 'middle', 'tail']);
  });
  it('uses the head rule for the first segment and the tail rule for the last', () => {
    const s = plan('shellback')!; expect(segmentRule(s, 0, 5)).toBe(s.spine.head); expect(segmentRule(s, 4, 5)).toBe(s.spine.tail); expect(segmentRule(s, 2, 5)).toBe(s.spine.middle);
  });
});

describe('typed capability comparison', () => {
  const has = (a: string, b: string, text: string) => compareCapabilities(plan(a)!, plan(b)!).some(c => c.text === text);
  const fields = (a: BodyPlan, b: BodyPlan) => compareCapabilities(a, b).map(c => c.field);
  it('reports free swimming as a gain, never a lost seabed, and the legs commitment', () => {
    expect(texts('speck', 'swimmer', true)).toContain('Swims freely in open water');
    expect(texts('speck', 'swimmer', false).join(' ')).not.toMatch(/seabed/);
    expect(texts('speck', 'swimmer', false)).toContain('Can never grow legs again');
  });
  it('reports foraging, hearts with the base value, and per-region kinds', () => {
    expect(has('crawler', 'burrower', 'Seabed food ×1.4 (was ×1.25)')).toBe(true);
    expect(has('crawler', 'burrower', 'Hearts −1 (5 base)')).toBe(true);
    expect(has('crawler', 'burrower', 'No fins in the middle')).toBe(true);
  });
  it('reports speed, turning and braking separately', () => {
    expect(has('shellback', 'colossus', 'Faster (×0.85, was ×0.8)')).toBe(true); expect(has('shellback', 'colossus', 'Turns slower')).toBe(true); expect(has('shellback', 'colossus', 'Stops slower')).toBe(true);
  });
  it('reports forced body ranges per segment', () => {
    expect(has('swimmer', 'bulk', 'Middle at least 0.6 wide')).toBe(true); expect(has('swimmer', 'bulk', 'Middle at least 0.6 tall')).toBe(true);
    expect(has('swimmer', 'darter', 'Head at most 0.7 wide')).toBe(true); expect(has('swimmer', 'darter', 'Tail at most 0.6 wide')).toBe(true);
  });
  it('detects every field when it is the only change (single-field mutations)', () => {
    const base = plan('crawler')!;
    const cases: [Partial<BodyPlan>, string][] = [
      [{ movement: 'shellback' }, 'braking'], [{ movement: 'swimmer' }, 'pitch'], [{ habitat: 'shallow-shore' }, 'depthLimit'], [{ habitat: 'open-water' }, 'wading'],
      [{ regions: { ...base.regions, head: { ...base.regions.head, kinds: base.regions.head.kinds.filter(k => k !== 'armor') } } }, 'kind'],
      [{ regions: { ...base.regions, middle: { kinds: base.regions.middle.kinds.filter(k => k !== 'arm'), slots: 6 }, tail: { kinds: [...base.regions.tail.kinds, 'arm'], slots: 2 } } }, 'kind'],
      [{ spine: { ...base.spine, head: { radius: [.25, 1.2], height: [.4, 1.2] } } }, 'range'], [{ spine: { ...base.spine, middle: { radius: [.25, 1.2], height: [.4, .5] } } }, 'range'],
      [{ spine: { ...base.spine, middle: { ...base.spine.middle, locked: true } } }, 'locked'], [{ spine: { ...base.spine, min: 4 } }, 'segments'],
      [{ requiresKinds: [] }, 'requiresKind'], [{ requiresCapabilities: [{ stat: 'armor', min: 1, label: 'armor 1' }] }, 'requiresCapability'],
    ];
    for (const [patch, field] of cases) expect(fields(base, { ...base, ...patch }), JSON.stringify(patch).slice(0, 60)).toContain(field);
  });
  it('gives every plan at least one gain and one loss against its first parent', () => {
    for (const p of PLANS.filter(p => p.size > 0)) { const c = compareCapabilities(plan(p.parents[0]!)!, p); expect(c.some(x => x.good), `${p.id} gain`).toBe(true); expect(c.some(x => !x.good), `${p.id} loss`).toBe(true); }
  });
  it('builds card lines with this form\'s cost and the lasting sacrifice', () => {
    const b = cardSummary(plan('crawler')!, plan('burrower')!, [ROOT_PLAN, 'crawler']);
    expect(b.playstyle).toMatch(/Seabed food ×1.4/); expect(b.cost).toBe('Hearts −1 (5 base); No fins');
    expect(b.sacrifice).toBe('None new — still: never swims freely or flies');
    expect(cardSummary(plan('speck')!, plan('crawler')!, [ROOT_PLAN]).sacrifice).toBe('Never swims freely or flies');
  });
  it('lists where a choice leads', () => { expect(leadsTo(plan('crawler')!, [ROOT_PLAN], noCoast)).toEqual(['Shellback', 'Burrower']); });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/plans.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Write `src/tiny-tide/plans.ts`**

```ts
// The evolution tree. A body plan sets habitat, movement, body rules, part
// rules and the lineage commitments a run keeps to the end.
import type { PartKind, Stats } from './parts';

export type Medium = 'water' | 'air' | 'land' | 'burrow' | 'space';
export type Region = 'head' | 'middle' | 'tail';
export type Commitment = 'no-flight' | 'no-swim' | 'no-land' | 'seabed-bound' | 'no-legs';
export interface SegmentRule { radius: readonly [number, number]; height: readonly [number, number]; locked?: boolean }
export interface RegionRule { kinds: readonly PartKind[]; slots: number }
export interface CapabilityRule { stat: 'armor' | 'speed'; min: number; label: string }
export interface Foraging { habitat: string; dnaMultiplier: number }
export interface BodyPlan {
  id: string; name: string; blurb: string; size: number; parents: readonly string[]; line: string; habitat: string; movement: string;
  spine: { min: number; max: number; head: SegmentRule; middle: SegmentRule; tail: SegmentRule };
  regions: Record<Region, RegionRule>; requiresKinds: readonly PartKind[]; requiresCapabilities: readonly CapabilityRule[]; bans: readonly PartKind[];
  bonuses: Partial<Stats>; foraging: readonly Foraging[]; physics: { massPerBodyLength: number; knockbackResistance: number };
  commits: readonly Commitment[]; keystone?: { closesLines: readonly string[]; note: string }; needs?: 'coast'; feedingStrategy: 'bite';
}
/** Habitat facts for comparison and commitments (body lengths; null = unlimited). Plan B's profiles.ts owns the full profiles. */
export const HABITAT_FACTS: Record<string, { media: readonly Medium[]; maxDepth: number | null; floorGap: number | null; wading: number | null; surfaceBand: number | null }> = {
  seabed: { media: ['water'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null }, 'open-water': { media: ['water'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  'shallow-shore': { media: ['water', 'land'], maxDepth: 2.5, floorGap: null, wading: 1.1, surfaceBand: null }, land: { media: ['land'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  'seabed-land': { media: ['water', 'land'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null }, 'sky-sea': { media: ['water', 'air'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  space: { media: ['space'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
};
type Mode = 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
/** speed = multiplier; acceleration/braking in stage-local units/s²; yaw/pitch in rad/s. */
export const MOVEMENT_FACTS: Record<string, { mode: Mode; speed: number; acceleration: number; braking: number; yaw: number; pitch: number }> = {
  speck: { mode: 'ground', speed: 1, acceleration: 30, braking: 30, yaw: 10, pitch: 0 }, swimmer: { mode: 'swim', speed: 1, acceleration: 24, braking: 18, yaw: 8, pitch: 3 },
  darter: { mode: 'swim', speed: 1.15, acceleration: 40, braking: 30, yaw: 12, pitch: 5 }, bulk: { mode: 'swim', speed: .9, acceleration: 14, braking: 10, yaw: 5, pitch: 2 },
  crawler: { mode: 'ground', speed: 1, acceleration: 26, braking: 26, yaw: 9, pitch: 0 }, shellback: { mode: 'ground', speed: .8, acceleration: 16, braking: 20, yaw: 6, pitch: 0 },
  burrower: { mode: 'ground', speed: .95, acceleration: 24, braking: 24, yaw: 9, pitch: 0 }, shore: { mode: 'ground', speed: 1, acceleration: 24, braking: 24, yaw: 8, pitch: 0 },
  flyer: { mode: 'fly', speed: 1, acceleration: 20, braking: 14, yaw: 6, pitch: 3 }, colossus: { mode: 'ground', speed: .85, acceleration: 14, braking: 16, yaw: 5, pitch: 0 },
  space: { mode: 'space', speed: 1, acceleration: 16, braking: 12, yaw: 4, pitch: 3 }, 'space-slow': { mode: 'space', speed: .85, acceleration: 12, braking: 10, yaw: 3.5, pitch: 2.5 },
};
export const COAST_READY = false;
export const ROOT_PLAN = 'speck';
const ANY: SegmentRule = { radius: [.25, 1.2], height: [.25, 1.2] };
const HEAD: readonly PartKind[] = ['mouth', 'eye', 'sense', 'arm', 'armor'];
const ALL: readonly PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'wing', 'jet', 'arm', 'armor', 'sense', 'cosmic'];
const not = (kinds: readonly PartKind[], drop: readonly PartKind[]) => kinds.filter(k => !drop.includes(k));
const R = (head: readonly PartKind[], hs: number, middle: readonly PartKind[], ms: number, tail: readonly PartKind[], ts: number): Record<Region, RegionRule> => ({ head: { kinds: head, slots: hs }, middle: { kinds: middle, slots: ms }, tail: { kinds: tail, slots: ts } });
const spine = (min: number, max: number, middle = ANY, head = ANY, tail = ANY) => ({ min, max, head, middle, tail });
type Draft = Pick<BodyPlan, 'id' | 'name' | 'blurb' | 'size' | 'parents' | 'line' | 'habitat' | 'movement' | 'spine' | 'regions'> & Partial<BodyPlan>;
const P = (d: Draft): BodyPlan => ({ requiresKinds: [], requiresCapabilities: [], bans: [], bonuses: {}, foraging: [], physics: { massPerBodyLength: 1, knockbackResistance: 0 }, commits: [], feedingStrategy: 'bite', ...d });
const SEABED_FOOD = (m: number): Foraging[] => [{ habitat: 'sp-seabed', dnaMultiplier: m }];
const BIG_HEAD = not(ALL, ['tail', 'leg', 'wing', 'jet']);

export const PLANS: readonly BodyPlan[] = [
  P({ id: 'speck', name: 'Speck', blurb: 'A tiny start on the seabed.', size: 0, parents: [], line: 'root', habitat: 'seabed', movement: 'speck', spine: spine(3, 5),
    regions: R(HEAD, 4, ['fin', 'leg', 'armor', 'sense', 'arm'], 4, ['tail', 'fin', 'armor', 'sense'], 2) }),
  P({ id: 'swimmer', name: 'Swimmer', blurb: 'Leave the sand. The whole water column is yours.', size: 1, parents: ['speck'], line: 'swimmer', habitat: 'open-water', movement: 'swimmer', spine: spine(3, 6),
    regions: R(HEAD, 4, ['fin', 'armor', 'sense', 'arm'], 5, ['tail', 'fin', 'armor'], 2), requiresKinds: ['tail'], bans: ['leg'], commits: ['no-legs'] }),
  P({ id: 'crawler', name: 'Crawler', blurb: 'Low and steady. Feast on the seabed.', size: 1, parents: ['speck'], line: 'crawler', habitat: 'seabed', movement: 'crawler', spine: spine(3, 6),
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense', 'fin'], 6, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], foraging: SEABED_FOOD(1.25), commits: ['seabed-bound'] }),
  P({ id: 'shore_walker', name: 'Shore-walker', blurb: 'Breathe air. Walk the beach. Stay out of the deep.', size: 1, parents: ['speck'], line: 'shore', habitat: 'shallow-shore', movement: 'shore', spine: spine(3, 6), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense', 'fin'], 5, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], commits: ['no-flight'] }),
  P({ id: 'darter', name: 'Darter', blurb: 'Small and quick. Built for speed.', size: 2, parents: ['swimmer'], line: 'swimmer', habitat: 'open-water', movement: 'darter',
    spine: spine(3, 5, { radius: [.25, .7], height: [.25, .7] }, { radius: [.25, .7], height: [.25, .7] }, { radius: [.25, .6], height: [.25, .6] }),
    regions: R(HEAD, 4, ['fin', 'sense', 'arm', 'armor'], 4, ['tail', 'fin'], 4), requiresKinds: ['tail'], bans: ['leg'] }),
  P({ id: 'bulk', name: 'Bulk', blurb: 'Big, round and hard to push around.', size: 2, parents: ['swimmer'], line: 'swimmer', habitat: 'open-water', movement: 'bulk',
    spine: spine(4, 7, { radius: [.6, 1.2], height: [.6, 1.2] }), regions: R(HEAD, 5, ['fin', 'armor', 'sense', 'arm'], 8, ['tail', 'fin', 'armor'], 2),
    requiresKinds: ['tail'], bans: ['leg'], bonuses: { health: 2 }, physics: { massPerBodyLength: 1.5, knockbackResistance: .6 } }),
  P({ id: 'shellback', name: 'Shellback', blurb: 'A fixed shell body. Slow, safe and stubborn.', size: 2, parents: ['crawler'], line: 'crawler', habitat: 'seabed', movement: 'shellback',
    spine: spine(4, 6, { radius: [.9, .9], height: [.7, .7], locked: true }), regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense'], 8, ['tail', 'armor', 'sense'], 2),
    requiresKinds: ['leg'], requiresCapabilities: [{ stat: 'armor', min: 2, label: 'armor 2 or more from parts' }], bonuses: { armor: 2 }, foraging: SEABED_FOOD(1.25), physics: { massPerBodyLength: 1.3, knockbackResistance: .4 } }),
  P({ id: 'burrower', name: 'Burrower', blurb: 'Quiet and thrifty. Eat what others miss.', size: 2, parents: ['crawler'], line: 'crawler', habitat: 'seabed', movement: 'burrower', spine: spine(3, 7),
    regions: R(HEAD, 4, ['leg', 'arm', 'sense', 'armor'], 6, ['tail', 'sense'], 2), requiresKinds: ['leg'], bonuses: { stealth: 2, health: -1 }, foraging: SEABED_FOOD(1.4) }),
  P({ id: 'strider', name: 'Strider', blurb: 'Long legs on dry land. You give up the water.', size: 2, parents: ['shore_walker'], line: 'shore', habitat: 'land', movement: 'shore', spine: spine(3, 6), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense'], 6, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], bans: ['fin'], commits: ['no-swim'] }),
  P({ id: 'mudskipper', name: 'Mudskipper', blurb: 'At home in the shallows and on the shore.', size: 2, parents: ['shore_walker'], line: 'shore', habitat: 'shallow-shore', movement: 'shore', spine: spine(3, 5), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'fin', 'armor', 'arm', 'sense'], 6, ['tail', 'fin', 'armor'], 2), requiresKinds: ['leg'], bonuses: { stealth: 1 } }),
  P({ id: 'sky_drifter', name: 'Sky drifter', blurb: 'Rise out of the sea and take the sky.', size: 3, parents: ['darter', 'bulk'], line: 'swimmer', habitat: 'sky-sea', movement: 'flyer', spine: spine(3, 7),
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'leg']), 10, ['tail', 'fin', 'armor', 'jet', 'sense'], 4), bans: ['leg'] }),
  P({ id: 'colossus', name: 'Colossus', blurb: 'Wade the seabed and walk the shore. Too heavy to fly.', size: 3, parents: ['shellback', 'burrower'], line: 'crawler', habitat: 'seabed-land', movement: 'colossus', spine: spine(3, 8),
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet'], bonuses: { armor: 1, health: 1 }, physics: { massPerBodyLength: 1.6, knockbackResistance: .5 } }),
  P({ id: 'dune_giant', name: 'Dune giant', blurb: 'Stride over the island. The sea is behind you.', size: 3, parents: ['strider'], line: 'shore', habitat: 'land', movement: 'colossus', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet', 'fin']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet', 'fin'], bonuses: { armor: 1 } }),
  P({ id: 'shore_giant', name: 'Shore giant', blurb: 'Stride from beach to shallows.', size: 3, parents: ['mudskipper'], line: 'shore', habitat: 'shallow-shore', movement: 'colossus', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet'], bonuses: { stealth: 1 } }),
  P({ id: 'star_swimmer', name: 'Star swimmer', blurb: 'Swim between the planets.', size: 4, parents: ['sky_drifter'], line: 'swimmer', habitat: 'space', movement: 'space', spine: spine(3, 8),
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'leg']), 12, ['tail', 'fin', 'armor', 'jet', 'sense', 'cosmic'], 5), bans: ['leg'] }),
  P({ id: 'star_crawler', name: 'Star crawler', blurb: 'Haul yourself through the void. Slow, but hard to stop.', size: 4, parents: ['colossus'], line: 'crawler', habitat: 'space', movement: 'space-slow', spine: spine(3, 8),
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'wing']), 12, ['tail', 'armor', 'sense', 'cosmic', 'arm'], 5), bans: ['wing'], bonuses: { armor: 1, health: 1 }, physics: { massPerBodyLength: 1.6, knockbackResistance: .5 } }),
  P({ id: 'star_walker', name: 'Star walker', blurb: 'Step from world to world.', size: 4, parents: ['dune_giant', 'shore_giant'], line: 'shore', habitat: 'space', movement: 'space-slow', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'wing', 'fin']), 12, ['tail', 'armor', 'sense', 'cosmic', 'arm'], 5), bans: ['wing', 'fin'], bonuses: { stealth: 1 } }),
];
const byId = new Map(PLANS.map(p => [p.id, p]));
export const plan = (id: string) => byId.get(id);
export const regionOf = (t: number): Region => t < .25 ? 'head' : t > .75 ? 'tail' : 'middle';
export const segmentRule = (p: BodyPlan, index: number, count: number) => index === 0 ? p.spine.head : index === count - 1 ? p.spine.tail : p.spine.middle;
const lookup = (plans: readonly BodyPlan[]) => (id: string) => plans === PLANS ? byId.get(id) : plans.find(p => p.id === id);
export const commitmentsOf = (path: readonly string[], plans: readonly BodyPlan[] = PLANS) => [...new Set(path.flatMap(id => lookup(plans)(id)?.commits ?? []))];
export const closedLinesOf = (path: readonly string[], plans: readonly BodyPlan[] = PLANS) => [...new Set(path.flatMap(id => lookup(plans)(id)?.keystone?.closesLines ?? []))];
const flies = (p: BodyPlan) => HABITAT_FACTS[p.habitat]!.media.includes('air') && ['glide', 'fly'].includes(MOVEMENT_FACTS[p.movement]!.mode);
const allowsKind = (p: BodyPlan, kind: PartKind) => !p.bans.includes(kind) && Object.values(p.regions).some(r => r.kinds.includes(kind));
export function violates(p: BodyPlan, c: Commitment): boolean {
  const h = HABITAT_FACTS[p.habitat]!;
  switch (c) {
    case 'no-flight': return flies(p);
    case 'no-swim': return h.media.includes('water');
    case 'no-land': return h.media.includes('land');
    case 'seabed-bound': return flies(p) || (h.media.includes('water') && h.floorGap === null);
    case 'no-legs': return allowsKind(p, 'leg');
  }
}
export function eligibleChildren(path: readonly string[], build: { coast: boolean }, plans: readonly BodyPlan[] = PLANS) {
  const current = path.at(-1)!, commits = commitmentsOf(path, plans), closed = closedLinesOf(path, plans);
  return plans.filter(p => p.parents.includes(current) && (build.coast || p.needs !== 'coast') && !closed.includes(p.line) && !commits.some(c => violates(p, c)));
}
export const leadsTo = (p: BodyPlan, path: readonly string[], build: { coast: boolean }) => eligibleChildren([...path, p.id], build).map(c => c.name);

export type WaterAccess = 'none' | 'seabed' | 'shallow' | 'free';
export type CapabilityChange = { good: boolean; text: string } & (
  | { field: 'water'; from: WaterAccess; to: WaterAccess }
  | { field: 'medium'; medium: 'land' | 'air' | 'space'; from: boolean; to: boolean }
  | { field: 'depthLimit' | 'floorGap' | 'wading' | 'surfaceBand'; from: number | null; to: number | null }
  | { field: 'speed' | 'acceleration' | 'braking' | 'yaw' | 'pitch'; from: number; to: number }
  | { field: 'slots'; region: Region; from: number; to: number }
  | { field: 'kind'; region: Region; kind: PartKind; from: boolean; to: boolean }
  | { field: 'range'; segment: Region; dim: 'radius' | 'height'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'locked'; segment: Region; from: boolean; to: boolean }
  | { field: 'segments'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'bonus'; stat: keyof Stats; from: number; to: number }
  | { field: 'forage'; habitat: string; from: number; to: number }
  | { field: 'requiresKind'; kind: PartKind; from: boolean; to: boolean }
  | { field: 'requiresCapability'; stat: 'armor' | 'speed'; from: number; to: number }
  | { field: 'commit'; commitment: Commitment });
const KIND_TEXT: Record<PartKind, string> = { mouth: 'mouths', eye: 'eyes', fin: 'fins', tail: 'tails', leg: 'legs', wing: 'wings', jet: 'jets', arm: 'arms', armor: 'armor', sense: 'senses', cosmic: 'cosmic parts' };
const STAT_TEXT: Record<keyof Stats, string> = { health: 'Hearts', armor: 'Armor', stealth: 'Stealth', speed: 'Speed', bite: 'Bite', reach: 'Reach', sense: 'Sense' };
export const COMMIT_TEXT: Record<Commitment, string> = { 'no-flight': 'Can never fly', 'no-swim': 'Can never swim again', 'no-land': 'Can never walk on land', 'seabed-bound': 'Never swims freely or flies', 'no-legs': 'Can never grow legs again' };
const WATER_TEXT: Record<WaterAccess, string> = { none: 'No swimming', seabed: 'Lives on the seabed', shallow: 'Swims in shallow water', free: 'Swims freely in open water' };
const WATER_RANK: Record<WaterAccess, number> = { none: 0, seabed: 1, shallow: 1, free: 2 };
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const sign = (n: number) => n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`;
const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
export const waterAccess = (p: BodyPlan): WaterAccess => { const h = HABITAT_FACTS[p.habitat]!; return !h.media.includes('water') ? 'none' : h.floorGap !== null ? 'seabed' : h.maxDepth !== null ? 'shallow' : 'free'; };
/** Field-by-field comparison with values; text is rendered here but callers may re-render from the typed fields. */
export function compareCapabilities(a: BodyPlan, b: BodyPlan): CapabilityChange[] {
  const out: CapabilityChange[] = [], ha = HABITAT_FACTS[a.habitat]!, hb = HABITAT_FACTS[b.habitat]!, ma = MOVEMENT_FACTS[a.movement]!, mb = MOVEMENT_FACTS[b.movement]!;
  const wa = waterAccess(a), wb = waterAccess(b);
  if (wa !== wb) {
    if (WATER_RANK[wb] > WATER_RANK[wa]) out.push({ field: 'water', from: wa, to: wb, good: true, text: WATER_TEXT[wb] });
    else if (WATER_RANK[wb] < WATER_RANK[wa]) out.push({ field: 'water', from: wa, to: wb, good: false, text: wb === 'none' ? `Lose: ${WATER_TEXT[wa].toLowerCase()}` : `Only ${WATER_TEXT[wb].toLowerCase()}` });
    else { out.push({ field: 'water', from: wa, to: wb, good: true, text: WATER_TEXT[wb] }); out.push({ field: 'water', from: wa, to: wb, good: false, text: `No longer ${WATER_TEXT[wa].toLowerCase()}` }); }
  }
  for (const medium of ['land', 'air', 'space'] as const) {
    const from = ha.media.includes(medium), to = hb.media.includes(medium), label = medium === 'land' ? 'walk on land' : medium === 'air' ? 'fly' : 'move through space';
    if (from !== to) out.push({ field: 'medium', medium, from, to, good: to, text: to ? cap(label) : `Can't ${label}` });
  }
  // A limit of null means unlimited; a larger limit is always more freedom.
  const freedom = (x: number | null) => x === null ? Number.POSITIVE_INFINITY : x;
  const limit = (field: 'depthLimit' | 'floorGap', from: number | null, to: number | null, gain: string, loss: string) => {
    if (from === to) return; const better = freedom(to) > freedom(from);
    out.push({ field, from, to, good: better, text: better ? gain : loss });
  };
  if (ha.media.includes('water') && hb.media.includes('water')) limit('depthLimit', ha.maxDepth, hb.maxDepth, hb.maxDepth === null ? 'Any water depth' : `Water up to ${hb.maxDepth} body lengths deep`, `Water no deeper than ${hb.maxDepth} body lengths`);
  if (ha.floorGap !== null && hb.floorGap !== null) limit('floorGap', ha.floorGap, hb.floorGap, 'Can rise further from the floor', 'Must stay closer to the floor');
  // For wading and surface bands, null means "none" (not unlimited); a larger band is more freedom.
  const band = (field: 'wading' | 'surfaceBand', from: number | null, to: number | null, gain: string, loss: string, more: string, less: string) => {
    if (from === to) return;
    if (from === null || to === null) { out.push({ field, from, to, good: to !== null, text: to !== null ? gain : loss }); return; }
    out.push({ field, from, to, good: to > from, text: to > from ? more : less });
  };
  band('wading', ha.wading, hb.wading, 'Wades with its head above the water', "Can't wade", 'Wades in deeper water', 'Wades only in shallower water');
  band('surfaceBand', ha.surfaceBand, hb.surfaceBand, 'Floats at the surface', "Can't float at the surface", 'Rises higher at the surface', 'Stays lower at the surface');
  const num = (field: 'speed' | 'acceleration' | 'braking' | 'yaw' | 'pitch', from: number, to: number, up: string, down: string) => { if (from !== to) out.push({ field, from, to, good: to > from, text: to > from ? up : down }); };
  num('speed', ma.speed, mb.speed, `Faster (×${fmt(mb.speed)}, was ×${fmt(ma.speed)})`, `Slower (×${fmt(mb.speed)}, was ×${fmt(ma.speed)})`);
  num('acceleration', ma.acceleration, mb.acceleration, 'Quicker to get going', 'Slower to get going');
  num('braking', ma.braking, mb.braking, 'Stops faster', 'Stops slower');
  num('yaw', ma.yaw, mb.yaw, 'Turns faster', 'Turns slower');
  num('pitch', ma.pitch, mb.pitch, ma.pitch === 0 ? 'Can tilt up and down' : 'Tilts faster', mb.pitch === 0 ? "Can't tilt up and down" : 'Tilts slower');
  for (const region of ['head', 'middle', 'tail'] as const) {
    const d = b.regions[region].slots - a.regions[region].slots;
    if (d) out.push({ field: 'slots', region, from: a.regions[region].slots, to: b.regions[region].slots, good: d > 0, text: `${sign(d)} ${region} slot${Math.abs(d) > 1 ? 's' : ''}` });
    const kinds = new Set([...a.regions[region].kinds, ...b.regions[region].kinds]);
    for (const kind of kinds) {
      const from = allowsIn(a, region, kind), to = allowsIn(b, region, kind);
      if (from !== to) out.push({ field: 'kind', region, kind, from, to, good: to, text: to ? `${cap(KIND_TEXT[kind])} allowed in the ${region}` : `No ${KIND_TEXT[kind]} in the ${region}` });
    }
    for (const dim of ['radius', 'height'] as const) {
      const ra = a.spine[region][dim], rb = b.spine[region][dim], word = dim === 'radius' ? 'wide' : 'tall', seg = cap(region);
      if (rb[0] !== ra[0]) out.push({ field: 'range', segment: region, dim, bound: 'min', from: ra[0], to: rb[0], good: rb[0] < ra[0], text: rb[0] < ra[0] ? `${seg} can be as thin as ${fmt(rb[0])}` : `${seg} at least ${fmt(rb[0])} ${word}` });
      if (rb[1] !== ra[1]) out.push({ field: 'range', segment: region, dim, bound: 'max', from: ra[1], to: rb[1], good: rb[1] > ra[1], text: rb[1] > ra[1] ? `${seg} up to ${fmt(rb[1])} ${word}` : `${seg} at most ${fmt(rb[1])} ${word}` });
    }
    const la = !!a.spine[region].locked, lb = !!b.spine[region].locked;
    if (la !== lb) out.push({ field: 'locked', segment: region, from: la, to: lb, good: !lb, text: lb ? `Fixed ${region} shape` : `Free ${region} shape` });
  }
  if (b.spine.max !== a.spine.max) out.push({ field: 'segments', bound: 'max', from: a.spine.max, to: b.spine.max, good: b.spine.max > a.spine.max, text: b.spine.max > a.spine.max ? `Up to ${b.spine.max} segments` : `At most ${b.spine.max} segments` });
  if (b.spine.min !== a.spine.min) out.push({ field: 'segments', bound: 'min', from: a.spine.min, to: b.spine.min, good: b.spine.min < a.spine.min, text: b.spine.min < a.spine.min ? `As few as ${b.spine.min} segments` : `At least ${b.spine.min} segments` });
  for (const stat of new Set([...Object.keys(a.bonuses), ...Object.keys(b.bonuses)]) as Set<keyof Stats>) {
    const from = a.bonuses[stat] ?? 0, to = b.bonuses[stat] ?? 0, d = to - from;
    if (d) out.push({ field: 'bonus', stat, from, to, good: d > 0, text: `${STAT_TEXT[stat]} ${sign(d)}${stat === 'health' ? ` (${Math.max(3, 6 + to)} base)` : ''}` });
  }
  for (const habitat of new Set([...a.foraging, ...b.foraging].map(f => f.habitat))) {
    const from = a.foraging.find(f => f.habitat === habitat)?.dnaMultiplier ?? 1, to = b.foraging.find(f => f.habitat === habitat)?.dnaMultiplier ?? 1;
    if (from !== to) out.push({ field: 'forage', habitat, from, to, good: to > from, text: to === 1 ? `Lose: seabed food bonus (was ×${fmt(from)})` : `Seabed food ×${fmt(to)}${from !== 1 ? ` (was ×${fmt(from)})` : ''}` });
  }
  for (const kind of new Set([...a.requiresKinds, ...b.requiresKinds])) {
    const from = a.requiresKinds.includes(kind), to = b.requiresKinds.includes(kind);
    if (from !== to) out.push({ field: 'requiresKind', kind, from, to, good: !to, text: to ? `Needs ${KIND_TEXT[kind]}` : `No longer needs ${KIND_TEXT[kind]}` });
  }
  for (const stat of ['armor', 'speed'] as const) {
    const from = a.requiresCapabilities.find(c => c.stat === stat)?.min ?? 0, rule = b.requiresCapabilities.find(c => c.stat === stat), to = rule?.min ?? 0;
    if (from !== to) out.push({ field: 'requiresCapability', stat, from, to, good: to < from, text: to > from ? `Needs ${rule!.label}` : `No longer needs ${stat}` });
  }
  for (const c of b.commits) if (!a.commits.includes(c)) out.push({ field: 'commit', commitment: c, good: false, text: COMMIT_TEXT[c] });
  return out;
}
const allowsIn = (p: BodyPlan, region: Region, kind: PartKind) => !p.bans.includes(kind) && p.regions[region].kinds.includes(kind);
const GAIN_ORDER = ['water', 'medium', 'wading', 'forage', 'speed', 'bonus', 'acceleration', 'yaw', 'slots'];
const COST_ORDER = ['bonus', 'kindAll', 'requiresCapability', 'requiresKind', 'speed', 'acceleration', 'yaw', 'slots', 'range', 'locked', 'water', 'medium'];
/** Card lines (spec §7). `path` is the path up to and including `a`. */
export function cardSummary(a: BodyPlan, b: BodyPlan, path: readonly string[] = [a.id]) {
  const c = compareCapabilities(a, b), rank = (order: string[], f: string) => { const i = order.indexOf(f); return i < 0 ? order.length : i; };
  const gains = c.filter(x => x.good).sort((x, y) => rank(GAIN_ORDER, x.field) - rank(GAIN_ORDER, y.field)).slice(0, 3).map(x => x.text);
  // A kind lost in every region it was allowed in becomes one "No <kind>" line.
  const lostEverywhere = [...new Set(c.filter(x => x.field === 'kind' && !x.good).map(x => (x as { kind: PartKind }).kind))].filter(k => !(['head', 'middle', 'tail'] as const).some(r => allowsIn(b, r, k)));
  const costs = [...lostEverywhere.map(k => ({ field: 'kindAll', text: `No ${KIND_TEXT[k]}` })), ...c.filter(x => !x.good && x.field !== 'commit' && !(x.field === 'kind' && lostEverywhere.includes((x as { kind: PartKind }).kind)))]
    .sort((x, y) => rank(COST_ORDER, x.field) - rank(COST_ORDER, y.field)).slice(0, 2).map(x => x.text);
  const added = b.commits.filter(x => !a.commits.includes(x)), inherited = commitmentsOf(path);
  const sacrifice = added.length ? added.map(x => COMMIT_TEXT[x]).join('; ') : inherited.length ? `None new — still: ${inherited.map(x => COMMIT_TEXT[x].toLowerCase()).join('; ')}` : 'None';
  return { playstyle: gains.join('; '), cost: costs.join('; ') || 'Nothing', sacrifice };
}
```

Hand checks for the tests above:
- Speck→Swimmer: water `seabed` (floor gap set) → `free` is a gain `Swims freely in open water` with no seabed loss; the new commitment gives `Can never grow legs again`.
- Crawler→Burrower: forage 1.25→1.4; health bonus 0→−1 renders `Hearts −1 (5 base)` (`max(3, 6 − 1)`); fins: Crawler allows them in the middle only, Burrower nowhere → per-region `No fins in the middle`, aggregated `No fins` on the card. Card cost order puts `bonus` before `kindAll`.
- Shellback→Colossus: speed .8→.85 `Faster (×0.85, was ×0.8)`; yaw 6→5 `Turns slower`; braking 20→16 `Stops slower`.
- Swimmer→Bulk: middle radius min .25→.6 → `Middle at least 0.6 wide`; middle height min → `Middle at least 0.6 tall`.
- Swimmer→Darter: head and middle radius max 1.2→.7 → `Head at most 0.7 wide`, `Middle at most 0.7 wide`; tail max .6.
- Every plan's gains and losses were enumerated when writing this plan; Mudskipper's cost is its 5-segment limit. If a plan fails, change its data (not the test) and note it in the commit.

- [ ] **Step 4: Run** `npx vitest run tests/tiny-tide-core/plans.test.ts`. Expected: PASS, all tests (8 tree tests + the comparison tests).

- [ ] **Step 5: Checkpoint and commit** `git add src/tiny-tide/plans.ts tests/tiny-tide-core/plans.test.ts && git commit -m "Tiny Tide: body-plan tree, commitments and typed comparison"`

---

### Task A3: Part identity, cost, slots, effective stats and problems

**Files:**
- Modify: `src/tiny-tide/genome.ts`
- Modify (call sites only): `src/tiny-tide/editor.ts`, `src/tiny-tide/main.ts`, `tests/tiny-tide.test.ts`
- Test: `tests/tiny-tide-core/genome.test.ts`

**Interfaces:**
- Consumes: `BodyPlan`, `regionOf`, `segmentRule`, `plan` (A2).
- Produces:
  - `PlacedPart = { uid: string; id; t; angle; scale; mirror; roll }`; uids are `p<serial>`.
  - `uidSerial(uid): number` (NaN when not `p<digits>`), `nextUid(serial: number): string` (= `p${serial}`)
  - `slotWeight`, `copies`, `partSlots`, `partCost`, `genomeCost`, `instanceCount` (counts slots)
  - `partStats(g)` (today's `statsOf`, renamed; `statsOf` stays as an alias until Plan C removes callers), `effectiveStats(g, plan)`, `derive(stats)` with `maxHealth = max(3, 6 + round(health))`
  - `DesignContext { unlocked: readonly string[]; diet?: Diet; budget?: number; anchorCheck?: (g: Genome, p: BodyPlan) => boolean }`
  - `ProblemCode` (adds `placement`) and `GenomeProblem { code; message; uid?; segment?; region? }`
  - `problems(g, plan, ctx, catalog = PARTS)` — the one strict design validator for every commit and every v4 load (spec §7 calls it `validateDesign`; export that name as an alias)
  - `sanitizeGenome(raw): Genome | null` — strict shape reader for v4 data: never clamps, never assigns uids, never unpairs
  - `repairLegacyGenome(raw): Genome | null` — v1/v2 only: assigns `p1..pn`, clamps placement and spine values into range, unpairs parts whose catalog entry cannot mirror
  - `starterGenome()` — parts `p1..p4`; `STARTER_NEXT_SERIAL = 5`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/genome.test.ts
import { describe, expect, it } from 'vitest';
import { derive, effectiveStats, genomeCost, instanceCount, nextUid, partCost, partStats, problems, repairLegacyGenome, sanitizeGenome, slotWeight, starterGenome, uidSerial, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';

let serial = 100;
const P = (id: string, t: number, angle = 0, extra: Partial<PlacedPart> = {}): PlacedPart => ({ uid: nextUid(serial++), id, t, angle, scale: 1, mirror: false, roll: 0, ...extra });
const codes = (g: Genome, id: string, ctx: object = {}) => problems(g, plan(id)!, { unlocked: [], ...ctx }).map(p => p.code);
const ctx = { unlocked: [] as string[] };
describe('part identity, cost and slots', () => {
  it('numbers starter parts p1..p4 and parses serials', () => {
    expect(starterGenome().parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3', 'p4']); expect(uidSerial('p12')).toBe(12); expect(uidSerial('x1')).toBeNaN(); expect(nextUid(7)).toBe('p7');
  });
  it('prices and slots parts by size', () => {
    expect(slotWeight(1.4)).toBe(1); expect(slotWeight(1.41)).toBe(2);
    expect(partCost(P('fin_side', .5, 1.8, { scale: .4 }))).toBe(7);          // round(10 × 1 × .7)
    expect(partCost(P('fin_side', .5, 1.8, { scale: 1.8 }))).toBe(14);        // round(10 × 1 × 1.4)
    expect(partCost(P('fin_side', .5, 1.8, { mirror: true }))).toBe(20);      // round(10 × 2 × 1)
    expect(instanceCount({ ...starterGenome(), parts: [P('fin_side', .5, 1.8, { mirror: true, scale: 1.6 })] })).toBe(4);  // 2 copies × weight 2
    expect(genomeCost(starterGenome())).toBe(41);                              // 0 + round(17.5)=18 + 9 + round(13.6)=14
  });
});
describe('effective stats', () => {
  it('adds plan bonuses for gameplay but checks capabilities on parts only', () => {
    const g = starterGenome();
    expect(effectiveStats(g, plan('shellback')!).armor).toBe(partStats(g).armor + 2);
    expect(codes(g, 'shellback')).toContain('capability');
  });
  it('makes negative health a real cost and positive health a real gain', () => {
    const g = starterGenome();
    expect(derive(effectiveStats(g, plan('burrower')!)).maxHealth).toBe(5);   // max(3, 6 + (0 − 1))
    expect(derive(effectiveStats(g, plan('bulk')!)).maxHealth).toBe(8);       // 6 + 2
    expect(derive({ ...partStats(g), health: -9 }).maxHealth).toBe(3);
  });
});
describe('problems', () => {
  it('accepts the starter for Speck and Crawler, rejects legs on a Swimmer', () => {
    const g = starterGenome(); expect(codes(g, 'speck')).toEqual([]); expect(codes(g, 'crawler')).toEqual([]); expect(codes(g, 'swimmer')).toContain('banned');
  });
  it('reports unknown parts, bad or duplicate uids, mouths outside the head, pole and tip mirrors, and diet', () => {
    const g = starterGenome();
    expect(codes({ ...g, parts: [...g.parts, P('laser', .5)] }, 'speck')).toContain('unknown');
    expect(codes({ ...g, parts: [...g.parts, { ...P('spike', .5), uid: 'p2' }] }, 'speck')).toContain('uid');
    expect(codes({ ...g, parts: [...g.parts, { ...P('spike', .5), uid: 'spike' }] }, 'speck')).toContain('uid');
    expect(codes({ ...g, parts: g.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, t: .9 } : p) }, 'speck')).toContain('region');
    expect(codes({ ...g, parts: [...g.parts, P('fin_side', .5, .1, { mirror: true })] }, 'speck')).toContain('mirror');
    expect(codes({ ...g, parts: [...g.parts, P('antenna', .02, 1.6, { mirror: true })] }, 'speck')).toContain('mirror');
    expect(codes(g, 'speck', { diet: 'carnivore' })).toContain('diet');
  });
  it('reports which uid overflows a full region', () => {
    const g = starterGenome(), extra = [P('spike', .3), P('spike', .4), P('spike', .5)];   // middle: legs 2 + 3 spikes = 5 > 4
    const overflow = problems({ ...g, parts: [...g.parts, ...extra] }, plan('speck')!, ctx).filter(p => p.code === 'region').map(p => p.uid);
    expect(overflow).toEqual([extra[2]!.uid]);
  });
  it('asks the injected anchor check, and reports a body that cannot fit', () => {
    expect(codes(starterGenome(), 'speck', { anchorCheck: () => false })).toContain('anchor');
    expect(codes(starterGenome(), 'speck', { anchorCheck: () => true })).toEqual([]);
  });
});
describe('strict placement and sanitizing', () => {
  it('rejects non-finite or out-of-range placements and catalog-forbidden mirrors as problems', () => {
    const g = starterGenome();
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 1.6, { mirror: true })] }, 'speck')).toContain('mirror');   // spikes can't mirror
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 0, { roll: Number.NaN })] }, 'speck')).toContain('placement');
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 0, { scale: 2 })] }, 'speck')).toContain('placement');
    expect(codes({ ...g, parts: [...g.parts, P('spike', 1.2, 0)] }, 'speck')).toContain('placement');
    expect(codes({ ...g, spine: [{ ...g.spine[0]!, lift: Number.POSITIVE_INFINITY }, ...g.spine.slice(1)] }, 'speck')).toContain('segment');
  });
  it('reads v4 genomes strictly and repairs legacy genomes explicitly', () => {
    const g = starterGenome();
    expect(sanitizeGenome(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(sanitizeGenome({ ...g, parts: [g.parts[0], { ...g.parts[1], uid: 'p1' }] })).toBeNull();
    expect(sanitizeGenome({ ...g, parts: [{ ...g.parts[0]!, scale: 9 }] })).toBeNull();          // strict: no clamping
    const legacy = { ...g, parts: g.parts.map(({ uid: _uid, ...rest }) => rest) };
    expect(sanitizeGenome(legacy)).toBeNull();
    const repaired = repairLegacyGenome({ ...legacy, parts: [...legacy.parts, { id: 'spike', t: .5, angle: 1.6, scale: 9, mirror: true, roll: 0 }] })!;
    expect(repaired.parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']); expect(repaired.parts[4]).toMatchObject({ scale: 1.8, mirror: false });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/genome.test.ts`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement in `src/tiny-tide/genome.ts`**

Imports: `import { part, PARTS, type Diet, type PartKind, type PartSpec, type Stats } from './parts';` and `import { regionOf, segmentRule, type BodyPlan, type Region } from './plans';`. Keep `PartSpec` and `PartKind` imports only if used after this task (A4 uses them; if this task alone leaves one unused, import it in A4 instead).

```ts
export interface PlacedPart { uid: string; id: string; t: number; angle: number; scale: number; mirror: boolean; roll: number }
export const STARTER_NEXT_SERIAL = 5;
export const uidSerial = (uid: string) => /^p(\d+)$/.test(uid) ? Number(uid.slice(1)) : NaN;
export const nextUid = (serial: number) => `p${serial}`;
export const slotWeight = (scale: number) => scale > 1.4 ? 2 : 1;
export const copies = (p: PlacedPart) => p.mirror ? 2 : 1;
export const partSlots = (p: PlacedPart) => copies(p) * slotWeight(p.scale);
export const partCost = (p: PlacedPart) => Math.round((part(p.id)?.cost ?? 0) * copies(p) * (.5 + .5 * p.scale));
export const instanceCount = (g: Genome) => g.parts.reduce((n, p) => n + partSlots(p), 0);
export const genomeCost = (g: Genome) => g.parts.reduce((n, p) => n + partCost(p), 0);
export const badMirror = (p: PlacedPart) => p.mirror && (Math.abs(Math.sin(p.angle)) < .3 || p.t < .05 || p.t > .95);
```

`starterGenome()`: add `uid: 'p1'`…`'p4'` in order (mouth, eye_stalk, tail_paddle, leg_little).

Rename `statsOf` to `partStats` and keep `export const statsOf = partStats;` (removed in Plan C when no caller remains).

```ts
export function effectiveStats(g: Genome, p: BodyPlan): Stats {
  const s = partStats(g);
  for (const [k, v] of Object.entries(p.bonuses) as [keyof Stats, number][]) s[k] = Math.round((s[k] + v) * 10) / 10;
  return s;
}
```

In `derive`, change `maxHealth: 6 + Math.max(0, Math.round(stats.health))` to `maxHealth: Math.max(3, 6 + Math.round(stats.health))`.

Problems:

```ts
export interface DesignContext { unlocked: readonly string[]; diet?: Diet; budget?: number; anchorCheck?: (g: Genome, p: BodyPlan) => boolean }
export type ProblemCode = 'mouth' | 'parts' | 'segment' | 'locked' | 'unknown' | 'uid' | 'banned' | 'region' | 'required' | 'capability' | 'diet' | 'dna' | 'mirror' | 'placement' | 'anchor';
export interface GenomeProblem { code: ProblemCode; message: string; uid?: string; segment?: number; region?: Region }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
export function problems(g: Genome, p: BodyPlan, ctx: DesignContext, catalog: readonly PartSpec[] = PARTS): GenomeProblem[] {
  const part = (id: string) => catalog.find(s => s.id === id);   // the catalog seam (synthetic grants in tests)
  const out: GenomeProblem[] = [], stage = p.size, seen = new Set<string>();
  for (const x of g.parts) if (!Number.isSafeInteger(uidSerial(x.uid)) || uidSerial(x.uid) < 1) { out.push({ code: 'uid', message: `Part id ${x.uid} is not valid.`, uid: x.uid }); }
  for (const x of g.parts) { if (seen.has(x.uid)) out.push({ code: 'uid', message: `Part id ${x.uid} is used twice.`, uid: x.uid }); seen.add(x.uid); }
  const mouths = g.parts.filter(x => part(x.id)?.kind === 'mouth');
  if (mouths.length !== 1) out.push({ code: 'mouth', message: mouths.length ? 'Only one mouth, please.' : 'Your creature needs a mouth.' });
  if (ctx.diet && mouths[0] && part(mouths[0].id)!.diet !== ctx.diet) out.push({ code: 'diet', message: 'Diet is set until your next evolution.', uid: mouths[0].uid });
  if (instanceCount(g) > PART_LIMITS[stage]!) out.push({ code: 'parts', message: `Too complex: ${instanceCount(g)} / ${PART_LIMITS[stage]} slots.` });
  if (g.spine.length < p.spine.min || g.spine.length > p.spine.max) out.push({ code: 'segment', message: `${p.name}s have ${p.spine.min}–${p.spine.max} segments.` });
  g.spine.forEach((s, i) => {
    const r = segmentRule(p, i, g.spine.length);
    const finite = [s.radius, s.height, s.lift].every(Number.isFinite) && s.lift >= SPINE_RANGE.lift[0] && s.lift <= SPINE_RANGE.lift[1];
    const ok = finite && s.radius >= r.radius[0] - 1e-6 && s.radius <= r.radius[1] + 1e-6 && s.height >= r.height[0] - 1e-6 && s.height <= r.height[1] + 1e-6 && (!r.locked || (near(s.radius, r.radius[0]) && near(s.height, r.height[0])));
    if (!ok) out.push({ code: 'segment', message: `Segment ${i + 1} is out of shape for a ${p.name}.`, segment: i });
  });
  const used: Record<Region, number> = { head: 0, middle: 0, tail: 0 };
  for (const x of g.parts) {
    const spec = part(x.id), region = regionOf(x.t);
    if (!spec) { out.push({ code: 'unknown', message: `Unknown part "${x.id}".`, uid: x.uid }); continue; }
    if (!isUnlocked(x.id, stage, ctx.unlocked)) out.push({ code: 'locked', message: `${spec.name} is still locked.`, uid: x.uid });
    if (badMirror(x) || (x.mirror && !spec.mirror)) out.push({ code: 'mirror', message: `${spec.name} can't be paired there.`, uid: x.uid });
    if (![x.t, x.angle, x.scale, x.roll].every(Number.isFinite) || x.t < 0 || x.t > 1 || x.angle <= -Math.PI || x.angle > Math.PI || x.scale < SCALE_RANGE[0] || x.scale > SCALE_RANGE[1] || Math.abs(x.roll) > Math.PI)
      out.push({ code: 'placement', message: `${spec.name} is placed out of range.`, uid: x.uid });
    if (p.bans.includes(spec.kind)) { out.push({ code: 'banned', message: `${p.name}s can't use ${spec.name.toLowerCase()}.`, uid: x.uid }); continue; }
    if (!p.regions[region].kinds.includes(spec.kind)) { out.push({ code: 'region', message: `${spec.name} doesn't fit in the ${region}.`, uid: x.uid, region }); continue; }
    used[region] += partSlots(x);
    if (used[region] > p.regions[region].slots) out.push({ code: 'region', message: `The ${region} is full: ${p.regions[region].slots} slots.`, uid: x.uid, region });
  }
  for (const kind of p.requiresKinds) if (!g.parts.some(x => part(x.id)?.kind === kind)) out.push({ code: 'required', message: `${p.name}s need ${kind === 'leg' ? 'legs' : `a ${kind}`}.` });
  const ps = partStats(g);
  for (const c of p.requiresCapabilities) if (ps[c.stat] < c.min) out.push({ code: 'capability', message: `${p.name}s need ${c.label}.` });
  if (ctx.anchorCheck && !out.length && !ctx.anchorCheck(g, p)) out.push({ code: 'anchor', message: "This body can't fit anywhere at this size." });
  if (genomeCost(g) > (ctx.budget ?? Infinity)) out.push({ code: 'dna', message: 'Not enough DNA.' });
  return out;
}
```

The anchor check runs only when no structural problem exists (it is expensive and meaningless for broken designs).

Put `export const validateDesign = problems;` after the function body (not inside it).

`sanitizeGenome(raw)` (strict, v4) returns the genome unchanged or `null`. It returns `null` for: a missing, malformed (`p<serial>`, safe integer ≥ 1) or duplicate `uid`; an unknown part id; any non-finite number; a placement outside `t ∈ [0,1]`, `angle ∈ (−π, π]`, `scale ∈ SCALE_RANGE`, `roll ∈ [−π, π]`; a spine with fewer than 3 or more than 8 points or a value outside `SPINE_RANGE`; paint colors that are not `#rrggbb`, or an unknown pattern; unknown keys. It never clamps, assigns or unpairs. Plan-dependent rules (regions, segment rules, catalog mirrors at this plan) stay in `problems`.

`repairLegacyGenome(raw)` (v1/v2 only): requires that **no** part has a `uid`; assigns `p1..pn` in order; clamps `t`, `scale`, `roll`, spine radius/height/lift into their ranges; wraps `angle` into `(−π, π]`; sets `mirror = false` when the catalog part can't mirror or the pair is at a pole or tip; returns `null` for unknown ids or malformed shapes.

Delete the old `problems(g, stage, unlocked, budget)` signature.

- [ ] **Step 4: Update call sites so the game keeps compiling and running**

- `editor.ts`: add `plan: BodyPlan` to `EditorOptions`. Both `problems(...)` calls become `problems(this.draft, this.options.plan, { unlocked: this.options.unlocked, budget: this.budget })`. Every place that builds a `PlacedPart` gets a uid: `placement()` returns `{ uid: 'ghost', ... }`; `addPart()` assigns `placed.uid = nextUid(this.serial++)` right before `g.parts.push(placed)`; the keyboard and coarse-pointer literal in `renderParts()` gets `uid: 'ghost'` (addPart replaces it). Declare `private serial: number;` and assign it in the constructor **immediately after** `this.draft = cloneGenome(options.genome)`: `this.serial = Math.max(STARTER_NEXT_SERIAL, ...this.draft.parts.map(p => uidSerial(p.uid) + 1));` (a field initializer would read `draft` before it exists — TS2729). Plan A Task A6 replaces this with `EditorOptions.nextSerial`.
- `main.ts`: pass `plan: plan(['speck', 'swimmer', 'darter', 'sky_drifter', 'star_swimmer'][stage]!)!` to `openEditor` (temporary; A6 replaces it).
- `tests/tiny-tide.test.ts`: the old sanitizer test's clamping line moves to the legacy reader: `expect(repairLegacyGenome({ ...g, parts: g.parts.map(({ uid: _u, ...rest }) => rest), spine: [{ radius: 9, height: -1, lift: 0 }, ...g.spine.slice(1)] })!.spine[0]).toEqual({ radius: 1.2, height: .25, lift: 0 })`, and a new line asserts `sanitizeGenome({ ...g, spine: [{ radius: 9, height: -1, lift: 0 }, ...g.spine.slice(1)] })` is `null`. Every `problems(g, <stage>, [], budget?)` becomes `problems(g, plan(<id>)!, { unlocked: [], budget })` with `speck` for stage 0, `crawler` for stage 1, `sky_drifter` for stage 3. Every test part literal gets a uid (`uid: 'p10'`, `'p11'`, … unique within each genome). In `applyDesign`'s refund expectation the two removed `leg_little` at scale .7 now refund `partCost = round(8 × 2 × .85) = 14` (was 16).

- [ ] **Step 5: Checkpoint** (tsc, unit tests, editor smoke). Expected: all pass.

- [ ] **Step 6: Commit** `git add src/tiny-tide/genome.ts src/tiny-tide/editor.ts src/tiny-tide/main.ts tests && git commit -m "Tiny Tide: part ids, size cost and slots, effective stats and plan problems"`

---

### Task A4: adaptToPlan

**Files:**
- Modify: `src/tiny-tide/genome.ts`
- Test: `tests/tiny-tide-core/adapt.test.ts`

**Interfaces:**
- Produces:
  - `type Adaptation = { ok: true; genome: Genome; changes: string[]; nextSerial: number } | { ok: false; reasons: string[] }`
  - `adaptToPlan(g, plan, ctx: DesignContext, nextSerial: number): Adaptation`
  - `starterFor(plan): Genome` (throws if the starter can't be adapted; the test proves it never does)

Algorithm (spec §7), implemented exactly in this order:

1. Clone the input.
2. Remove parts whose id is unknown (`X removed: unknown part.`) or locked for `plan.size` (`X removed: still locked.`). Remove banned kinds (`X removed: <Plan>s can't use it.`).
3. Unpair bad mirrors (pole, tip, or a catalog part that can't mirror): `mirror = false` (`X unpaired.`).
4. Mouth: keep exactly one. If `ctx.diet` is set and no mouth has that diet, remove the mouth (`X removed: your diet is now <diet>.`) and remember its `t`/`angle`. Remove extra mouths (`X removed: only one mouth.`).
5. Region fit: each part in a region that does not allow its kind moves to the **nearest** allowed region (region centres `.12 / .5 / .92`) that has free slots, at that region's centre `t` (`X moved to the <region>.`). Parts with no allowed region with room are **removed now** (`X removed: no room for it on a <Plan>.`).
6. Requirements, in order: a mouth if none is left (cheapest unlocked mouth of `ctx.diet`, else herbivore; at the removed mouth's `t`/`angle`, else `t: 0, angle: 0`); each missing `requiresKinds` kind; each `requiresCapabilities` deficit (cheapest unlocked part with `stats[stat] > 0`, repeated until met; the k-th copy `.06 × k` further along `t`). Placement: the catalog default (`spec.t`, `spec.angle`) if that region allows the kind and has room; else the nearest allowed region with room (its centre); else the nearest allowed region (room is made in step 7). Scale 1, never mirrored. `X added: <Plan>s need it.`
7. Make room: while a region or the global slot limit is over, remove one **optional** part (not the mouth, not of a required kind, not needed to keep a capability at its minimum). Choose: parts with no stats first, then the lowest `partCost`, then the newest uid (`X removed: the <region> is full.`). If none is left in an over-full region: `{ ok: false, reasons: ['The <region> can't hold the parts a <Plan> needs.'] }`.
8. Spine: remove middle segments while above `max`; duplicate segment 1 while below `min`; clamp to rules; locked segments take the rule value. One change `Body reshaped for a <Plan>.` if anything changed.
9. Assign uids to additions from `nextSerial` upward; return the new `nextSerial`.
10. Validate with `problems(result, plan, { unlocked, diet, anchorCheck })`, ignoring `dna`. Any problem → `{ ok: false, reasons }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/adapt.test.ts
import { describe, expect, it } from 'vitest';
import { adaptToPlan, nextUid, partStats, problems, starterFor, starterGenome, STARTER_NEXT_SERIAL, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { plan, PLANS } from '../../src/tiny-tide/plans';

let s = 50;
const P = (id: string, t: number, angle = 0, extra: Partial<PlacedPart> = {}): PlacedPart => ({ uid: nextUid(s++), id, t, angle, scale: 1, mirror: false, roll: 0, ...extra });
const ctx = { unlocked: [] as string[] };
const adapt = (g: Genome, id: string, c = ctx) => adaptToPlan(g, plan(id)!, c, 900);
const ok = (g: Genome, id: string) => { const a = adapt(g, id); if (!a.ok) throw new Error(`${id}: ${a.reasons.join(' ')}`); return a; };
const valid = (g: Genome, id: string) => expect(problems(g, plan(id)!, ctx).filter(p => p.code !== 'dna')).toEqual([]);

describe('adaptToPlan', () => {
  it('turns the starter into a Swimmer by removing the legs only', () => {
    const a = ok(starterGenome(), 'swimmer'); valid(a.genome, 'swimmer');
    expect(a.changes).toEqual(['Little leg removed: Swimmers can\'t use it.']); expect(a.genome.parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3']);
  });
  it('adds Shellback armor to the middle and keeps the eyes', () => {
    const a = ok(starterGenome(), 'shellback'); valid(a.genome, 'shellback');
    expect(a.genome.parts.some(p => p.id === 'eye_stalk')).toBe(true);
    expect(partStats(a.genome).armor).toBeGreaterThanOrEqual(2);
    for (const p of a.genome.parts.filter(p => p.id === 'spike')) expect(p.t).toBeGreaterThanOrEqual(.25);
  });
  it('satisfies a capability with a protective part, never with a horn', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('horn', .5), P('leg_little', .45, 2.47, { mirror: true })] };
    const a = ok(g, 'shellback'); expect(partStats(a.genome).armor).toBeGreaterThanOrEqual(2);
  });
  it('moves a part to the nearest region that allows it before removing anything', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('fin_side', .9, 1.6), P('tail_paddle', 1), P('leg_little', .45, 2.47, { mirror: true })] };
    const a = ok(g, 'crawler'); const fin = a.genome.parts.find(p => p.id === 'fin_side')!;
    expect(fin.t).toBe(.5); expect(a.changes).toContain('Side fin moved to the middle.');
  });
  it('fills a full head with a mouth by removing the cheapest optional part', () => {
    // head 4/4 with no mouth: bead-eye pair (cost round(5×2×1)=10) and antenna pair (round(6×2×1)=12); both give sense, so the cheaper bead pair goes.
    const g = { ...starterGenome(), parts: [P('eye_bead', .1, .6, { mirror: true }), P('antenna', .1, .5, { mirror: true }), P('tail_paddle', 1)] };
    const a = ok(g, 'speck'); valid(a.genome, 'speck');
    expect(a.genome.parts.some(p => p.id === 'mouth_nibbler')).toBe(true); expect(a.genome.parts.some(p => p.id === 'antenna')).toBe(true);
    expect(a.changes).toContain('Bead eye removed: the head is full.');
  });
  it('removes a part that fits nowhere with room, even when no region is over its limit', () => {
    // Crawler: middle full with three leg pairs (6/6); a fin in the tail (not allowed there) has nowhere to go: the head forbids fins.
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('leg_little', .3, 2.47, { mirror: true }), P('leg_little', .45, 2.47, { mirror: true }), P('leg_little', .6, 2.47, { mirror: true }), P('fin_side', .9, 1.6)] };
    const a = ok(g, 'crawler'); valid(a.genome, 'crawler'); expect(a.changes).toContain('Side fin removed: no room for it on a Crawler.');
  });
  it('replaces a full tail of fins with a required tail', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('eye_stalk', .16, .5, { mirror: true }), P('fin_side', .95, 1.6), P('fin_side', .9, 1.6)] };
    const a = ok(g, 'swimmer'); valid(a.genome, 'swimmer'); expect(a.genome.parts.some(p => p.id === 'tail_paddle')).toBe(true);
  });
  it('replaces a mouth of the wrong diet when a diet is given', () => {
    const a = adaptToPlan(starterGenome(), plan('swimmer')!, { unlocked: [], diet: 'carnivore' }, 900);
    expect(a.ok && a.genome.parts.find(p => p.id.startsWith('mouth_'))!.id).toBe('mouth_snapper');
    expect(a.ok && a.changes).toContain('Nibbler removed: your diet is now carnivore.');
  });
  it('is immutable and idempotent, and gives new parts fresh uids from nextSerial', () => {
    const g = starterGenome(), before = JSON.stringify(g), a = ok(g, 'shellback');
    expect(JSON.stringify(g)).toBe(before);
    const again = adapt(a.genome, 'shellback'); expect(again.ok && again.changes).toEqual([]);
    expect(a.genome.parts.filter(p => !['p1', 'p2', 'p3', 'p4'].includes(p.uid)).every(p => Number(p.uid.slice(1)) >= 900)).toBe(true);
  });
  it('reports failure honestly when the anchor check says no', () => {
    const a = adaptToPlan(starterGenome(), plan('speck')!, { unlocked: [], anchorCheck: () => false }, 900);
    expect(a).toEqual({ ok: false, reasons: ["This body can't fit anywhere at this size."] });
  });
  it('has a valid starter for every plan', () => { for (const p of PLANS) valid(starterFor(p), p.id); expect(STARTER_NEXT_SERIAL).toBe(5); });
});
```

Fixture angles avoid the centre line (`|sin angle| ≥ .3`): `.5` and `.6` are legal mirror angles; `.3` would be unpaired by step 3 and change the test.

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/adapt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `adaptToPlan` and `starterFor`** in `genome.ts`, following the 10 algorithm steps above. Constants: `const REGION_T: Record<Region, number> = { head: .12, middle: .5, tail: .92 };` and region distance `|REGION_T[a] − REGION_T[b]|`. Use `copies`, `partSlots`, `partCost`, `partStats`, `isUnlocked`, `badMirror`. `starterFor(p)` = `adaptToPlan(starterGenome(), p, { unlocked: [] }, STARTER_NEXT_SERIAL)` and throws `new Error(\`No starter for ${p.id}\`)` on failure.

- [ ] **Step 4: Run** the test file. Expected: PASS, every test in the file. A failing fixture means the algorithm is wrong; do not loosen the test.

- [ ] **Step 5: Checkpoint and commit** `git add src/tiny-tide/genome.ts tests/tiny-tide-core/adapt.test.ts && git commit -m "Tiny Tide: adaptToPlan that preserves parts and reports changes"`

---

### Task A5: The DNA ledger with atomic transactions

**Files:**
- Create: `src/tiny-tide/economy.ts`
- Test: `tests/tiny-tide-core/economy.test.ts`

**Interfaces:**
- Consumes: `partCost`, `Genome` (A3).
- Produces:

```ts
export interface DnaCredit { banked: number; atRisk: number }
export interface PartLedger { basis: number; credit: DnaCredit }
export interface Economy { wallet: DnaCredit; parts: Record<string, PartLedger> }
export interface Quote { spend: number; release: number; net: number; affordable: boolean; shortfall: number }
walletTotal(e); earn(e, amount): Economy; legacyEconomy(dna, g): Economy
quoteDesign(e, from, to): Quote
commitDesign(e, from, to): { ok: true; economy: Economy } | { ok: false; shortfall: number; invalid?: string[] }
bankAll(e): Economy; faintLegacy(e): Economy; faintCombat(e): Economy
validateLedger(e, g): string[]
```

Transaction rules (spec §8), with `credit total = banked + atRisk`:

| Part change (by uid) | Release | Purchase |
| --- | --- | --- |
| removed | all its credit | — |
| unchanged cost | 0 | 0 |
| new cost < basis | `floor(total × (old − new) / old)` with integers, at-risk first | — |
| new cost > basis | 0 | `new − old` |
| added | — | `partCost` |

**Domain:** every wallet, basis and credit value is a non-negative safe integer (`Number.isSafeInteger(v) && v >= 0`). `commitDesign` first validates the **current** ledger against `from`; an invalid one returns `{ ok: false, shortfall: 0, invalid }` and is never refunded. `earn` throws a `RangeError` if a total would stop being a safe integer.

All releases go into a pool with the wallet. Purchases are paid from the pool, at-risk first, as one sum. If the pool can't pay, the result is `{ ok: false, shortfall }` and nothing changes. Each part's paid amount is assigned to it in uid order (the split taken for each part follows the same at-risk-first order). New basis = `partCost(new)` for every kept part.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/economy.test.ts
import { describe, expect, it } from 'vitest';
import { bankAll, commitDesign, earn, faintCombat, faintLegacy, legacyEconomy, quoteDesign, validateLedger, walletTotal, type Economy } from '../../src/tiny-tide/economy';
import { partCost, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { PARTS } from '../../src/tiny-tide/parts';

const fin = (scale = 1, uid = 'p9'): Genome['parts'][number] => ({ uid, id: 'fin_side', t: .5, angle: 1.8, scale, mirror: true, roll: 0 });
const withParts = (g: Genome, ...parts: Genome['parts']) => ({ ...g, parts: [...g.parts, ...parts] });
const resize = (g: Genome, uid: string, scale: number) => ({ ...g, parts: g.parts.map(p => p.uid === uid ? { ...p, scale } : p) });
const commit = (e: Economy, a: Genome, b: Genome) => { const r = commitDesign(e, a, b); if (!r.ok) throw new Error(`short ${r.shortfall}`); return r.economy; };
describe('DNA ledger', () => {
  it('grandfathers legacy parts as banked credit equal to their cost', () => {
    const g = starterGenome(), e = legacyEconomy(20, g);
    expect(e.wallet).toEqual({ banked: 20, atRisk: 0 });
    expect(e.parts.p2).toEqual({ basis: 18, credit: { banked: 18, atRisk: 0 } }); expect(validateLedger(e, g)).toEqual([]);
  });
  it('puts rewards at risk and spends at-risk credit first', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(20, g), 15), g, withParts(g, fin()));   // fin pair costs 20
    expect(e.wallet).toEqual({ banked: 15, atRisk: 0 }); expect(e.parts.p9).toEqual({ basis: 20, credit: { banked: 5, atRisk: 15 } });
  });
  it('does not charge an unchanged design, even after a combat faint forfeits its credit', () => {
    const g = starterGenome(), bought = commit(earn(legacyEconomy(0, g), 20), g, withParts(g, fin())), after = faintCombat(bought);
    expect(after.parts.p9).toEqual({ basis: 20, credit: { banked: 0, atRisk: 0 } });
    expect(quoteDesign(after, withParts(g, fin()), withParts(g, fin()))).toMatchObject({ spend: 0, release: 0, net: 0, affordable: true });
    const removed = commit(after, withParts(g, fin()), g); expect(walletTotal(removed)).toBe(0);   // nothing to refund
    expect(quoteDesign(after, withParts(g, fin()), withParts(g, fin(1.8))).spend).toBe(8);          // 28 − 20
  });
  it('cross-finances a resize independent of array order (zero wallet)', () => {
    const g = starterGenome(), e = legacyEconomy(0, g);
    // tail p3: scale .8 (9) → 1.4 (12): buy 3. legs p4: .7 (14) → .4 (11): release floor(14 × 3/14) = 3.
    const to = resize(resize(g, 'p3', 1.4), 'p4', .4), reversed = { ...to, parts: [...to.parts].reverse() };
    for (const target of [to, reversed]) {
      const r = commit(e, g, target);
      expect(r.wallet).toEqual({ banked: 0, atRisk: 0 }); expect(r.parts.p3).toEqual({ basis: 12, credit: { banked: 12, atRisk: 0 } }); expect(r.parts.p4).toEqual({ basis: 11, credit: { banked: 11, atRisk: 0 } });
    }
    expect(quoteDesign(e, g, to)).toMatchObject({ spend: 3, release: 3, net: 0, affordable: true });
  });
  it('swaps two pair sizes without leaking DNA', () => {
    const g = withParts(starterGenome(), fin(.4, 'p9'), fin(1.8, 'p10')), e = legacyEconomy(0, g);   // 14 and 28
    const r = commit(e, g, resize(resize(g, 'p9', 1.8), 'p10', .4));    // p9 buys 14; p10 releases floor(28 × .5) = 14
    expect(walletTotal(r)).toBe(0); expect(r.parts.p9!.credit.banked + r.parts.p9!.credit.atRisk).toBe(28); expect(r.parts.p10!.basis).toBe(14);
  });
  it('rejects a short transaction with the shortfall and changes nothing', () => {
    const g = starterGenome(), e = legacyEconomy(5, g), r = commitDesign(e, g, withParts(g, fin()));
    expect(r).toEqual({ ok: false, shortfall: 15 }); expect(e.wallet).toEqual({ banked: 5, atRisk: 0 });
  });
  it('releases exactly the price difference on every fully credited shrink, for every part, pairing and size step', () => {
    for (const spec of PARTS) for (const mirror of spec.mirror ? [false, true] : [false]) for (let a = 40; a <= 180; a += 5) for (let b = 40; b < a; b += 5) {
      const at = (scale: number): Genome => ({ ...starterGenome(), parts: [{ uid: 'p9', id: spec.id, t: .5, angle: 1.6, scale: scale / 100, mirror, roll: 0 }] });
      const from = at(a), to = at(b), r = commit(legacyEconomy(0, from), from, to);
      expect(validateLedger(r, to), `${spec.id} ${mirror} ${a}→${b}`).toEqual([]);
      expect(walletTotal(r)).toBe(partCost(from.parts[0]!) - partCost(to.parts[0]!));
    }
  });
  it('handles the reported floating-point cases: 20→18, 15→14, 28→27', () => {
    for (const [a, b] of [[1, .8], [.5, .4], [1.8, 1.7]] as const) {
      const g = starterGenome(), from = withParts(g, fin(a)), to = withParts(g, fin(b)), r = commit(legacyEconomy(0, from), from, to);
      expect(validateLedger(r, to)).toEqual([]); expect(r.parts.p9!.credit.banked).toBe(r.parts.p9!.basis);
    }
  });
  it('releases shrink credit at-risk first', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(20, g), 15), g, withParts(g, fin()));   // p9 credit {5, 15}
    const r = commit(e, withParts(g, fin()), withParts(g, fin(.4)));   // 20 → 14: release floor(20 × 6/20) = 6, all at risk
    expect(r.parts.p9).toEqual({ basis: 14, credit: { banked: 5, atRisk: 9 } }); expect(r.wallet).toEqual({ banked: 15, atRisk: 6 });
  });
  it('banks everything on evolution; legacy faint keeps 70% of each wallet part; combat faint zeroes at-risk credit', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(50, g), 30), g, withParts(g, fin()));   // wallet {50, 10}, p9 {0, 20}
    expect(bankAll(e).wallet).toEqual({ banked: 60, atRisk: 0 }); expect(bankAll(e).parts.p9!.credit).toEqual({ banked: 20, atRisk: 0 });
    expect(faintLegacy(e).wallet).toEqual({ banked: 35, atRisk: 7 });
    const c = faintCombat(e); expect(c.wallet).toEqual({ banked: 50, atRisk: 0 }); expect(c.parts.p9!.credit).toEqual({ banked: 0, atRisk: 0 });
  });
  it('validates the ledger against the design', () => {
    const g = starterGenome(), e = legacyEconomy(0, g);
    expect(validateLedger({ ...e, parts: { ...e.parts, p2: { basis: 18, credit: { banked: 9999, atRisk: 0 } } } }, g)).toContain('ledger credit p2');
    const { p2: _p2, ...missing } = e.parts; expect(validateLedger({ ...e, parts: missing }, g)).toContain('ledger missing p2');
    expect(validateLedger({ ...e, parts: { ...e.parts, p9: { basis: 1, credit: { banked: 0, atRisk: 0 } } } }, g)).toContain('ledger extra p9');
    expect(validateLedger({ ...e, wallet: { banked: Number.NaN, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, parts: { ...e.parts, p3: { basis: 4, credit: { banked: 4, atRisk: 0 } } } }, g)).toContain('ledger basis p3');
    expect(validateLedger({ ...e, wallet: { banked: .5, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, wallet: { banked: Number.MAX_SAFE_INTEGER + 1, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, parts: { ...e.parts, p3: { basis: 9, credit: { banked: 8.5, atRisk: 0 } } } }, g)).toContain('ledger credit p3');
  });
  it('never refunds an invalid existing ledger', () => {
    const g = starterGenome(), e = legacyEconomy(20, g), forged = { ...e, parts: { ...e.parts, p2: { basis: 18, credit: { banked: 9999, atRisk: 0 } } } };
    const noEyes = { ...g, parts: g.parts.filter(p => p.uid !== 'p2') }, r = commitDesign(forged, g, noEyes);
    expect(r).toMatchObject({ ok: false, shortfall: 0, invalid: ['ledger credit p2'] }); expect(forged.wallet).toEqual({ banked: 20, atRisk: 0 });
  });
});
```

Hand checks: test 2 wallet `{20, 15}` pays 20 at-risk first (15) then banked (5). Test 8 setup: `earn 30` → wallet `{50, 30}`; fin pair 20 paid from at-risk → wallet `{50, 10}`, p9 `{0, 20}`; legacy faint → `{floor(35), floor(7)} = {35, 7}`.

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/economy.test.ts`. Expected: FAIL.

- [ ] **Step 3: Write `src/tiny-tide/economy.ts`**

```ts
// DNA with provenance. Rewards stay "at risk" until the next evolution banks
// them. Basis is what an installed part is worth; credit is what a refund can
// return. After a forfeit, a part keeps its basis and loses its credit.
import { partCost, type Genome } from './genome';

export interface DnaCredit { banked: number; atRisk: number }
export interface PartLedger { basis: number; credit: DnaCredit }
export interface Economy { wallet: DnaCredit; parts: Record<string, PartLedger> }
export interface Quote { spend: number; release: number; net: number; affordable: boolean; shortfall: number }
const total = (c: DnaCredit) => c.banked + c.atRisk;
export const walletTotal = (e: Economy) => total(e.wallet);
const clone = (e: Economy): Economy => ({ wallet: { ...e.wallet }, parts: Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, { basis: v.basis, credit: { ...v.credit } }])) });
export const earn = (e: Economy, amount: number): Economy => { const n = clone(e); n.wallet.atRisk += Math.max(0, Math.floor(amount)); if (!Number.isSafeInteger(total(n.wallet))) throw new RangeError('DNA total overflow'); return n; };
export const legacyEconomy = (dna: number, g: Genome): Economy => ({ wallet: { banked: Math.max(0, Math.floor(dna)), atRisk: 0 }, parts: Object.fromEntries(g.parts.map(p => [p.uid, { basis: partCost(p), credit: { banked: partCost(p), atRisk: 0 } }])) });
/** Takes up to `amount` from `from`, at-risk first. */
function take(from: DnaCredit, amount: number): DnaCredit {
  const atRisk = Math.min(from.atRisk, amount), banked = Math.min(from.banked, amount - atRisk);
  from.atRisk -= atRisk; from.banked -= banked; return { banked, atRisk };
}
const add = (a: DnaCredit, b: DnaCredit) => { a.banked += b.banked; a.atRisk += b.atRisk; };
interface Plan { releases: { uid: string; amount: number }[]; purchases: { uid: string; amount: number }[]; removed: string[]; basis: Record<string, number> }
function planDesign(e: Economy, from: Genome, to: Genome): Plan {
  const before = new Map(from.parts.map(p => [p.uid, p])), plan: Plan = { releases: [], purchases: [], removed: [], basis: {} };
  for (const p of from.parts) if (!to.parts.some(q => q.uid === p.uid)) { plan.removed.push(p.uid); plan.releases.push({ uid: p.uid, amount: total(e.parts[p.uid]?.credit ?? { banked: 0, atRisk: 0 }) }); }
  for (const p of [...to.parts].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const cost = partCost(p); plan.basis[p.uid] = cost;
    if (!before.has(p.uid)) { plan.purchases.push({ uid: p.uid, amount: cost }); continue; }
    const old = e.parts[p.uid]?.basis ?? partCost(before.get(p.uid)!), credit = total(e.parts[p.uid]?.credit ?? { banked: 0, atRisk: 0 });
    if (cost > old) plan.purchases.push({ uid: p.uid, amount: cost - old });
    // Integer arithmetic: never subtract a rounded ratio from 1 (20 × (1 − 18/20) is 1.999… in floating point).
    else if (cost < old && old > 0) plan.releases.push({ uid: p.uid, amount: Math.floor((credit * (old - cost)) / old) });
  }
  return plan;
}
export function quoteDesign(e: Economy, from: Genome, to: Genome): Quote {
  const p = planDesign(e, from, to), spend = p.purchases.reduce((n, x) => n + x.amount, 0), release = p.releases.reduce((n, x) => n + x.amount, 0);
  const shortfall = Math.max(0, spend - release - walletTotal(e));
  return { spend, release, net: spend - release, affordable: shortfall === 0, shortfall };
}
export function commitDesign(e: Economy, from: Genome, to: Genome): { ok: true; economy: Economy } | { ok: false; shortfall: number; invalid?: string[] } {
  const invalid = validateLedger(e, from); if (invalid.length) return { ok: false, shortfall: 0, invalid };   // never refund forged or corrupt credit
  const q = quoteDesign(e, from, to); if (!q.affordable) return { ok: false, shortfall: q.shortfall };
  const n = clone(e), p = planDesign(e, from, to);
  for (const r of p.releases) add(n.wallet, take(n.parts[r.uid]!.credit, r.amount));   // releases first: they fund purchases
  for (const uid of p.removed) delete n.parts[uid];
  for (const b of p.purchases) { const paid = take(n.wallet, b.amount); n.parts[b.uid] ??= { basis: 0, credit: { banked: 0, atRisk: 0 } }; add(n.parts[b.uid]!.credit, paid); }
  for (const [uid, basis] of Object.entries(p.basis)) n.parts[uid]!.basis = basis;
  // Postcondition: the ledger we return must be one the loader accepts.
  const issues = validateLedger(n, to); if (issues.length) throw new Error(`ledger invariant: ${issues.join(', ')}`);
  return { ok: true, economy: n };
}
export function bankAll(e: Economy): Economy { const n = clone(e), bank = (c: DnaCredit) => { c.banked += c.atRisk; c.atRisk = 0; }; bank(n.wallet); Object.values(n.parts).forEach(p => bank(p.credit)); return n; }
export function faintLegacy(e: Economy): Economy { const n = clone(e); n.wallet = { banked: Math.floor(n.wallet.banked * .7), atRisk: Math.floor(n.wallet.atRisk * .7) }; return n; }
/** Sub-project 3: every at-risk credit is lost. Basis, design and banked credit stay. */
export function faintCombat(e: Economy): Economy { const n = clone(e); n.wallet.atRisk = 0; for (const p of Object.values(n.parts)) p.credit.atRisk = 0; return n; }
const dna = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nonNeg = (c: DnaCredit) => !!c && dna(c.banked) && dna(c.atRisk) && Number.isSafeInteger(c.banked + c.atRisk);
export function validateLedger(e: Economy, g: Genome): string[] {
  const out: string[] = [];
  if (!e?.wallet || !nonNeg(e.wallet)) out.push('ledger wallet');
  const uids = new Set(g.parts.map(p => p.uid));
  for (const p of g.parts) {
    const l = e?.parts?.[p.uid];
    if (!l) { out.push(`ledger missing ${p.uid}`); continue; }
    if (!dna(l.basis) || l.basis !== partCost(p)) out.push(`ledger basis ${p.uid}`);
    if (!nonNeg(l.credit) || total(l.credit) > l.basis) out.push(`ledger credit ${p.uid}`);
  }
  for (const uid of Object.keys(e?.parts ?? {})) if (!uids.has(uid)) out.push(`ledger extra ${uid}`);
  return out;
}
```

The purchases loop runs in uid order, so the split each part receives is deterministic and independent of the design's array order.

- [ ] **Step 4: Run** `npx vitest run tests/tiny-tide-core/economy.test.ts`. Expected: PASS, every test in the file. (Fin pair costs: scale 1 → 20, .8 → 18, .5 → 15, .4 → 14, 1.8 → 28, 1.7 → round(20 × 1.35) = 27.)

- [ ] **Step 5: Checkpoint and commit** `git add src/tiny-tide/economy.ts tests/tiny-tide-core/economy.test.ts && git commit -m "Tiny Tide: DNA ledger with cost basis and atomic transactions"`

---

### Task A6: Run v4, transactions on the run, and shared validation

**Files:**
- Modify: `src/tiny-tide/state.ts`
- Modify (call sites only): `src/tiny-tide/main.ts`, `src/tiny-tide/editor.ts`
- Modify: `tests/tiny-tide.test.ts` (delete tests that move to the new file)
- Test: `tests/tiny-tide-core/state.test.ts`

**Interfaces:**
- Consumes: A2–A5.
- Produces:

```ts
export interface ArchivedDesign { genome: Genome; name: string; savedAt: string; reason: string }
export interface Run { version: 4; seed: number; name: string; stage: number; plans: string[]; diet: Diet; economy: Economy; stageDna: number; totalDna: number;
  bites: number; elapsed: number; deaths: number; health: number; genome: Genome; nextPartSerial: number; unlocked: string[]; eatenPlanets: number[]; completed: boolean;
  loadout: { active: [unknown | null, unknown | null] }; pendingRespawn: boolean; mechanics: Record<string, unknown>; archive: ArchivedDesign[]; notices: string[] }
export interface Build { coast: boolean; anchorCheck?: (g: Genome, p: BodyPlan) => boolean }
export type Commit = { ok: true; clearedBindings: number[] } | { ok: false; reason: string; shortfall?: number }
export interface Prepared { planId: string; genome: Genome; name: string; economy: Economy; diet: Diet; nextSerial: number }
mealDna(plan, diet, spec): number                       // round(spec.dna × dietRate × forage), one rounding
dnaOf, currentPlan, freshRun, maxHealthOf(run), eat, reward, faint(run): boolean
applyDesign(run, g, name, build, nextSerial, catalog = PARTS): Commit
prepareEvolution(run, planId, g, name, build, nextSerial, catalog = PARTS): Prepared | { ok: false; reason; shortfall? }
commitEvolution(run, prepared): number[]          // cleared binding slots
validateRun(run, build, catalog = PARTS): string[]
interface LegacyRunV2 { stage; dna; stageDna; totalDna; bites; elapsed; deaths; health; seed; name; unlocked; eatenPlanets; completed; genomeRaw: unknown }
```

The loadout's element type is `unknown | null` in Plan A; Plan B Task B2 narrows it to `AbilityBinding | null` and adds binding validation. `validateRun` checks the tuple shape here (exactly two elements, each `null` or an object); B2 extends it.

Rules:
- `applyDesign(run, g, name, build, nextSerial)`: same plan; `problems(g, currentPlan(run), { unlocked, diet: run.diet, anchorCheck: build.anchorCheck }, catalog)` must have no non-DNA problem; `commitDesign` must succeed. Then build the **candidate run** (new genome, economy, name, `nextPartSerial = max(run.nextPartSerial, nextSerial, max serial in genome + 1)`, health `min(health, maxHealth)`, bindings cleared for missing parts or grants) and run `validateRun(candidate, build, catalog)`. Only if it is clean, copy the candidate into `run` (atomic). Otherwise return `{ ok: false, reason: 'Internal check failed: <first issue>' }` and change nothing.
- `prepareEvolution`: `evolveReady`; plan in `eligibleChildren(run.plans, build)`; `problems(g, next, { unlocked, diet: dietOf(g), anchorCheck }, catalog)` clean; `commitDesign` succeeds; the candidate run (as `commitEvolution` would build it) passes `validateRun`. Returns `Prepared` (with `nextSerial`) or `{ ok: false, reason, shortfall? }`. **No mutation.** Plan C adds the physical destination to `Prepared`.
- `commitEvolution`: applies a `Prepared` atomically: `economy = bankAll(prepared.economy)`, genome, name, diet, `plans.push`, `stage++`, `stageDna = 0`, `health = maxHealth`, serial, clear bindings to removed parts.
- `faint(run)`: if `pendingRespawn` is already true, return `false` and change nothing (a second lethal event cannot apply the loss twice). Otherwise `deaths++`, `economy = faintLegacy(economy)`, `pendingRespawn = true`, return `true`. Health is restored by Plan C's `resolveRespawn`.
- `mealDna(plan, diet, spec) = dietCanEat(diet, spec.tag) ? Math.round(spec.dna × (diet === 'omnivore' && spec.tag !== 'any' ? OMNIVORE_RATE : 1) × forage) : 0`, where `forage` is the plan's multiplier for `spec.habitatProfileId` (else 1). One rounding. `eat` and every budget test use it; `dnaFor` stays for non-plan callers.
- `validateRun(run, build)`: the strict genome reader (`sanitizeGenome(run.genome) !== null`, issue `genome shape`: exact global ranges, paint, uids — the same check the v4 loader uses, so every successful commit reloads unchanged); path (root, sizes, parents), commitments and closures, `needs coast` (one entry, even if several plans need it), diet equals mouth diet, `problems` of the design (ignoring `dna` and `anchor`), `validateLedger`, `nextPartSerial > every uid serial`, loadout tuple shape, `pendingRespawn` boolean, `mechanics` object, `archive` entries sanitized, `notices` strings.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/state.test.ts
import { describe, expect, it } from 'vitest';
import { applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, mealDna, prepareEvolution, STAGES, validateRun, type Run } from '../../src/tiny-tide/state';
import { adaptToPlan, nextUid, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';
import { species } from '../../src/tiny-tide/species';

const build = { coast: false };
const ready = (seed = 1) => { const r = freshRun(seed); r.stageDna = STAGES[0]!.goal; return r; };
const design = (g: Genome, id: string, diet?: 'carnivore') => { const a = adaptToPlan(g, plan(id)!, { unlocked: [], diet }, 50); if (!a.ok) throw new Error(a.reasons.join(' ')); return a.genome; };
const evolveTo = (r: Run, id: string, g: Genome, name = r.name) => { const p = prepareEvolution(r, id, g, name, build, r.nextPartSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p); };
describe('run v4', () => {
  it('starts on Speck with 20 banked DNA, a herbivore diet, an empty two-slot loadout and serial 5', () => {
    const r = freshRun(1);
    expect(r).toMatchObject({ version: 4, plans: ['speck'], diet: 'herbivore', nextPartSerial: 5, pendingRespawn: false, archive: [], notices: [], mechanics: {} });
    expect(dnaOf(r)).toBe(20); expect(r.loadout.active).toEqual([null, null]); expect(validateRun(r, build)).toEqual([]);
  });
  it('earns at risk, with the plan foraging bonus for matching food', () => {
    const r = ready(); evolveTo(r, 'crawler', r.genome);
    const before = dnaOf(r); eat(r, species(1, 'seagrape'), 0);
    expect(dnaOf(r) - before).toBe(15); expect(r.economy.wallet.atRisk).toBe(15);   // round(12 × 1.25)
  });
  it('prepares without mutating, then commits atomically, banking DNA and setting the diet', () => {
    const r = ready(), snapshot = JSON.stringify(r);
    expect('reason' in prepareEvolution(r, 'darter', r.genome, r.name, build, r.nextPartSerial)).toBe(true);
    expect(prepareEvolution(r, 'swimmer', r.genome, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: "Swimmers can't use little leg." });
    const g = design(r.genome, 'swimmer', 'carnivore'), p = prepareEvolution(r, 'swimmer', g, 'Fin', build, r.nextPartSerial);
    expect(JSON.stringify(r)).toBe(snapshot);
    if (!('planId' in p)) throw new Error('prepare'); commitEvolution(r, p);
    expect(r.plans).toEqual(['speck', 'swimmer']); expect(r.diet).toBe('carnivore'); expect(r.economy.wallet.atRisk).toBe(0); expect(validateRun(r, build)).toEqual([]);
  });
  it('rejects an evolution whose body has no start anchor, without changing the run', () => {
    const r = ready(), snapshot = JSON.stringify(r), g = design(r.genome, 'crawler');
    expect(prepareEvolution(r, 'crawler', g, r.name, { coast: false, anchorCheck: () => false }, r.nextPartSerial)).toMatchObject({ ok: false, reason: "This body can't fit anywhere at this size." });
    expect(JSON.stringify(r)).toBe(snapshot);
  });
  it('keeps the diet fixed in a normal edit', () => {
    const r = freshRun(2), g = { ...r.genome, parts: r.genome.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, id: 'mouth_snapper' } : p) };
    expect(applyDesign(r, g, r.name, build, r.nextPartSerial)).toEqual({ ok: false, reason: 'Diet is set until your next evolution.' });
  });
  it('charges edits through the ledger and reports the shortfall', () => {
    const r = freshRun(3), fins = { ...r.genome, parts: [...r.genome.parts, { uid: nextUid(5), id: 'fin_side', t: .5, angle: 1.8, scale: 1, mirror: true, roll: 0 }] };
    expect(applyDesign(r, fins, r.name, build, 6)).toEqual({ ok: true, clearedBindings: [] }); expect(dnaOf(r)).toBe(0); expect(r.nextPartSerial).toBe(6);
    const bigger = { ...fins, parts: fins.parts.map(p => p.uid === 'p5' ? { ...p, scale: 1.4 } : p) };   // round(10 × 2 × 1.2) = 24: buy 4, still 2 slots
    expect(applyDesign(r, bigger, r.name, build, 6)).toEqual({ ok: false, reason: 'Not enough DNA.', shortfall: 4 });
    const spike = { ...fins, parts: [...fins.parts, { uid: nextUid(6), id: 'spike', t: .3, angle: 0, scale: 1, mirror: false, roll: 0 }] };
    expect(applyDesign(r, spike, r.name, build, 7)).toEqual({ ok: false, reason: 'Too complex: 9 / 8 slots.' });   // structure is checked before money
    expect(dnaOf(r)).toBe(0); expect(r.genome).toEqual(fins);
  });
  it('faints once with the legacy rule and marks a pending respawn', () => {
    const r = freshRun(4); eat(r, species(0, 'plant'), 0); expect(faint(r)).toBe(true);
    expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 });   // floor(20 × .7), floor(8 × .7)
    expect(r.pendingRespawn).toBe(true); expect(r.deaths).toBe(1);
    expect(faint(r)).toBe(false); expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 }); expect(r.deaths).toBe(1);
  });
  it('computes meal DNA with one rounding', () => {
    expect(mealDna(plan('burrower')!, 'omnivore', species(2, 'plant'))).toBe(16);   // round(16 × .7 × 1.4) = round(15.68)
    expect(mealDna(plan('crawler')!, 'carnivore', species(1, 'snail'))).toBe(16);  // round(13 × 1.25) = round(16.25)
    expect(mealDna(plan('crawler')!, 'herbivore', species(1, 'snail'))).toBe(0);
  });
  it('rejects designs the v4 reader would reject, atomically', () => {
    for (const bad of [(g: Genome) => { g.paint.base = 'not-a-color'; }, (g: Genome) => { g.spine[0]!.radius = 1.2000005; }]) {
      const r = freshRun(7), g = structuredClone(r.genome); bad(g); const snapshot = JSON.stringify(r);
      expect(applyDesign(r, g, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: 'Internal check failed: genome shape' }); expect(JSON.stringify(r)).toBe(snapshot);
    }
  });
  it('rejects a run whose current ledger is invalid, without refunding it', () => {
    const r = freshRun(5); r.economy.parts.p2 = { basis: 18, credit: { banked: 9999, atRisk: 0 } };
    const snapshot = JSON.stringify(r), noEyes = { ...r.genome, parts: r.genome.parts.filter(p => p.uid !== 'p2') };
    expect(applyDesign(r, noEyes, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: 'Internal check failed: ledger credit p2' }); expect(JSON.stringify(r)).toBe(snapshot);
  });
  it('keeps the serial high-water mark from the editor', () => {
    const r = freshRun(6), g = { ...r.genome, parts: [...r.genome.parts, { uid: 'p7', id: 'spike', t: .5, angle: 0, scale: 1, mirror: false, roll: 0 }] };   // p5 and p6 were reserved then removed
    expect(applyDesign(r, g, r.name, build, 9)).toMatchObject({ ok: true }); expect(r.nextPartSerial).toBe(9);
  });
  it('validates every run field', () => {
    const r = ready(); evolveTo(r, 'crawler', r.genome);
    const bad: unknown[] = [
      { ...r, plans: ['speck', 'swimmer'] }, { ...r, plans: ['speck', 'darter'] }, { ...r, diet: 'carnivore' },
      { ...r, nextPartSerial: 2 }, { ...r, loadout: { active: [null, null, null] } }, { ...r, loadout: { active: [0, null] } },
      { ...r, pendingRespawn: 'yes' }, { ...r, economy: { ...r.economy, wallet: { banked: -1, atRisk: 0 } } },
      { ...r, genome: { ...r.genome, parts: [...r.genome.parts, { ...r.genome.parts[0]! }] } },
    ];
    for (const b of bad) expect(validateRun(b as Run, build).length, JSON.stringify(b).slice(0, 60)).toBeGreaterThan(0);
    const coastRun = { ...ready(), stage: 2, plans: ['speck', 'shore_walker', 'mudskipper'] } as Run;
    expect(validateRun(coastRun, build).filter(x => x === 'needs coast')).toEqual(['needs coast']);
  });
  it('reads the current plan from the path', () => { const r = ready(); evolveTo(r, 'crawler', r.genome); expect(currentPlan(r).id).toBe('crawler'); });
});
```

Hand checks: the fins test wallet 20 pays the 20-DNA pair → 0 (the starter uses 6 of 8 instances, the pair makes 8); resizing the pair to 1.4 costs `round(10 × 2 × (.5 + .7)) = 24`, so 4 more; adding a spike makes 9 instances, which fails structurally first. The faint test: `plant` gives 8 DNA at risk (herbivore, no foraging at Speck) → wallet `{20, 8}` → `{14, 5}`. The message `"Swimmers can't use little leg."` comes from A3's `banned` text with `spec.name.toLowerCase()` = `little leg`.

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/state.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `state.ts`. Remove the old `evolve(run)`, `applyDesign(run, genome, name, cost)` and `faint` bodies; keep `STAGES`, `inReach`, `dnaFor`, `dietCanEat`, `growthOf`, `evolveReady`, `damageAfterArmor`, `hurt`, `unlock`. Imports must be exactly what the new code uses (no `genomeCost`, `PLANS`, or `habitat` unless used).

```ts
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
const serialAfter = (g: Genome, ...floors: number[]) => Math.max(...floors, ...g.parts.map(p => uidSerial(p.uid) + 1));
type Failure = { ok: false; reason: string; shortfall?: number };
/** Clears bindings whose part is gone or whose catalog spec no longer has the grant (Plan B extends the binding type). */
function clearMissing(run: Run, catalog: readonly PartSpec[]) {
  const cleared: number[] = [];
  run.loadout.active = run.loadout.active.map((b, i) => {
    const binding = b as { partUid?: string; grantId?: string } | null; if (!binding) return b;
    const placed = run.genome.parts.find(p => p.uid === binding.partUid), spec = placed && catalog.find(s => s.id === placed.id);
    const hasGrant = !!spec && ((spec as { activeGrants?: { id: string }[] }).activeGrants ?? []).some(g => g.id === binding.grantId);
    if (!placed || (binding.grantId !== undefined && !hasGrant)) { cleared.push(i); return null; } return b;
  }) as Run['loadout']['active'];
  return cleared;
}
/** Runs every check on a copy; returns the copy only when it is valid. Never mutates `run`. */
function candidate(run: Run, change: (c: Run) => void, build: Build, catalog: readonly PartSpec[]): { run: Run; cleared: number[] } | Failure {
  const c = structuredClone(run); change(c); const cleared = clearMissing(c, catalog);
  const issues = validateRun(c, build, catalog); return issues.length ? { ok: false, reason: `Internal check failed: ${issues[0]}` } : { run: c, cleared };
}
export function applyDesign(run: Run, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Commit {
  const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
  const issue = problems(g, currentPlan(run), { unlocked: run.unlocked, diet: run.diet, anchorCheck: build.anchorCheck }, catalog).find(x => x.code !== 'dna');
  if (issue) return { ok: false, reason: issue.message };
  const tx = commitDesign(run.economy, run.genome, g);
  if (!tx.ok) return tx.invalid ? { ok: false, reason: `Internal check failed: ${tx.invalid[0]}` } : { ok: false, reason: 'Not enough DNA.', shortfall: tx.shortfall };
  const next = candidate(run, c => { c.economy = tx.economy; c.genome = cloneGenome(g); c.name = name.trim().slice(0, 24) || c.name;
    c.nextPartSerial = serialAfter(g, c.nextPartSerial, nextSerial); c.health = Math.min(c.health, maxHealthOf(c)); }, build, catalog);
  if ('ok' in next) return next;
  Object.assign(run, next.run); return { ok: true, clearedBindings: next.cleared };
}
export function prepareEvolution(run: Run, planId: string, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Prepared | Failure {
  const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
  if (!evolveReady(run)) return { ok: false, reason: 'Not ready to evolve.' };
  const next = eligibleChildren(run.plans, build).find(p => p.id === planId); if (!next) return { ok: false, reason: 'That path is not open.' };
  const diet = dietOf(g), issue = problems(g, next, { unlocked: run.unlocked, diet, anchorCheck: build.anchorCheck }, catalog).find(x => x.code !== 'dna');
  if (issue) return { ok: false, reason: issue.message };
  const tx = commitDesign(run.economy, run.genome, g);
  if (!tx.ok) return tx.invalid ? { ok: false, reason: `Internal check failed: ${tx.invalid[0]}` } : { ok: false, reason: 'Not enough DNA.', shortfall: tx.shortfall };
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
/** Applies the legacy faint once. A second call while a respawn is pending changes nothing. */
export function faint(run: Run): boolean {
  if (run.pendingRespawn) return false;
  run.deaths++; run.economy = faintLegacy(run.economy); run.pendingRespawn = true; return true;
}
```

`eat` uses `run.economy = earn(run.economy, dna)`; the foraging multiplier is `currentPlan(run).foraging.find(f => f.habitat === spec.habitatProfileId)?.dnaMultiplier ?? 1`. Today `Species` has no `habitatProfileId`; add a temporary field in `species.ts` in this task: `habitatProfileId: string` with the behavior defaults `still → 'sp-seabed'`, `graze → 'sp-seabed'`, `drift|school|skittish → 'sp-water'`, `flyer → 'sp-air'` (Plan B Task B2 extends species with the rest of the contract, keeps these defaults, and adds the per-species overrides such as the balloon's `sp-air`). `reward(run, dna, countsForStage)` uses `earn` too.

Legacy readers in this task: change today's `parseV2` and `migrateV1` to return `LegacyRunV2 | null` (the old v2 fields plus `genomeRaw`, the unsanitized genome object). They no longer build a `Run`. Until A7, `parseSave` returns `null` for v1/v2 data (a fresh run starts). This keeps every type correct between A6 and A7.

`validateRun` as described in the rules above, using `validateLedger(run.economy, run.genome)`, `commitmentsOf`, `closedLinesOf`, `violates`, `problems(...).filter(x => x.code !== 'dna' && x.code !== 'anchor')`. Return one `'needs coast'` entry at most.

- [ ] **Step 4: Update call sites**

- `main.ts`:
  - Use `const BUILD: Build = { coast: COAST_READY }` (no anchor check until Plan C).
  - Replace every `run.dna` read with `dnaOf(run)`.
  - The defeat reward becomes `reward(run, dna, food.tier === run.stage)`.
  - Edit mode: `const result = applyDesign(run, g, name, BUILD, editorResult.nextSerial); if (!result.ok) toast(result.reason);`
  - Evolve mode (temporary until Plan C adds the path screen), using the first eligible child:

    ```ts
    const next = eligibleChildren(run.plans, BUILD)[0]!;
    const adapted = adaptToPlan(result.genome, next, { unlocked: run.unlocked }, run.nextPartSerial);
    const prepared = adapted.ok ? prepareEvolution(run, next.id, adapted.genome, result.name, BUILD, Math.max(result.nextSerial, adapted.nextSerial)) : null;
    if (prepared && 'planId' in prepared) commitEvolution(run, prepared); else toast('That evolution is not possible yet.');
    ```

  - Pass `plan: currentPlan(run)` in edit mode, and the chosen child in evolve mode.
  - Save key `tiny-tide-adventure-v4`.
  - Loading: `parseSave` (A7 adds the v4 reader; until then the old v2/v1 reader returns `null` for v4). The temporary fallback is that `freshRun()` starts when nothing parses.
  - After the faint timeout, set `run.health = maxHealthOf(run); run.pendingRespawn = false;` (Plan C replaces this with `resolveRespawn`).
- `editor.ts`: replace its own `serial` field with `EditorOptions.nextSerial` (main passes `run.nextPartSerial`); the editor advances it on every addition and never moves it back on undo. `EditorResult` gains `nextSerial` (the high-water mark); main passes it to `applyDesign` / `prepareEvolution`.
- `tests/tiny-tide.test.ts`: delete these tests, because their v4 versions now live in `state.test.ts` and `economy.test.ts`:
  - `fills the stage bar…`
  - `wins only after all 12 distinct planets` (move this one to `state.test.ts` unchanged, with `freshRun` v4)
  - `applies an editor design…`
  - `unlocks a part early…`
  - `reduces damage with armor…`
  - the whole `Tiny Tide saves` block (A7 re-adds save tests)

- [ ] **Step 5: Checkpoint and commit.** Run the standard checkpoint. Do **not** run `e2e/tiny-tide-mobile.mjs` and `e2e/tiny-tide-replay.mjs` in this task: their v1 fixtures need A7's migration and would start a fresh run here. A7's checkpoint runs them.

`git add src/tiny-tide/state.ts src/tiny-tide/species.ts src/tiny-tide/main.ts src/tiny-tide/editor.ts tests && git commit -m "Tiny Tide: run v4 with prepared evolutions and ledger-backed edits"`

---

### Task A7: v4 saves, v2 migration, archive

**Files:**
- Modify: `src/tiny-tide/state.ts`, `src/tiny-tide/main.ts` (load call)
- Test: `tests/tiny-tide-core/saves.test.ts`

**Interfaces:**
- Produces:
  - `type Loaded = { status: 'ok'; run: Run; notes: string[] } | { status: 'kept'; message: string }`
  - `parseSaveWithNotes(raw: string | null, build: Build): Loaded | null` — `null` means no save or unreadable data.
  - `parseSave(raw, build?)`: the run or null (tests).
  - `migrateV2(old, build): Run` (exported for tests).

Migration rules (spec §11):

1. `repairLegacyGenome(genomeRaw)` gives the original with uids `p1..pn` and values in range. It is archived as `{ genome, name, savedAt: ISO time, reason: 'Saved before the body-plan update.' }`.
2. Line: legs and no tail → Crawler line (`crawler` first); otherwise Swimmer line (`swimmer` first).
3. Candidate histories: every path `[speck, lineRoot, …]` of length `stage + 1` built with `eligibleChildren` (coast off). For each, adapt the **original** once to the path's **final** plan: `adaptToPlan(original, finalPlan, { unlocked: old.unlocked, diet: dietOf(original) }, nextSerial)`. Intermediate plans are not applied (their unlocks, slots and segment limits do not touch the final creature); the path's commitments already restrict the final plan.
4. Score each successful candidate, in this order: (a) total `partCost` of original parts whose uid survives, higher first; (b) diet kept; (c) an **exact fit** (the adapted genome equals the repaired original) before any changed one; (d) fewer segments added or removed; (e) the smallest sum of `|Δradius| + |Δheight| + |Δlift|` over segment indices present in both; (f) fewer parts whose `t`, `angle` or `scale` changed; (g) the first path. Choose the best. If none succeeds, use the first path with `starterFor(finalPlan)` and the notice `Your old design could not fit a <Plan>; it is saved in your archive.`
5. Ledger: `legacyEconomy(oldDna, original)` (every original part banked at its current cost), then `commitDesign(…, original, adapted)`. If short, add the shortfall to `wallet.banked` first and add the notice `We covered N DNA for required parts.`
6. Notices: `<Name> became a <final Plan>.`, then the adaptation's change list.
7. `nextPartSerial` = 1 + the highest serial used; `pendingRespawn` false; `mechanics` `{}`; loadout `[null, null]`; health `min(old health, max)`, or the max when that is ≤ 0.

`main.ts` (this task): the loader records which key it read. A run that came from a v1/v2 key is saved to `tiny-tide-adventure-v4`; **the v1/v2 keys are never written** (Plan C Task C10 adds the kept-save storage rules).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/saves.test.ts
import { describe, expect, it } from 'vitest';
import { commitEvolution, dnaOf, freshRun, parseSave, parseSaveWithNotes, prepareEvolution, STAGES, validateRun } from '../../src/tiny-tide/state';
import { adaptToPlan, starterGenome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';

const build = { coast: false };
const legacyParts = (parts = starterGenome().parts) => parts.map(({ uid: _u, ...p }) => p);
const v2 = (extra: object) => JSON.stringify({ version: 2, seed: 5, name: 'Old', stage: 1, dna: 30, stageDna: 10, totalDna: 40, bites: 3, elapsed: 50, deaths: 0, health: 6,
  genome: { spine: starterGenome().spine, parts: legacyParts(), paint: starterGenome().paint }, unlocked: [], eatenPlanets: [], completed: false, ...extra });
describe('v4 saves', () => {
  it('round-trips a v4 run', () => {
    const r = freshRun(1); r.stageDna = STAGES[0]!.goal;
    const g = adaptToPlan(r.genome, plan('crawler')!, { unlocked: [] }, r.nextPartSerial); if (!g.ok) throw new Error('adapt');
    const p = prepareEvolution(r, 'crawler', g.genome, r.name, build, g.nextSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p);
    expect(parseSave(JSON.stringify(r), build)).toEqual(r);
  });
  it('keeps an exactly fitting long creature unchanged instead of cutting segments', () => {
    const seven = Array.from({ length: 7 }, () => ({ radius: .6, height: .6, lift: 0 })), parts = legacyParts(starterGenome().parts.filter(p => p.id !== 'leg_little'));
    const run = parseSave(v2({ stage: 2, genome: { spine: seven, parts, paint: starterGenome().paint } }), build)!;
    expect(run.plans).toEqual(['speck', 'swimmer', 'bulk']); expect(run.genome.spine).toEqual(seven); expect(run.genome.parts.map(p => p.id)).toEqual(parts.map(p => p.id));
  });
  it('keeps a coast save, however many coast plans its path has', () => {
    const r = { ...freshRun(1), stage: 2, plans: ['speck', 'shore_walker', 'mudskipper'] };
    expect(parseSaveWithNotes(JSON.stringify(r), build)).toEqual({ status: 'kept', message: 'This creature lives on the coast. The coast is not in this version yet; your save is kept.' });
  });
  it('rejects corrupt v4 data', () => {
    const r = freshRun(1);
    for (const bad of [{ ...r, version: 5 }, { ...r, plans: 'speck' }, { ...r, economy: null }, { ...r, genome: { ...r.genome, parts: 'x' } }]) expect(parseSaveWithNotes(JSON.stringify(bad), build)).toBeNull();
  });
});
describe('v2 migration', () => {
  it('sends a starter with legs and a tail to the Swimmer line, archives it, and keeps its value (30 + 14 = 44)', () => {
    const loaded = parseSaveWithNotes(v2({}), build); if (loaded?.status !== 'ok') throw new Error('load');
    const r = loaded.run;
    expect(r.plans).toEqual(['speck', 'swimmer']); expect(r.archive).toHaveLength(1); expect(r.archive[0]!.name).toBe('Old');
    expect(dnaOf(r)).toBe(44); expect(validateRun(r, build)).toEqual([]);
    expect(loaded.notes[0]).toBe('Old became a Swimmer.'); expect(loaded.notes).toContain("Little leg removed: Swimmers can't use it.");
  });
  it('sends legs without a tail to the Crawler line', () => {
    const parts = legacyParts(starterGenome().parts.filter(p => p.id !== 'tail_paddle'));
    const loaded = parseSaveWithNotes(v2({ genome: { spine: starterGenome().spine, parts, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans).toEqual(['speck', 'crawler']);
  });
  it('chooses the size-2 descendant that keeps the most parts', () => {
    const wide = { spine: starterGenome().spine.map(s => ({ ...s, radius: 1, height: .9 })), parts: legacyParts(), paint: starterGenome().paint };
    const loaded = parseSaveWithNotes(v2({ stage: 2, genome: wide }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans).toEqual(['speck', 'swimmer', 'bulk']);   // same parts kept either way; Darter shrinks the spine, Bulk does not → smaller spine change wins
    expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('covers a shortfall for required parts and says so', () => {
    const noTail = legacyParts(starterGenome().parts.filter(p => p.id !== 'tail_paddle' && p.id !== 'leg_little'));   // mouth + eyes: Swimmer line, needs a tail
    const loaded = parseSaveWithNotes(v2({ dna: 0, genome: { spine: starterGenome().spine, parts: noTail, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.notes).toContain('We covered 10 DNA for required parts.');   // Paddle tail at scale 1: round(10 × 1 × 1)
    expect(dnaOf(loaded.run)).toBe(0); expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('keeps a legal late-game design whole: Maw, wing pair and the omnivore diet', () => {
    const parts = [{ id: 'mouth_maw', t: 0, angle: 0, scale: 1, mirror: false, roll: 0 }, { id: 'eye_stalk', t: .16, angle: .5, scale: .75, mirror: true, roll: 0 },
      { id: 'tail_paddle', t: 1, angle: 0, scale: .8, mirror: false, roll: 0 }, { id: 'wing_feather', t: .4, angle: 1.2, scale: 1, mirror: true, roll: 0 }];
    const loaded = parseSaveWithNotes(v2({ stage: 3, genome: { spine: starterGenome().spine, parts, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans.at(-1)).toBe('sky_drifter'); expect(loaded.run.diet).toBe('omnivore');
    expect(loaded.run.genome.parts.map(p => p.id).sort()).toEqual(['eye_stalk', 'mouth_maw', 'tail_paddle', 'wing_feather']);
    expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('migrates v1 through v2', () => {
    const r = parseSave(JSON.stringify({ stage: 2, bites: 7, total: 29, elapsed: 312, eatenPlanets: [], completed: false }), build)!;
    expect(r.version).toBe(4); expect(r.plans).toHaveLength(3); expect(r.elapsed).toBe(312); expect(validateRun(r, build)).toEqual([]);
  });
});
```

Hand checks:
- In test 1, the original starter is worth 41 at current costs. Adapting it to the Swimmer removes the legs (credit 14), so the wallet is 30 + 14 = 44.
- In test 4, the adaptation adds a Paddle tail at scale 1 (A4 step 6 adds at scale 1), which costs 10. The wallet is 0, so the save is granted 10, and the wallet ends at 0.

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/saves.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - `readV4(v)`: type-check every field, as `parseV2` does today. In addition:
    - `plans` must be a string array.
    - `diet` must be a valid diet.
    - `economy` must have `wallet` plus `parts` records with `basis` and `credit`.
    - `nextPartSerial` must be an integer.
    - `loadout.active` must be an array.
    - `pendingRespawn` must be a boolean, and `mechanics` an object.
    - `archive` entries go through `sanitizeGenome`.
    - `notices` must be strings.
    - The genome goes through `sanitizeGenome(raw)`, with uids required.
  - `parseSaveWithNotes`:
    - For a v4 save: read it, then call `validateRun`.
      - If the only issue is `needs coast`, return `{ status: 'kept', message }`.
      - If there are no issues, return `{ status: 'ok', run, notes: run.notices }`.
      - Otherwise return `null`.
    - For a v2 or v1 save, use the existing readers, which now return the raw v2 shape including `genomeRaw`, then `migrateV2`.
  - `main.ts`: read the keys in this order: `tiny-tide-adventure-v4`, then `-v2`, then `-v1`. Use the first result that is not `null`. Ignore `status: 'kept'` for now; Plan C shows it.

- [ ] **Step 4: Checkpoint**

Run the standard checkpoint, then `node e2e/tiny-tide-mobile.mjs && node e2e/tiny-tide-replay.mjs`, then check by hand in DevTools that a v2 save in `tiny-tide-adventure-v2` is unchanged after starting and saving the migrated run.

Expected: all tests pass. The v1 fixtures in both browser scripts now migrate.

The mobile script asserts that the creature hovers right after release. That still holds, because Plan A does not change movement.

- [ ] **Step 5: Commit**

```bash
git add src/tiny-tide/state.ts src/tiny-tide/main.ts tests/tiny-tide-core/saves.test.ts
git commit -m "Tiny Tide: v4 saves, kept coast saves, value-preserving v2 migration with archive"
```

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Task |
  | --- | --- |
  | §2 tree, commitments, effective stats | A2, A3 |
  | §4 diet | A3 (problem), A6 (`applyDesign`, `prepareEvolution`), A4 (diet in adaptation) |
  | §5 cost and slots | A3 |
  | §7 identity, problems, `adaptToPlan`, typed comparison | A3, A4, A2 |
  | §8 ledger | A5 |
  | §11 saves and migration | A6, A7 |
  | §3, §6, §8 contract, §9, §10, §12–14 | Plans B and C |

- **Round-2 findings answered here:**

  | Finding | Answer |
  | --- | --- |
  | T-R2-01 | Strict compile at each checkpoint; unused-import rule. |
  | T-R2-04, T-R2-05, T-R2-06 | A5, and A6 validation. |
  | T-R2-07 | A6, A7: one `needs coast`; `kept` status. |
  | T-R2-08 | A7: corrected line rule and value. |
  | T-R2-14 | A3: `effectiveStats`, health clamp. |
  | T-R2-21 | A2: Dune giant, value-sensitive diff. |
  | T-R2-25 | A4 |
  | G-R2, G-R3, G-R4, G-R6, G-R7, G-R8 | A2–A7 |
  | C-R2-03 | A5 |
  | C-R2-08 | Serials (A3, A6). Catalog-replacement binding rules are completed in Plan B Task B2 (`designDelta`) and Plan C Task C3. |

- **Type consistency:** these names are the same in every task and in Plans B and C:
  - `PlacedPart.uid`, `nextUid(serial)`
  - `problems(g, plan, ctx)`, `adaptToPlan(g, plan, ctx, nextSerial)`
  - `commitDesign(e, from, to)` returning `{ ok }`
  - `applyDesign(run, g, name, build, nextSerial, catalog?)`, `prepareEvolution(…, nextSerial, catalog?)` and `commitEvolution`
  - `parseSaveWithNotes(raw, build)` returning `Loaded | null`
