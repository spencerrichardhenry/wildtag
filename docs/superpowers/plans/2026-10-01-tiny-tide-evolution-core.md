# Tiny Tide Evolution Core Implementation Plan

> **SUPERSEDED (2026-10-01):** spec revision 2 replaces this plan. Do not execute it. It stays only as the record that the three reviews in `.codex-drafts/reviews/` refer to.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a body-plan evolution tree with habitats, body and part locks, a path-choice screen, plan-aware editor rules and new editor pointer controls to Tiny Tide.

**Architecture:** Body plans are pure data in `plans.ts`. Habitat zones and movement limits are pure functions in `habitat.ts`. `genome.ts` checks and repairs designs against a plan. `state.ts` stores the plan path in a v3 save. The UI (`path-screen.ts`, `editor.ts`, `main.ts`) only reads these modules. All game rules are unit-tested without WebGL; the UI is tested with Playwright and real input.

**Tech Stack:** TypeScript 7, three.js 0.185, Vite 8, Vitest 4, Playwright 1.63 (Chrome channel, SwiftShader).

**Spec:** `docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md`

## Global Constraints

- Repo: `/Users/spencerhenry/projects/wildtag`, branch `tiny-tide-evolution`. All paths below are relative to it.
- Do not commit unless the user has approved commits. Each task ends with a commit step; skip the `git commit` and leave the files staged if approval is missing.
- Do not touch the user's Mineral Wage work: `src/miner/`, `e2e/miner*.mjs`, `tests/miner*.test.ts`, `mineral-wage.html`, `public/miner/`, `scripts/sc2/`, `docs/MINERAL-WAGE.md`, and the Mineral Wage lines in `README.md`.
- The dev server already runs at `http://127.0.0.1:5199` (Vite, started by the user). Do not start a second server on 5199. Browser tests use `VERIFY_URL=http://127.0.0.1:5199/tiny-tide.html?qa`.
- Code style: match `src/tiny-tide/*.ts` — dense one-line statements, `T` for three.js, short JSDoc comments only where the reason is not obvious.
- The current faint rule (keep 70% DNA) does not change in this sub-project.
- Coast plans (`needs: 'coast'`) exist in data but stay hidden: `COAST_READY = false`.
- Region bounds: head `t < .25`, middle `.25 ≤ t ≤ .75`, tail `t > .75`. A mouth always counts in head. A mirrored pair uses two slots.
- Saves become version 3. v2 converts to the Swimmer line (`speck`, `swimmer`, `darter`, `sky_drifter`, `star_swimmer`). v1 converts through v2.
- Commands: unit tests `npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts`; type check `npx tsc -b`; build `npm run build`; browser `node e2e/<file>.mjs`.

## Review Focus

1. A v2 save whose design breaks the Swimmer line rules (for example legs on a Swimmer) — expected: it loads, the legs are removed, their DNA is refunded, and a toast says what changed. Pinned in Task 5.
2. A player who evolves to a seabed plan while in open water — expected: the creature settles onto the seabed during the transformation, never stuck in a forbidden zone. Pinned in Task 3 (`settle`) and Task 9.
3. Mirrored parts near a region border (`t = .25`) — expected: both copies count in the same region (the region comes from `t`, not from the copy). Pinned in Task 1.
4. A design with zero problems except DNA — expected: Fix for me does not appear, because it can not solve DNA. Pinned in Task 2 (`fixForPlan` leaves a valid design unchanged) and Task 7.
5. A two-finger touch that starts on a part — expected: it turns the model and cancels the part drag, the part does not move. Pinned in Task 8.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tiny-tide/plans.ts` (new) | Body-plan data and tree helpers. No three.js. |
| `src/tiny-tide/habitat.ts` (new) | Zones, habitat checks, `constrainMove`, `settle`. No three.js. |
| `src/tiny-tide/genome.ts` | Plan-aware `problems()` and `fixForPlan()`. |
| `src/tiny-tide/species.ts` | A `zones` list for each species. |
| `src/tiny-tide/ecosystem.ts` | Hunters stop at zones they can not enter. |
| `src/tiny-tide/state.ts` | `Run.plans`, `evolve(run, planId)`, v3 saves, v2 conversion with notes. |
| `src/tiny-tide/path-screen.ts` + `path-screen.css` (new) | The path-choice screen. |
| `src/tiny-tide/editor.ts` + `editor.css` | Plan rules in the editor, Fix for me, new pointer controls. |
| `src/tiny-tide/world.ts` | `placePlayer(stage, groundBound)`. |
| `src/tiny-tide/main.ts` | Evolve flow, movement limits, habitat-based buttons, reachable food. |
| `tests/tiny-tide-plans.test.ts` (new) | Unit tests for plans, habitat, plan rules, v3 saves. |
| `tests/tiny-tide.test.ts` | Update the existing tests for the new `problems()` signature and v3 saves. |
| `e2e/tiny-tide-paths.mjs` (new) | Browser test: path screen, plan rules, controls, Swimmer and Crawler lines. |
| `e2e/tiny-tide.mjs` | Update the journey test for the path screen. |
| `docs/TINY-TIDE.md`, `docs/TINY-TIDE-EVOLUTION.md` | Document plans, habitats and controls. |

---

### Task 0: Baseline checkpoint

The creature-editor update is uncommitted on this branch. A baseline makes each later task's diff reviewable.

**Files:** none changed.

- [ ] **Step 1: Ask the user for commit approval**

Ask: "May I commit the existing creature-editor work as a baseline on `tiny-tide-evolution`, and commit after each task?" Record the answer. If no, skip every commit step in this plan.

- [ ] **Step 2: Verify the baseline is green**

Run: `npx tsc -b && npx vitest run tests/tiny-tide.test.ts && python3 scripts/tiny-tide/blender/check_assets.py`
Expected: no type errors, `30 passed`, `PASS: 86 self-contained Blender GLBs`.

- [ ] **Step 3: Commit the baseline (only with approval)**

```bash
git add src/tiny-tide tests/tiny-tide.test.ts e2e/tiny-tide*.mjs docs/TINY-TIDE*.md docs/superpowers public/tiny-tide scripts/tiny-tide art/tiny-tide
git add -p README.md   # stage only the Tiny Tide lines, not the Mineral Wage lines
git commit -m "Tiny Tide: creature editor, living ocean and DNA evolution"
```

---

### Task 1: Body-plan data and tree helpers

**Files:**
- Create: `src/tiny-tide/plans.ts`
- Test: `tests/tiny-tide-plans.test.ts`

**Interfaces:**
- Consumes: `PartKind` from `src/tiny-tide/parts.ts`; `SPINE_RANGE` from `src/tiny-tide/genome.ts`.
- Produces:
  - `type WaterLevel = 'none' | 'shallow' | 'seabed' | 'deep'`, `type LandLevel = 'none' | 'walk' | 'climb'`, `type AirLevel = 'none' | 'glide' | 'fly'`, `type Region = 'head' | 'middle' | 'tail'`
  - `interface SegmentRule { radius: readonly [number, number]; height: readonly [number, number]; locked?: boolean }`
  - `interface RegionRule { kinds: readonly PartKind[]; slots: number }`
  - `interface BodyPlan { id; name; blurb; size: number; parents: readonly string[]; habitats: { water; land; air; burrow: boolean }; spine: { min; max; head: SegmentRule; middle: SegmentRule; tail: SegmentRule }; regions: Record<Region, RegionRule>; requires: readonly PartKind[]; bans: readonly PartKind[]; keystone?: { closes: readonly string[]; note: string }; needs?: 'coast' }`
  - `const PLANS: readonly BodyPlan[]`, `const ROOT_PLAN = 'speck'`, `const SWIMMER_LINE: readonly string[]`, `const COAST_READY = false`
  - `plan(id: string): BodyPlan | undefined`
  - `children(id: string, coast?: boolean): BodyPlan[]`
  - `regionOf(t: number, kind?: PartKind): Region`
  - `segmentRule(p: BodyPlan, index: number, count: number): SegmentRule`
  - `diffPlans(from: BodyPlan, to: BodyPlan): { gains: string[]; losses: string[] }`
  - `habitatLabel(p: BodyPlan): { water: string; land: string; air: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/tiny-tide-plans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { children, COAST_READY, diffPlans, plan, PLANS, regionOf, ROOT_PLAN, segmentRule, SWIMMER_LINE } from '../src/tiny-tide/plans';

describe('Tiny Tide body plans', () => {
  it('has unique ids, one root, and parents exactly one size lower', () => {
    expect(new Set(PLANS.map(p => p.id)).size).toBe(PLANS.length);
    expect(PLANS.filter(p => p.parents.length === 0).map(p => p.id)).toEqual([ROOT_PLAN]);
    for (const p of PLANS) for (const parent of p.parents) expect(plan(parent)!.size).toBe(p.size - 1);
  });
  it('reaches every plan from the root', () => {
    const seen = new Set([ROOT_PLAN]), queue = [ROOT_PLAN];
    while (queue.length) for (const child of children(queue.shift()!, true)) if (!seen.has(child.id)) { seen.add(child.id); queue.push(child.id); }
    expect([...seen].sort()).toEqual(PLANS.map(p => p.id).sort());
  });
  it('gives every visible plan below size 4 at least one visible child without the coast', () => {
    expect(COAST_READY).toBe(false);
    const seen = [ROOT_PLAN];
    for (let i = 0; i < seen.length; i++) {
      const kids = children(seen[i]!);
      if (plan(seen[i]!)!.size < 4) expect(kids.length).toBeGreaterThan(0);
      for (const k of kids) { expect(k.needs).toBeUndefined(); if (!seen.includes(k.id)) seen.push(k.id); }
    }
  });
  it('defines the swimmer line as a valid parent chain', () => {
    expect(SWIMMER_LINE).toEqual(['speck', 'swimmer', 'darter', 'sky_drifter', 'star_swimmer']);
    SWIMMER_LINE.forEach((id, i) => { expect(plan(id)!.size).toBe(i); if (i) expect(plan(id)!.parents).toContain(SWIMMER_LINE[i - 1]); });
  });
  it('keeps segment rules inside the global spine range and locked rules fixed', () => {
    for (const p of PLANS) {
      expect(p.spine.min).toBeGreaterThanOrEqual(3); expect(p.spine.max).toBeLessThanOrEqual(8); expect(p.spine.min).toBeLessThanOrEqual(p.spine.max);
      for (const rule of [p.spine.head, p.spine.middle, p.spine.tail]) {
        expect(rule.radius[0]).toBeGreaterThanOrEqual(.25); expect(rule.radius[1]).toBeLessThanOrEqual(1.2);
        if (rule.locked) { expect(rule.radius[0]).toBe(rule.radius[1]); expect(rule.height[0]).toBe(rule.height[1]); }
      }
      for (const kind of p.requires) expect(Object.values(p.regions).some(r => r.kinds.includes(kind))).toBe(true);
      for (const kind of p.bans) expect(Object.values(p.regions).some(r => r.kinds.includes(kind))).toBe(false);
    }
  });
  it('maps t to regions, keeps mouths in the head, and treats .25 and .75 as middle', () => {
    expect(regionOf(0)).toBe('head'); expect(regionOf(.249)).toBe('head'); expect(regionOf(.25)).toBe('middle');
    expect(regionOf(.75)).toBe('middle'); expect(regionOf(.751)).toBe('tail'); expect(regionOf(.9, 'mouth')).toBe('head');
  });
  it('uses the head rule for the first segment, the tail rule for the last, and middle for the rest', () => {
    const shell = plan('shellback')!;
    expect(segmentRule(shell, 0, 5)).toBe(shell.spine.head); expect(segmentRule(shell, 4, 5)).toBe(shell.spine.tail);
    expect(segmentRule(shell, 2, 5)).toBe(shell.spine.middle);
  });
  it('describes gains and losses between plans', () => {
    const toCrawler = diffPlans(plan('speck')!, plan('crawler')!), toSwimmer = diffPlans(plan('speck')!, plan('swimmer')!);
    expect(toSwimmer.gains).toContain('Open water'); expect(toSwimmer.losses).toContain('No legs');
    expect(toCrawler.gains.join(' ')).toMatch(/middle slot/); expect(toCrawler.losses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tiny-tide-plans.test.ts`
Expected: FAIL with `Failed to resolve import "../src/tiny-tide/plans"`.

- [ ] **Step 3: Write `src/tiny-tide/plans.ts`**

```ts
// The evolution tree. Each body plan sets where a creature can live, how its
// body may be shaped and which parts each body region may carry.
import type { PartKind } from './parts';

export type WaterLevel = 'none' | 'shallow' | 'seabed' | 'deep';
export type LandLevel = 'none' | 'walk' | 'climb';
export type AirLevel = 'none' | 'glide' | 'fly';
export type Region = 'head' | 'middle' | 'tail';
export interface SegmentRule { radius: readonly [number, number]; height: readonly [number, number]; locked?: boolean }
export interface RegionRule { kinds: readonly PartKind[]; slots: number }
export interface BodyPlan {
  id: string; name: string; blurb: string; size: number; parents: readonly string[];
  habitats: { water: WaterLevel; land: LandLevel; air: AirLevel; burrow: boolean };
  spine: { min: number; max: number; head: SegmentRule; middle: SegmentRule; tail: SegmentRule };
  regions: Record<Region, RegionRule>;
  requires: readonly PartKind[]; bans: readonly PartKind[];
  keystone?: { closes: readonly string[]; note: string };
  needs?: 'coast';
}
/** The coast arrives in sub-project 2. Until then, plans that need land stay hidden. */
export const COAST_READY = false;
export const ROOT_PLAN = 'speck';
export const SWIMMER_LINE = ['speck', 'swimmer', 'darter', 'sky_drifter', 'star_swimmer'] as const;

const ANY: SegmentRule = { radius: [.25, 1.2], height: [.25, 1.2] };
const HEAD_KINDS: readonly PartKind[] = ['mouth', 'eye', 'sense', 'arm', 'armor'];
const ALL_KINDS: readonly PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'wing', 'jet', 'arm', 'armor', 'sense', 'cosmic'];
const without = (kinds: readonly PartKind[], banned: readonly PartKind[]) => kinds.filter(k => !banned.includes(k));
const water = (level: WaterLevel, land: LandLevel = 'none', air: AirLevel = 'none') => ({ water: level, land, air, burrow: false });

export const PLANS: readonly BodyPlan[] = [
  { id: 'speck', name: 'Speck', blurb: 'A tiny start on the seabed.', size: 0, parents: [], habitats: water('seabed'),
    spine: { min: 3, max: 5, head: ANY, middle: ANY, tail: ANY }, requires: [], bans: [],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['fin', 'leg', 'armor', 'sense', 'arm'], slots: 4 }, tail: { kinds: ['tail', 'fin', 'armor', 'sense'], slots: 2 } } },
  { id: 'swimmer', name: 'Swimmer', blurb: 'Leave the sand behind. The whole water column is yours.', size: 1, parents: ['speck'], habitats: water('deep'),
    spine: { min: 3, max: 6, head: ANY, middle: ANY, tail: ANY }, requires: ['tail'], bans: ['leg'],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['fin', 'armor', 'sense', 'arm'], slots: 5 }, tail: { kinds: ['tail', 'fin', 'armor'], slots: 2 } } },
  { id: 'crawler', name: 'Crawler', blurb: 'Many legs, low and safe. You stay on the seabed.', size: 1, parents: ['speck'], habitats: water('seabed'),
    spine: { min: 3, max: 6, head: ANY, middle: ANY, tail: ANY }, requires: ['leg'], bans: [],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['leg', 'armor', 'arm', 'sense', 'fin'], slots: 6 }, tail: { kinds: ['tail', 'armor', 'sense'], slots: 2 } } },
  { id: 'shore_walker', name: 'Shore-walker', blurb: 'Breathe air. Walk the beach. Stay out of the deep.', size: 1, parents: ['speck'], habitats: water('shallow', 'walk'), needs: 'coast',
    spine: { min: 3, max: 6, head: ANY, middle: ANY, tail: ANY }, requires: ['leg'], bans: [],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['leg', 'armor', 'arm', 'sense', 'fin'], slots: 5 }, tail: { kinds: ['tail', 'armor', 'sense'], slots: 2 } } },
  { id: 'darter', name: 'Darter', blurb: 'Small and quick. Built for speed.', size: 2, parents: ['swimmer'], habitats: water('deep'),
    spine: { min: 3, max: 5, head: { radius: [.25, .7], height: [.25, .7] }, middle: { radius: [.25, .7], height: [.25, .7] }, tail: { radius: [.25, .6], height: [.25, .6] } }, requires: ['tail'], bans: ['leg'],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['fin', 'sense', 'arm', 'armor'], slots: 4 }, tail: { kinds: ['tail', 'fin'], slots: 4 } } },
  { id: 'bulk', name: 'Bulk', blurb: 'Big, round and hard to bite.', size: 2, parents: ['swimmer'], habitats: water('deep'),
    spine: { min: 4, max: 7, head: ANY, middle: { radius: [.6, 1.2], height: [.6, 1.2] }, tail: ANY }, requires: ['tail'], bans: ['leg'],
    regions: { head: { kinds: HEAD_KINDS, slots: 5 }, middle: { kinds: ['fin', 'armor', 'sense', 'arm'], slots: 8 }, tail: { kinds: ['tail', 'fin', 'armor'], slots: 2 } } },
  { id: 'shellback', name: 'Shellback', blurb: 'A fixed shell body. Slow, safe and stubborn.', size: 2, parents: ['crawler'], habitats: water('seabed'),
    spine: { min: 4, max: 6, head: ANY, middle: { radius: [.9, .9], height: [.7, .7], locked: true }, tail: ANY }, requires: ['leg', 'armor'], bans: [],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['leg', 'armor', 'arm', 'sense'], slots: 8 }, tail: { kinds: ['tail', 'armor', 'sense'], slots: 2 } } },
  { id: 'strider', name: 'Strider', blurb: 'Long legs on dry land. You can never swim again.', size: 2, parents: ['shore_walker'], habitats: water('none', 'walk'), needs: 'coast',
    spine: { min: 3, max: 6, head: ANY, middle: ANY, tail: ANY }, requires: ['leg'], bans: ['fin'],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['leg', 'armor', 'arm', 'sense'], slots: 6 }, tail: { kinds: ['tail', 'armor', 'sense'], slots: 2 } } },
  { id: 'mudskipper', name: 'Mudskipper', blurb: 'At home in the shallows and on the shore.', size: 2, parents: ['shore_walker'], habitats: water('shallow', 'walk'), needs: 'coast',
    spine: { min: 3, max: 6, head: ANY, middle: ANY, tail: ANY }, requires: ['leg'], bans: [],
    regions: { head: { kinds: HEAD_KINDS, slots: 4 }, middle: { kinds: ['leg', 'fin', 'armor', 'arm', 'sense'], slots: 6 }, tail: { kinds: ['tail', 'fin', 'armor'], slots: 2 } } },
  { id: 'sky_drifter', name: 'Sky drifter', blurb: 'Rise out of the sea and take the sky.', size: 3, parents: ['darter', 'bulk', 'shellback', 'strider', 'mudskipper'], habitats: water('deep', 'walk', 'fly'),
    spine: { min: 3, max: 7, head: ANY, middle: ANY, tail: ANY }, requires: [], bans: [],
    regions: { head: { kinds: without(ALL_KINDS, ['tail', 'leg', 'wing', 'jet']), slots: 6 }, middle: { kinds: without(ALL_KINDS, ['mouth']), slots: 10 }, tail: { kinds: ['tail', 'fin', 'armor', 'jet', 'sense'], slots: 4 } } },
  { id: 'star_swimmer', name: 'Star swimmer', blurb: 'Float between the planets.', size: 4, parents: ['sky_drifter'], habitats: water('none', 'none', 'fly'),
    spine: { min: 3, max: 8, head: ANY, middle: ANY, tail: ANY }, requires: [], bans: [],
    regions: { head: { kinds: without(ALL_KINDS, ['tail', 'leg', 'wing', 'jet']), slots: 7 }, middle: { kinds: without(ALL_KINDS, ['mouth']), slots: 12 }, tail: { kinds: ['tail', 'fin', 'armor', 'jet', 'sense', 'cosmic'], slots: 5 } } },
];
const byId = new Map(PLANS.map(p => [p.id, p]));
export const plan = (id: string) => byId.get(id);
export const children = (id: string, coast = COAST_READY) => PLANS.filter(p => p.parents.includes(id) && (coast || p.needs !== 'coast'));
export function regionOf(t: number, kind?: PartKind): Region { return kind === 'mouth' || t < .25 ? 'head' : t > .75 ? 'tail' : 'middle'; }
export function segmentRule(p: BodyPlan, index: number, count: number) { return index === 0 ? p.spine.head : index === count - 1 ? p.spine.tail : p.spine.middle; }

const WATER_ORDER: readonly WaterLevel[] = ['none', 'shallow', 'seabed', 'deep'];
const LAND_ORDER: readonly LandLevel[] = ['none', 'walk', 'climb'];
const AIR_ORDER: readonly AirLevel[] = ['none', 'glide', 'fly'];
const WATER_TEXT: Record<WaterLevel, string> = { none: 'No swimming', shallow: 'Shallow water', seabed: 'Seabed', deep: 'Open water' };
const LAND_TEXT: Record<LandLevel, string> = { none: 'No land', walk: 'Walk on land', climb: 'Climb' };
const AIR_TEXT: Record<AirLevel, string> = { none: 'No flight', glide: 'Glide', fly: 'Flight' };
export const habitatLabel = (p: BodyPlan) => ({ water: WATER_TEXT[p.habitats.water], land: LAND_TEXT[p.habitats.land], air: AIR_TEXT[p.habitats.air] });
const KIND_TEXT: Record<PartKind, string> = { mouth: 'mouths', eye: 'eyes', fin: 'fins', tail: 'tails', leg: 'legs', wing: 'wings', jet: 'jets', arm: 'arms', armor: 'armor', sense: 'senses', cosmic: 'cosmic parts' };
/** Plain-language gains and losses, shown on the path screen. */
export function diffPlans(from: BodyPlan, to: BodyPlan) {
  const gains: string[] = [], losses: string[] = [];
  const level = <L extends string>(order: readonly L[], a: L, b: L, text: Record<L, string>) => {
    if (order.indexOf(b) > order.indexOf(a)) gains.push(text[b]);
    else if (order.indexOf(b) < order.indexOf(a)) losses.push(b === 'none' ? `Lose: ${text[a].toLowerCase()}` : `Only ${text[b].toLowerCase()}`);
  };
  level(WATER_ORDER, from.habitats.water, to.habitats.water, WATER_TEXT);
  level(LAND_ORDER, from.habitats.land, to.habitats.land, LAND_TEXT);
  level(AIR_ORDER, from.habitats.air, to.habitats.air, AIR_TEXT);
  for (const region of ['head', 'middle', 'tail'] as const) {
    const delta = to.regions[region].slots - from.regions[region].slots;
    if (delta > 0) gains.push(`+${delta} ${region} slot${delta > 1 ? 's' : ''}`);
    if (delta < 0) losses.push(`${delta} ${region} slot${delta < -1 ? 's' : ''}`);
  }
  for (const kind of to.bans) if (!from.bans.includes(kind)) losses.push(`No ${KIND_TEXT[kind]}`);
  for (const kind of to.requires) if (!from.requires.includes(kind)) gains.push(`Needs ${KIND_TEXT[kind]}`);
  if (to.spine.max > from.spine.max) gains.push(`Up to ${to.spine.max} segments`);
  if (to.spine.max < from.spine.max) losses.push(`At most ${to.spine.max} segments`);
  if (to.spine.middle.locked) losses.push('Fixed body shape');
  return { gains, losses };
}
```

Note on `Needs …`: a new required part is listed under gains because it comes with the plan's identity; the path screen shows it in neutral text (Task 6).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tiny-tide-plans.test.ts`
Expected: PASS, 8 tests. If the swimmer diff test fails on `'No legs'`, check that `bans` on `swimmer` is `['leg']` and Speck has no bans.

- [ ] **Step 5: Commit**

```bash
git add src/tiny-tide/plans.ts tests/tiny-tide-plans.test.ts
git commit -m "Tiny Tide: body-plan tree data"
```

---

### Task 2: Plan-aware design checks and Fix for me

**Files:**
- Modify: `src/tiny-tide/genome.ts` (replace `GenomeProblem` and `problems()` at lines 60–71; add `fixForPlan`)
- Modify: `tests/tiny-tide.test.ts` (calls to `problems()`)
- Test: `tests/tiny-tide-plans.test.ts`

**Interfaces:**
- Consumes: `BodyPlan`, `plan()`, `regionOf()`, `segmentRule()` from Task 1.
- Produces:
  - `interface GenomeProblem { code: 'mouth' | 'parts' | 'spine' | 'locked' | 'dna' | 'region' | 'banned' | 'required' | 'segment'; message: string; part?: number; segment?: number }`
  - `problems(g: Genome, p: BodyPlan, unlocked: readonly string[], budget?: number): GenomeProblem[]` — the stage is `p.size`.
  - `regionCounts(g: Genome): Record<Region, number>`
  - `fixForPlan(g: Genome, p: BodyPlan, unlocked: readonly string[]): { genome: Genome; refund: number; notes: string[] }` — `refund` is DNA returned minus DNA spent on added required parts; it can be negative.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tiny-tide-plans.test.ts`:

```ts
import { fixForPlan, genomeCost, problems, regionCounts, starterGenome, type Genome } from '../src/tiny-tide/genome';

const codes = (g: Genome, id: string) => problems(g, plan(id)!, []).map(p => p.code);
describe('Tiny Tide plan rules', () => {
  it('accepts the starter design for Speck and Crawler, and rejects legs on a Swimmer', () => {
    const g = starterGenome();
    expect(codes(g, 'speck')).toEqual([]); expect(codes(g, 'crawler')).toEqual([]);
    expect(codes(g, 'swimmer')).toContain('banned');
    expect(problems(g, plan('swimmer')!, []).find(p => p.code === 'banned')!.part).toBe(g.parts.findIndex(p => p.id === 'leg_little'));
  });
  it('counts mirrored pairs as two slots in the region of t, and mouths in the head', () => {
    const g: Genome = { ...starterGenome(), parts: [{ id: 'mouth_nibbler', t: .9, angle: 0, scale: 1, mirror: false, roll: 0 }, { id: 'fin_side', t: .25, angle: 1.6, scale: 1, mirror: true, roll: 0 }] };
    expect(regionCounts(g)).toEqual({ head: 1, middle: 2, tail: 0 });
  });
  it('reports full regions, parts in the wrong region, missing required parts and segment problems', () => {
    const g = starterGenome();
    const crowded = { ...g, parts: [...g.parts, ...[.3, .4, .5].map(t => ({ id: 'spike', t, angle: 0, scale: 1, mirror: false, roll: 0 }))] };
    expect(codes(crowded, 'speck')).toContain('region');
    const tailInHead = { ...g, parts: [...g.parts, { id: 'tail_fan', t: .1, angle: 0, scale: 1, mirror: false, roll: 0 }] };
    expect(codes(tailInHead, 'swimmer')).toContain('region');
    expect(codes({ ...g, parts: g.parts.filter(p => p.id !== 'tail_paddle' && p.id !== 'leg_little') }, 'swimmer')).toContain('required');
    expect(codes({ ...g, spine: g.spine.slice(0, 3) }, 'shellback')).toContain('segment');
    expect(codes({ ...g, spine: [...g.spine, { radius: .5, height: .5, lift: 0 }] }, 'shellback')).toContain('segment');
  });
  it('repairs any design for any plan and leaves a valid design unchanged', () => {
    const g = starterGenome();
    for (const p of PLANS) {
      const { genome } = fixForPlan(g, p, []);
      expect(problems(genome, p, []).filter(x => x.code !== 'dna')).toEqual([]);
    }
    const same = fixForPlan(g, plan('speck')!, []);
    expect(same.genome).toEqual(g); expect(same.refund).toBe(0); expect(same.notes).toEqual([]);
  });
  it('refunds removed parts and charges for added required parts', () => {
    const g = starterGenome(), legCost = 2 * 8;
    const toSwimmer = fixForPlan(g, plan('swimmer')!, []);
    expect(toSwimmer.refund).toBe(legCost); expect(toSwimmer.notes.join(' ')).toMatch(/Little leg/);
    expect(genomeCost(toSwimmer.genome)).toBe(genomeCost(g) - legCost);
    const noLegs = { ...g, parts: g.parts.filter(p => p.id !== 'leg_little') };
    const toCrawler = fixForPlan(noLegs, plan('crawler')!, []);
    expect(toCrawler.refund).toBe(-8); expect(toCrawler.genome.parts.some(p => p.id === 'leg_little')).toBe(true);
  });
  it('sets locked segments to the plan values', () => {
    const { genome } = fixForPlan(starterGenome(), plan('shellback')!, []);
    for (let i = 1; i < genome.spine.length - 1; i++) expect([genome.spine[i]!.radius, genome.spine[i]!.height]).toEqual([.9, .7]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/tiny-tide-plans.test.ts`
Expected: FAIL — `regionCounts` and `fixForPlan` are not exported; `problems` gives wrong codes.

- [ ] **Step 3: Implement in `src/tiny-tide/genome.ts`**

Add the import at the top:

```ts
import { regionOf, segmentRule, type BodyPlan, type Region } from './plans';
```

Replace the `GenomeProblem` interface and `problems()` function with:

```ts
export interface GenomeProblem { code: 'mouth' | 'parts' | 'spine' | 'locked' | 'dna' | 'region' | 'banned' | 'required' | 'segment'; message: string; part?: number; segment?: number }
export function regionCounts(g: Genome): Record<Region, number> {
  const counts: Record<Region, number> = { head: 0, middle: 0, tail: 0 };
  for (const placed of g.parts) counts[regionOf(placed.t, part(placed.id)?.kind)] += placed.mirror ? 2 : 1;
  return counts;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** Checks a design against a body plan. The plan's size is the stage. */
export function problems(g: Genome, p: BodyPlan, unlocked: readonly string[], budget = Infinity): GenomeProblem[] {
  const out: GenomeProblem[] = [], stage = p.size;
  const mouths = g.parts.filter(placed => part(placed.id)?.kind === 'mouth');
  if (mouths.length !== 1) out.push({ code: 'mouth', message: mouths.length ? 'Only one mouth, please.' : 'Your creature needs a mouth.' });
  if (instanceCount(g) > PART_LIMITS[stage]!) out.push({ code: 'parts', message: `Too complex: ${instanceCount(g)} / ${PART_LIMITS[stage]} parts.` });
  if (g.spine.length < p.spine.min || g.spine.length > p.spine.max) out.push({ code: 'segment', message: `${p.name}s have ${p.spine.min}–${p.spine.max} segments.` });
  g.spine.forEach((s, i) => {
    const rule = segmentRule(p, i, g.spine.length);
    const inRange = s.radius >= rule.radius[0] - 1e-6 && s.radius <= rule.radius[1] + 1e-6 && s.height >= rule.height[0] - 1e-6 && s.height <= rule.height[1] + 1e-6;
    if (!inRange || (rule.locked && !(near(s.radius, rule.radius[0]) && near(s.height, rule.height[0])))) out.push({ code: 'segment', message: `Segment ${i + 1} is out of shape for a ${p.name}.`, segment: i });
  });
  g.parts.forEach((placed, i) => {
    const spec = part(placed.id); if (!spec) return;
    if (!isUnlocked(placed.id, stage, unlocked)) out.push({ code: 'locked', message: `${spec.name} is still locked.`, part: i });
    if (p.bans.includes(spec.kind)) out.push({ code: 'banned', message: `${p.name}s can't use ${spec.name.toLowerCase()}.`, part: i });
    else if (!p.regions[regionOf(placed.t, spec.kind)].kinds.includes(spec.kind)) out.push({ code: 'region', message: `${spec.name} doesn't fit in the ${regionOf(placed.t, spec.kind)}.`, part: i });
  });
  const counts = regionCounts(g);
  for (const region of ['head', 'middle', 'tail'] as const) if (counts[region] > p.regions[region].slots) out.push({ code: 'region', message: `The ${region} is full: ${counts[region]} / ${p.regions[region].slots}.` });
  for (const kind of p.requires) if (!g.parts.some(placed => part(placed.id)?.kind === kind)) out.push({ code: 'required', message: `${p.name}s need a ${kind}.` });
  if (genomeCost(g) > budget) out.push({ code: 'dna', message: 'Not enough DNA.' });
  return out;
}
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
/** Makes a design valid for a plan. Removed parts are refunded; added required parts are paid. */
export function fixForPlan(g: Genome, p: BodyPlan, unlocked: readonly string[]) {
  const genome = cloneGenome(g), notes: string[] = []; let refund = 0;
  const drop = (index: number, reason: string) => {
    const placed = genome.parts[index]!, spec = part(placed.id)!;
    refund += spec.cost * (placed.mirror ? 2 : 1); notes.push(`${spec.name} removed: ${reason}.`); genome.parts.splice(index, 1);
  };
  for (let i = genome.parts.length - 1; i >= 0; i--) {
    const placed = genome.parts[i]!, spec = part(placed.id);
    if (!spec || !isUnlocked(placed.id, p.size, unlocked)) drop(i, 'still locked');
    else if (p.bans.includes(spec.kind)) drop(i, `${p.name}s can't use it`);
    else if (!p.regions[regionOf(placed.t, spec.kind)].kinds.includes(spec.kind)) drop(i, `it doesn't fit in the ${regionOf(placed.t, spec.kind)}`);
  }
  // Keep only the first mouth; regions drop their newest parts first.
  const mouthIndexes = genome.parts.map((placed, i) => part(placed.id)!.kind === 'mouth' ? i : -1).filter(i => i >= 0);
  for (const i of mouthIndexes.slice(1).reverse()) drop(i, 'only one mouth');
  for (const region of ['head', 'middle', 'tail'] as const) {
    while (regionCounts(genome)[region] > p.regions[region].slots) {
      const i = genome.parts.map((placed, index) => ({ placed, index })).filter(x => regionOf(x.placed.t, part(x.placed.id)!.kind) === region && part(x.placed.id)!.kind !== 'mouth').at(-1)?.index;
      if (i === undefined) break;
      drop(i, `the ${region} is full`);
    }
  }
  while (instanceCount(genome) > PART_LIMITS[p.size]!) {
    const i = genome.parts.map((placed, index) => ({ placed, index })).filter(x => part(x.placed.id)!.kind !== 'mouth').at(-1)?.index;
    if (i === undefined) break;
    drop(i, 'too complex for this size');
  }
  while (genome.spine.length > p.spine.max) genome.spine.splice(Math.floor(genome.spine.length / 2), 1);
  while (genome.spine.length < p.spine.min) genome.spine.splice(1, 0, { ...genome.spine[1]! });
  genome.spine.forEach((s, i) => { const rule = segmentRule(p, i, genome.spine.length); s.radius = clampTo(s.radius, rule.radius); s.height = clampTo(s.height, rule.height); });
  if (genome.spine.length !== g.spine.length || genome.spine.some((s, i) => s.radius !== g.spine[i]?.radius || s.height !== g.spine[i]?.height)) notes.push(`Body reshaped for a ${p.name}.`);
  const needs: PartKind[] = [...(genome.parts.some(placed => part(placed.id)!.kind === 'mouth') ? [] : ['mouth' as const]), ...p.requires.filter(kind => !genome.parts.some(placed => part(placed.id)!.kind === kind))];
  for (const kind of needs) {
    const cheapest = PARTS.filter(spec => spec.kind === kind && isUnlocked(spec.id, p.size, unlocked)).sort((a, b) => a.cost - b.cost)[0];
    if (!cheapest) continue;
    genome.parts.push({ id: cheapest.id, t: cheapest.t, angle: cheapest.angle, scale: 1, mirror: false, roll: 0 });
    refund -= cheapest.cost; notes.push(`${cheapest.name} added: ${p.name}s need ${kind === 'leg' ? 'legs' : `a ${kind}`}.`);
  }
  return { genome, refund, notes };
}
```

Update the import line for parts at the top of `genome.ts` to include `PartKind`:

```ts
import { part, PARTS, type Diet, type PartKind, type PartSpec, type Stats } from './parts';
```

Delete the now-unused `SPINE_LIMITS` export only if no file imports it; `editor.ts` imports it, so keep it until Task 7 removes that use.

- [ ] **Step 4: Update the existing tests in `tests/tiny-tide.test.ts`**

Add `import { plan } from '../src/tiny-tide/plans';` and change every call:

| Old | New |
| --- | --- |
| `problems(g, 0, [])` | `problems(g, plan('speck')!, [])` |
| `problems(..., 0, [])` | `problems(..., plan('speck')!, [])` |
| `problems(many, 1, [])` | `problems(many, plan('crawler')!, [])` |
| `problems(winged, 0, [])` | `problems(winged, plan('speck')!, [])` |
| `problems(winged, 3, [])` | `problems(winged, plan('sky_drifter')!, [])` |
| `problems(g, 0, [], genomeCost(g) - 1)` | `problems(g, plan('speck')!, [], genomeCost(g) - 1)` |
| `problems(run.genome, 2, [])` in the v1 migration test | `problems(run.genome, plan(run.plans.at(-1)!)!, [])` (this line passes after Task 5) |

In the "too many parts" test, the five spikes at `t: .5` now also fill the middle region. Change the expectation to `expect(problems(many, plan('speck')!, []).map(p => p.code)).toContain('parts')` and the stage-1 check to `expect(problems(many, plan('crawler')!, []).map(p => p.code)).not.toContain('parts')`.

In the "winged" test, the wing is at `t: .4` (middle) with `mirror: true`; for Speck it is both `locked` and `region`, and for Sky drifter it is valid. Keep the two expectations as written.

In the `unlock` test, the `leg_crab` at `t: .6, angle: 2.4` on Speck: Speck's middle allows legs, 4 slots, and the starter already uses 2 (legs) — 3 is fine. Keep it.

- [ ] **Step 5: Run all Tiny Tide unit tests**

Run: `npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts`
Expected: PASS except the v1-migration test line that uses `run.plans` (fails until Task 5). Mark that one assertion with `// Task 5` and keep it failing, or run with `-t "plan rules"` to scope.

Run: `npx tsc -b`
Expected: errors only in `src/tiny-tide/editor.ts` (old `problems` calls). Task 7 fixes them. To keep the tree compiling now, change the two editor calls to `problems(this.draft, this.options.plan, …)` and add `plan: BodyPlan` to `EditorOptions`; in `main.ts` pass `plan: plan(run.stage === 0 ? 'speck' : SWIMMER_LINE[run.stage]!)!` temporarily — Task 6 replaces it.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/genome.ts src/tiny-tide/editor.ts src/tiny-tide/main.ts tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts
git commit -m "Tiny Tide: plan-aware design checks and fixForPlan"
```

---

### Task 3: Habitat zones and movement limits

**Files:**
- Create: `src/tiny-tide/habitat.ts`
- Test: `tests/tiny-tide-plans.test.ts`

**Interfaces:**
- Consumes: `BodyPlan` from Task 1.
- Produces:
  - `type Zone = 'seabed' | 'shallow' | 'deep' | 'land' | 'air'`
  - `interface Terrain { groundAt(x: number, z: number): number; surface: number }` — stage-local units. `TideWorld` already satisfies it.
  - `NEAR_GROUND = 2.2`, `SHALLOW_DEPTH = 6`
  - `zoneAt(stage: number, p: Vec, t: Terrain): Zone`
  - `allows(plan: BodyPlan, zone: Zone, p: Vec, t: Terrain): boolean`
  - `groundBound(plan: BodyPlan): boolean`
  - `canBreach(plan: BodyPlan): boolean`
  - `constrainMove(plan, stage, from: Vec, to: Vec, t: Terrain): { point: Vec; blocked: Zone | null }`
  - `settle(plan, stage, p: Vec, t: Terrain): Vec`
  - `blockHint(plan: BodyPlan, zone: Zone): string`
  - `type Vec = { x: number; y: number; z: number }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tiny-tide-plans.test.ts`:

```ts
import { allows, blockHint, canBreach, constrainMove, groundBound, settle, zoneAt, type Terrain } from '../src/tiny-tide/habitat';

// Flat seabed at y=0, water surface at y=20. A small island where x > 30 rises to y=24.
const terrain: Terrain = { groundAt: x => x > 30 ? 24 : 0, surface: 20 };
describe('Tiny Tide habitats', () => {
  it('classifies seabed, deep, shallow, land and air', () => {
    expect(zoneAt(1, { x: 0, y: 1, z: 0 }, terrain)).toBe('seabed');
    expect(zoneAt(1, { x: 0, y: 10, z: 0 }, terrain)).toBe('deep');
    expect(zoneAt(1, { x: 0, y: 22, z: 0 }, terrain)).toBe('air');
    expect(zoneAt(1, { x: 40, y: 25, z: 0 }, terrain)).toBe('land');
    expect(zoneAt(1, { x: 40, y: 40, z: 0 }, terrain)).toBe('air');
    const shallowSea: Terrain = { groundAt: () => 16, surface: 20 };
    expect(zoneAt(1, { x: 0, y: 19.5, z: 0 }, shallowSea)).toBe('shallow');
    expect(zoneAt(4, { x: 0, y: -10, z: 0 }, terrain)).toBe('air');
  });
  it('lets deep swimmers use seabed and shallow water, and keeps seabed plans on the bottom', () => {
    const swimmer = plan('swimmer')!, crawler = plan('crawler')!, shallowSea: Terrain = { groundAt: () => 16, surface: 20 };
    expect(allows(swimmer, 'seabed', { x: 0, y: 1, z: 0 }, terrain)).toBe(true);
    expect(allows(swimmer, 'air', { x: 0, y: 22, z: 0 }, terrain)).toBe(false);
    expect(allows(crawler, 'deep', { x: 0, y: 10, z: 0 }, terrain)).toBe(false);
    expect(allows(plan('shore_walker')!, 'seabed', { x: 0, y: 17, z: 0 }, shallowSea)).toBe(true);
    expect(allows(plan('shore_walker')!, 'seabed', { x: 0, y: 1, z: 0 }, terrain)).toBe(false);
    expect(allows(plan('strider')!, 'land', { x: 40, y: 25, z: 0 }, terrain)).toBe(true);
    expect(groundBound(crawler)).toBe(true); expect(groundBound(swimmer)).toBe(false);
    expect(canBreach(plan('darter')!)).toBe(true); expect(canBreach(plan('shellback')!)).toBe(false); expect(canBreach(swimmer)).toBe(false);
  });
  it('slides along a border instead of entering a forbidden zone', () => {
    const swimmer = plan('swimmer')!;
    const up = constrainMove(swimmer, 1, { x: 0, y: 19, z: 0 }, { x: 1, y: 21, z: 0 }, terrain);
    expect(up.blocked).toBe('air'); expect(up.point).toEqual({ x: 1, y: 19, z: 0 });
    const free = constrainMove(swimmer, 1, { x: 0, y: 10, z: 0 }, { x: 1, y: 11, z: 1 }, terrain);
    expect(free).toEqual({ point: { x: 1, y: 11, z: 1 }, blocked: null });
    const stuck = constrainMove(plan('crawler')!, 1, { x: 0, y: 1, z: 0 }, { x: 0, y: 9, z: 0 }, terrain);
    expect(stuck.point).toEqual({ x: 0, y: 1, z: 0 }); expect(stuck.blocked).toBe('deep');
  });
  it('settles a creature into an allowed zone after evolving', () => {
    expect(settle(plan('crawler')!, 1, { x: 0, y: 12, z: 0 }, terrain).y).toBeCloseTo(.65);
    expect(settle(plan('swimmer')!, 1, { x: 0, y: 30, z: 0 }, terrain).y).toBeCloseTo(19.4);
    const p = { x: 3, y: 10, z: 4 }; expect(settle(plan('swimmer')!, 1, p, terrain)).toEqual(p);
  });
  it('explains a block in plain words', () => {
    expect(blockHint(plan('swimmer')!, 'air')).toBe("Swimmers can't leave the water.");
    expect(blockHint(plan('crawler')!, 'deep')).toBe('Crawlers stay on the seabed.');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/tiny-tide-plans.test.ts -t habitats`
Expected: FAIL with `Failed to resolve import "../src/tiny-tide/habitat"`.

- [ ] **Step 3: Write `src/tiny-tide/habitat.ts`**

```ts
// Where a body plan may go. All values are stage-local units, the same as
// the player position in main.ts.
import type { BodyPlan } from './plans';

export type Zone = 'seabed' | 'shallow' | 'deep' | 'land' | 'air';
export interface Vec { x: number; y: number; z: number }
export interface Terrain { groundAt(x: number, z: number): number; surface: number }
/** A creature this close to the ground counts as on it. */
export const NEAR_GROUND = 2.2;
/** Water shallower than this counts as shallow. */
export const SHALLOW_DEPTH = 6;
const GROUND_REST = .65, SURFACE_REST = .6;

export function zoneAt(stage: number, p: Vec, t: Terrain): Zone {
  if (stage === 4) return 'air';
  const ground = t.groundAt(p.x, p.z), aboveGround = p.y - ground;
  if (ground >= t.surface) return aboveGround <= NEAR_GROUND ? 'land' : 'air';
  if (p.y > t.surface) return 'air';
  if (aboveGround <= NEAR_GROUND) return 'seabed';
  return t.surface - ground < SHALLOW_DEPTH ? 'shallow' : 'deep';
}
const isShallowWater = (p: Vec, t: Terrain) => t.surface - t.groundAt(p.x, p.z) < SHALLOW_DEPTH;
export function allows(plan: BodyPlan, zone: Zone, p: Vec, t: Terrain): boolean {
  const { water, land, air } = plan.habitats;
  switch (zone) {
    case 'deep': return water === 'deep';
    case 'shallow': return water === 'deep' || water === 'shallow';
    case 'seabed': return water === 'deep' || water === 'seabed' || (water === 'shallow' && isShallowWater(p, t));
    case 'land': return land !== 'none';
    case 'air': return air !== 'none';
  }
}
/** Plans that can't swim up stay on the ground, like the tiny size does today. */
export const groundBound = (plan: BodyPlan) => plan.habitats.air === 'none' && (plan.habitats.water === 'seabed' || plan.habitats.water === 'none');
export const canBreach = (plan: BodyPlan) => plan.size === 2 && plan.habitats.water === 'deep';
export function constrainMove(plan: BodyPlan, stage: number, from: Vec, to: Vec, t: Terrain): { point: Vec; blocked: Zone | null } {
  const zone = zoneAt(stage, to, t);
  if (allows(plan, zone, to, t)) return { point: to, blocked: null };
  // Slide: keep the parts of the move that stay legal, most movement first.
  const tries: Vec[] = [{ x: to.x, y: from.y, z: to.z }, { x: to.x, y: to.y, z: from.z }, { x: from.x, y: to.y, z: to.z }, { x: to.x, y: from.y, z: from.z }, { x: from.x, y: from.y, z: to.z }];
  for (const point of tries) if (allows(plan, zoneAt(stage, point, t), point, t)) return { point, blocked: zone };
  return { point: { ...from }, blocked: zone };
}
/** Moves a creature straight up or down into a zone its plan allows. */
export function settle(plan: BodyPlan, stage: number, p: Vec, t: Terrain): Vec {
  if (allows(plan, zoneAt(stage, p, t), p, t)) return p;
  const ground = t.groundAt(p.x, p.z), under = t.surface - SURFACE_REST, onGround = ground + GROUND_REST;
  // Swimmers come back just under the surface; ground plans drop to the floor.
  const heights = groundBound(plan) ? [onGround, under] : [under, onGround];
  for (const y of [...heights, Math.max(ground, t.surface) + GROUND_REST]) {
    const point = { x: p.x, y, z: p.z };
    if (allows(plan, zoneAt(stage, point, t), point, t)) return point;
  }
  return p;
}
export function blockHint(plan: BodyPlan, zone: Zone): string {
  const who = `${plan.name}s`;
  if (zone === 'air') return plan.habitats.land === 'none' ? `${who} can't leave the water.` : `${who} can't fly.`;
  if (zone === 'land') return `${who} can't go on land.`;
  if (plan.habitats.water === 'seabed') return `${who} stay on the seabed.`;
  if (plan.habitats.water === 'none') return `${who} can't swim.`;
  return `${who} stay in shallow water.`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/tiny-tide-plans.test.ts -t habitats`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tiny-tide/habitat.ts tests/tiny-tide-plans.test.ts
git commit -m "Tiny Tide: habitat zones and movement limits"
```

---

### Task 4: Species zones, hunters stop at borders, reachable food

**Files:**
- Modify: `src/tiny-tide/species.ts` (add `zones` to `Species` and to the factory)
- Modify: `src/tiny-tide/ecosystem.ts` (`EcoContext.playerZone`, hunt give-up)
- Test: `tests/tiny-tide-plans.test.ts`

**Interfaces:**
- Consumes: `Zone`, `zoneAt`, `allows`, `canBreach`, `Terrain` (Task 3); `plan`, `PLANS` (Task 1).
- Produces:
  - `Species.zones: readonly Zone[]`
  - `EcoContext.playerZone?: Zone` — when set and the species can not enter it, a hunting or angry entity switches to `return`.
  - `reachable(plan: BodyPlan, stage: number, p: Vec, t: Terrain): boolean` exported from `habitat.ts`: `allows(...)` or (`zone === 'air'` and `canBreach(plan)`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/tiny-tide-plans.test.ts`:

```ts
import { reachable } from '../src/tiny-tide/habitat';
import { Ecosystem } from '../src/tiny-tide/ecosystem';
import { populate, seabedHeight, SIZES, WATER_LEVEL } from '../src/tiny-tide/biomes';
import { dnaFor, STAGES } from '../src/tiny-tide/state';
import { SPECIES } from '../src/tiny-tide/species';

const seaAt = (stage: number): Terrain => { const s = SIZES[stage]!; return { groundAt: (x, z) => seabedHeight(x * s, z * s) / s, surface: WATER_LEVEL / s }; };
describe('Tiny Tide reachable food and hunters', () => {
  it('gives every species at least one zone', () => { for (const s of SPECIES) expect(s.zones.length).toBeGreaterThan(0); });
  it('lets every water plan reach enough food to evolve, for every diet it could have', () => {
    for (const p of PLANS.filter(p => !p.needs && p.size < 4)) for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) {
      let best = Infinity;
      for (const seed of [1, 2, 3]) {
        const s = SIZES[p.size]!, t = seaAt(p.size);
        const dna = populate(seed).filter(x => x.spec.tier === p.size).filter(x => reachable(p, p.size, { x: x.x / s, y: x.y / s, z: x.z / s }, t)).reduce((sum, x) => sum + dnaFor(diet, x.spec), 0);
        best = Math.min(best, dna);
      }
      expect(best, `${p.id} ${diet}`).toBeGreaterThan(STAGES[p.size]!.goal);
    }
  });
  it('makes a crab give up when the player swims into open water', () => {
    const eco = new Ecosystem(7), crab = eco.entities.find(e => e.spec.key === '1:crab')!;
    const ctx = (zone: 'seabed' | 'deep') => ({ stage: 0, dt: .1, time: 0, player: { x: crab.x + 6, y: crab.y, z: crab.z }, playerRadius: .6, stealthFactor: 1, vulnerable: true, playerZone: zone });
    eco.step(ctx('seabed')); expect(crab.mode).toBe('hunt');
    eco.step(ctx('deep')); expect(crab.mode).toBe('return');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/tiny-tide-plans.test.ts -t "reachable food"`
Expected: FAIL — `s.zones` is undefined; `reachable` is not exported.

- [ ] **Step 3: Implement**

In `src/tiny-tide/habitat.ts`, append:

```ts
/** Food the plan can reach: its own zones, plus the air just above the sea for breachers. */
export function reachable(plan: BodyPlan, stage: number, p: Vec, t: Terrain) {
  const zone = zoneAt(stage, p, t);
  return allows(plan, zone, p, t) || (zone === 'air' && canBreach(plan));
}
```

In `src/tiny-tide/species.ts`:

```ts
import type { Zone } from './habitat';
// add to the Species interface:
  /** Zones this species can enter. Hunters stop at the border of these zones. */
  zones: readonly Zone[];
```

Change the factory default so every species gets zones from its behavior, and override hunters:

```ts
const ZONES: Record<Behavior, readonly Zone[]> = {
  still: ['seabed', 'land'], graze: ['seabed'], drift: ['deep', 'shallow', 'seabed'], school: ['deep', 'shallow', 'seabed'],
  skittish: ['deep', 'shallow', 'seabed'], flyer: ['air'],
};
const s = (tier: number, kind: FoodKind, tag: FoodTag, label: string, behavior: Behavior, count: number, dna: number, extra: Partial<Species> = {}): Species =>
  ({ key: `${tier}:${kind}`, kind, tier, tag, label, behavior, count, dna, hp: 1, damage: 0, speed: 0, hunts: [], stings: [], fights: false, zones: ZONES[behavior], ...extra });
```

Overrides in `SPECIES`:
- `1:crab` add `zones: ['seabed', 'shallow']`
- `2:ray` change `count` from 8 to 12 (see Step 4)
- `2:squid` add `zones: ['deep', 'shallow', 'seabed']`
- `3:plane` add `zones: ['air']`
- `3:boat` add `zones: ['shallow', 'deep', 'air']` (boats sit on the surface, which `zoneAt` reports as air above the water line)
- `0:copepod`, `1:shrimp` keep the `skittish` default.

In `src/tiny-tide/ecosystem.ts`, add the field and the rule:

```ts
import type { Zone } from './habitat';
// in EcoContext:
  /** The player's zone. Hunters do not follow into zones their species can't enter. */
  playerZone?: Zone;
```

In `think()`, at the top, before the existing `angry` line:

```ts
    const outOfReach = ctx.playerZone !== undefined && !e.spec.zones.includes(ctx.playerZone);
    if ((e.mode === 'hunt' || e.mode === 'angry') && outOfReach) { this.setMode(e, 'return'); return; }
```

And change the start of a hunt so it does not begin out of reach:

```ts
    if (e.spec.hunts.includes(ctx.stage) && distance < notice && !outOfReach) { this.setMode(e, 'hunt'); return; }
```

- [ ] **Step 4: Run all unit tests**

Run: `npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts`
Expected: PASS (except the Task 5 v1-migration assertion).

Rays are the only seabed meat at size 2, so a Shellback carnivore depends on them: 8 rays × 22 DNA = 176 is below the goal of 210. In `species.ts`, raise `count` for `2:ray` from 8 to 12 (264 DNA) as part of this task, before running the test.

- [ ] **Step 5: Commit**

```bash
git add src/tiny-tide/species.ts src/tiny-tide/ecosystem.ts src/tiny-tide/habitat.ts tests/tiny-tide-plans.test.ts
git commit -m "Tiny Tide: species zones and hunters that stop at habitat borders"
```

---

### Task 5: Plan path in the run, v3 saves and the v2 conversion

**Files:**
- Modify: `src/tiny-tide/state.ts`
- Modify: `tests/tiny-tide.test.ts` (save tests)
- Test: `tests/tiny-tide-plans.test.ts`

**Interfaces:**
- Consumes: `plan`, `children`, `ROOT_PLAN`, `SWIMMER_LINE` (Task 1); `fixForPlan` (Task 2).
- Produces:
  - `Run.version: 3`, `Run.plans: string[]`
  - `currentPlan(run: Run): BodyPlan`
  - `evolve(run: Run, planId: string): boolean` — replaces `evolve(run)`; requires `evolveReady(run)` and `planId` in `children(currentPlan(run).id)`.
  - `parseSaveWithNotes(raw: string | null): { run: Run; notes: string[] } | null`
  - `parseSave(raw)` keeps its signature and returns `parseSaveWithNotes(raw)?.run ?? null`.
  - `validPath(plans: unknown, stage: number): plans is string[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tiny-tide-plans.test.ts`:

```ts
import { currentPlan, evolve, freshRun, parseSave, parseSaveWithNotes } from '../src/tiny-tide/state';

describe('Tiny Tide v3 runs and saves', () => {
  it('starts on Speck and evolves only into a child plan', () => {
    const run = freshRun(1); expect(run.plans).toEqual(['speck']); expect(currentPlan(run).id).toBe('speck');
    run.stageDna = 999;
    expect(evolve(run, 'darter')).toBe(false); expect(evolve(run, 'shore_walker')).toBe(false);
    expect(evolve(run, 'crawler')).toBe(true); expect(run.plans).toEqual(['speck', 'crawler']); expect(run.stage).toBe(1);
  });
  it('round-trips a v3 save and rejects broken plan paths', () => {
    const run = freshRun(2); run.stageDna = 999; evolve(run, 'swimmer');
    expect(parseSave(JSON.stringify(run))).toEqual(run);
    for (const plans of [['swimmer'], ['speck', 'darter'], ['speck', 'swimmer', 'swimmer'], ['speck', 'unknown'], 'speck'])
      expect(parseSave(JSON.stringify({ ...run, plans }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...run, plans: ['speck'] }))).toBeNull();
  });
  it('converts a v2 save to the swimmer line and refunds parts the plan does not allow', () => {
    const v2 = { ...freshRun(3), version: 2, stage: 1, dna: 10 } as Record<string, unknown>; delete v2.plans;
    const result = parseSaveWithNotes(JSON.stringify(v2))!;
    expect(result.run.version).toBe(3); expect(result.run.plans).toEqual(['speck', 'swimmer']);
    expect(result.run.genome.parts.some(p => p.id === 'leg_little')).toBe(false);
    expect(result.run.dna).toBe(10 + 16); expect(result.notes.join(' ')).toMatch(/Little leg removed/);
  });
  it('converts a v1 save through v2 to v3', () => {
    const run = parseSave(JSON.stringify({ stage: 2, bites: 7, total: 29, elapsed: 312, eatenPlanets: [], completed: false }))!;
    expect(run.plans).toEqual(['speck', 'swimmer', 'darter']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/tiny-tide-plans.test.ts -t "v3 runs"`
Expected: FAIL — `currentPlan` is not exported; `run.plans` is undefined.

- [ ] **Step 3: Implement in `src/tiny-tide/state.ts`**

Imports:

```ts
import { cloneGenome, derive, dietOf, fixForPlan, genomeCost, sanitizeGenome, starterGenome, statsOf, type Genome } from './genome';
import { children, plan, ROOT_PLAN, SWIMMER_LINE, type BodyPlan } from './plans';
```

`Run` changes: `version: 3;` and add `plans: string[];` after `stage`.

```ts
export function freshRun(seed = newSeed()): Run {
  const genome = starterGenome();
  return { version: 3, seed, name: 'Little Tide', stage: 0, plans: [ROOT_PLAN], dna: START_DNA, stageDna: 0, totalDna: 0, bites: 0, elapsed: 0, deaths: 0, health: derive(statsOf(genome)).maxHealth, genome, unlocked: [], eatenPlanets: [], completed: false };
}
export const currentPlan = (run: Run): BodyPlan => plan(run.plans.at(-1)!)!;
export function evolve(run: Run, planId: string) {
  if (!evolveReady(run) || !children(currentPlan(run).id).some(p => p.id === planId)) return false;
  run.plans.push(planId); run.stage++; run.stageDna = 0; run.health = derive(statsOf(run.genome)).maxHealth; return true;
}
export function validPath(plans: unknown, stage: number): plans is string[] {
  if (!Array.isArray(plans) || plans.length !== stage + 1 || plans[0] !== ROOT_PLAN) return false;
  return plans.every((id, i) => typeof id === 'string' && plan(id)?.size === i && (i === 0 || plan(id)!.parents.includes(plans[i - 1])));
}
```

Note: `validPath` does not check `needs: 'coast'`, so a save made after the coast ships still loads in an older build only if the plans exist — they do, they are only hidden.

Replace `parseSave` and add the conversion:

```ts
export function parseSaveWithNotes(raw: string | null): { run: Run; notes: string[] } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (v.version === 3) { const run = parseV3(v); return run && { run, notes: [] }; }
    const v2 = v.version === 2 ? parseV2(v) : v.version === undefined ? migrateV1(v) : null;
    return v2 ? toV3(v2) : null;
  } catch { return null; }
}
export const parseSave = (raw: string | null): Run | null => parseSaveWithNotes(raw)?.run ?? null;
function parseV3(v: Record<string, unknown>): Run | null {
  const base = parseV2({ ...v, version: 2 });
  if (!base || !validPath(v.plans, base.stage)) return null;
  return { ...base, version: 3, plans: [...(v.plans as string[])] };
}
/** v2 had no plans. Put the creature on the swimmer line and repair its design. */
function toV3(run: Omit<Run, 'version' | 'plans'> & { version: number }): { run: Run; notes: string[] } {
  const plans = SWIMMER_LINE.slice(0, run.stage + 1), fixed = fixForPlan(run.genome, plan(plans.at(-1)!)!, run.unlocked);
  return { run: { ...run, version: 3, plans: [...plans], genome: fixed.genome, dna: Math.max(0, run.dna + fixed.refund), health: Math.min(run.health, derive(statsOf(fixed.genome)).maxHealth) }, notes: fixed.notes };
}
```

`parseV2` and `migrateV1` keep their bodies but return `Omit<Run, 'version' | 'plans'> & { version: number }`. In `parseV2`, change the returned object's `version: 2` stays; in `migrateV1`, build from `freshRun()` and then `delete (run as Partial<Run>).plans` is not needed — instead construct the v2 object explicitly:

```ts
function migrateV1(v: Record<string, unknown>): (Omit<Run, 'version' | 'plans'> & { version: number }) | null {
  // body unchanged up to `const run = freshRun();`, then:
  const { plans: _plans, ...run } = { ...freshRun(), version: 2 };
  // unchanged assignments to run.stage, run.bites, ... follow, then:
  return run;
}
```

Remove the old `evolve(run: Run)`. `applyDesign` stays the same.

- [ ] **Step 4: Update `tests/tiny-tide.test.ts`**

- "fills the stage bar with DNA, then evolves only when ready": replace `evolve(run)` with `evolve(run, 'swimmer')` (both calls).
- "round-trips a v2 save" → rename to "round-trips a v3 save": `const run = freshRun(42); run.stage = 4; run.plans = ['speck', 'swimmer', 'darter', 'sky_drifter', 'star_swimmer']; run.eatenPlanets = [1, 2]; run.dna = 33.5;`
- "ignores corrupt and inconsistent saves": change `JSON.stringify({ ...ok, version: 3 })` to `JSON.stringify({ ...ok, version: 4 })`; the `stage: 5` case still fails; add `JSON.stringify({ ...ok, stage: 1 })` (path too short).
- The v1 migration test: the `problems(...)` line from Task 2 now passes.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts`
Expected: PASS, all tests.

Run: `npx tsc -b`
Expected: errors only in `src/tiny-tide/main.ts` where `evolve(run)` is called. Change it to `evolve(run, SWIMMER_LINE[run.stage + 1]!)` for now; Task 6 replaces it with the path screen.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/state.ts src/tiny-tide/main.ts tests/tiny-tide.test.ts tests/tiny-tide-plans.test.ts
git commit -m "Tiny Tide: plan paths in v3 saves with v2 conversion"
```

---

### Task 6: Path screen and the evolve flow

**Files:**
- Create: `src/tiny-tide/path-screen.ts`, `src/tiny-tide/path-screen.css`
- Modify: `src/tiny-tide/main.ts` (`edit()`, conversion toast, save key read)
- Modify: `src/tiny-tide/editor.ts` (`EditorOptions.plan`, header)

**Interfaces:**
- Consumes: `children`, `diffPlans`, `habitatLabel`, `BodyPlan` (Task 1); `currentPlan`, `evolve(run, id)`, `parseSaveWithNotes` (Task 5).
- Produces:
  - `openPathScreen(options: { current: BodyPlan; choices: BodyPlan[]; size: string }): Promise<string | null>` — resolves to a plan id or `null` (postpone).
  - `EditorOptions.plan: BodyPlan` (replaces `stage`; the stage is `plan.size`). `EditorOptions.mode` stays.

- [ ] **Step 1: Write `src/tiny-tide/path-screen.ts`**

```ts
// Choose the next body plan. Each card says plainly what you gain and lose.
import './path-screen.css';
import { diffPlans, habitatLabel, type BodyPlan } from './plans';

export interface PathOptions { current: BodyPlan; choices: BodyPlan[]; size: string }
export function openPathScreen(options: PathOptions): Promise<string | null> {
  return new Promise(resolve => {
    const root = document.createElement('section');
    root.id = 'path-screen'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'path-title');
    const card = (p: BodyPlan) => {
      const { gains, losses } = diffPlans(options.current, p), h = habitatLabel(p);
      return `<button class="path-card" data-plan="${p.id}">
        <span class="eyebrow">${options.size}</span><strong>${p.name}</strong><p>${p.blurb}</p>
        <ul class="path-habitats" aria-label="Habitats"><li data-level="${p.habitats.water}">💧 ${h.water}</li><li data-level="${p.habitats.land}">⛰ ${h.land}</li><li data-level="${p.habitats.air}">☁ ${h.air}</li></ul>
        <ul class="path-diff">${gains.map(g => `<li class="${g.startsWith('Needs') ? 'need' : 'gain'}">${g}</li>`).join('')}${losses.map(l => `<li class="loss">${l}</li>`).join('')}</ul>
        <small>${p.spine.min}–${p.spine.max} segments${p.spine.middle.locked ? ' · fixed body' : ''}</small>
        ${p.keystone ? `<em class="keystone">KEYSTONE · ${p.keystone.note}</em>` : ''}
      </button>`;
    };
    root.innerHTML = `<div class="path-inner"><div class="eyebrow">CHOOSE YOUR PATH</div><h2 id="path-title">What will you become?</h2>
      <p class="path-lede">You are a ${options.current.name}. Each path closes others.</p>
      <div class="path-cards">${options.choices.map(card).join('')}</div>
      <button class="path-later text-button">Not yet</button></div>`;
    document.querySelector('#app')!.append(root);
    const close = (id: string | null) => { removeEventListener('keydown', onKey); root.remove(); resolve(id); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    addEventListener('keydown', onKey);
    root.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach(b => b.onclick = () => close(b.dataset.plan!));
    root.querySelector<HTMLButtonElement>('.path-later')!.onclick = () => close(null);
    root.querySelector<HTMLButtonElement>('[data-plan]')?.focus();
  });
}
```

- [ ] **Step 2: Write `src/tiny-tide/path-screen.css`**

```css
#path-screen{position:fixed;inset:0;z-index:30;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 40%,#2f8f95ee,#0f363ff5);overflow-y:auto;padding:24px 16px}
.path-inner{width:min(1040px,100%);text-align:center}
.path-inner h2{font-family:ui-rounded,'Arial Rounded MT Bold',Tide,sans-serif;font-size:44px;letter-spacing:-1.5px;margin:6px 0}
.path-lede{opacity:.8;margin:0 0 22px}
.path-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.path-card{display:flex;flex-direction:column;gap:8px;text-align:left;padding:18px;border-radius:22px;background:#0c2f35c8;border:1px solid #ffffff1f;color:var(--cream)}
.path-card:hover,.path-card:focus-visible{border-color:var(--stage-color);background:#0c2f35f0}
.path-card strong{font-size:24px}
.path-card p{margin:0;opacity:.8;font-size:14px}
.path-habitats,.path-diff{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:5px}
.path-habitats li{font-size:11px;padding:3px 8px;border-radius:99px;background:#ffffff14}
.path-habitats li[data-level=none]{opacity:.45;text-decoration:line-through}
.path-diff li{font-size:12px;font-weight:700;padding:3px 9px;border-radius:99px}
.path-diff .gain{background:#c9f5a833;color:#c9f5a8}.path-diff .loss{background:#ff9d8a33;color:#ffc4b8}.path-diff .need{background:#ffffff1a}
.keystone{font-style:normal;font-size:11px;font-weight:800;letter-spacing:1px;color:#fff2b3}
.path-later{margin-top:18px}
@media(max-width:650px){.path-inner h2{font-size:32px}.path-cards{grid-template-columns:1fr}}
```

- [ ] **Step 3: Change the editor options**

In `src/tiny-tide/editor.ts`:
- `EditorOptions`: replace `stage: number` with `plan: BodyPlan` (import `type BodyPlan` and `habitatLabel` from `./plans`).
- Add `private get stage() { return this.options.plan.size; }` and replace every `this.options.stage` with `this.stage`.
- Header eyebrow: `${options.mode === 'evolve' ? `EVOLVE · ${options.plan.name.toUpperCase()} · ${stage.size}` : `${options.plan.name.toUpperCase()} · CREATURE EDITOR`}` where `stage = STAGES[options.plan.size]!`.
- Under the name input, add `<span class="ed-habitats">${Object.values(habitatLabel(options.plan)).join(' · ')}</span>` and CSS `.ed-habitats{font-size:11px;opacity:.75;letter-spacing:.4px}` in `editor.css`.
- Every `problems(this.draft, this.options.stage, …)` call becomes `problems(this.draft, this.options.plan, …)`.

- [ ] **Step 4: Wire the evolve flow in `main.ts`**

Imports: `import { openPathScreen } from './path-screen';`, `import { children } from './plans';`, and `currentPlan`, `parseSaveWithNotes` from `./state`.

Save loading (replace the `saved = parseSave(...) ?? parseSave(...)` line):

```ts
const SAVE_KEY = 'tiny-tide-adventure-v3', V2_SAVE_KEY = 'tiny-tide-adventure-v2', V1_SAVE_KEY = 'tiny-tide-adventure-v1';
let saved: Run | null = null, conversionNotes: string[] = [];
try {
  const loaded = parseSaveWithNotes(localStorage.getItem(SAVE_KEY)) ?? parseSaveWithNotes(localStorage.getItem(V2_SAVE_KEY)) ?? parseSaveWithNotes(localStorage.getItem(V1_SAVE_KEY));
  saved = loaded?.run ?? null; conversionNotes = loaded?.notes ?? [];
  audio.muted = localStorage.getItem('tiny-tide-muted') === 'true';
} catch { /* Storage is optional. */ }
```

In `begin()`, after `toast(...)`: `if (!fresh && conversionNotes.length) { toast(`Your creature became a ${currentPlan(run).name}. ${conversionNotes.join(' ')}`); conversionNotes = []; }`.

Replace `edit()`:

```ts
async function edit(kind: 'edit' | 'evolve') {
  if (mode !== 'playing' || (kind === 'evolve' && !evolveReady(run))) return;
  mode = 'editing'; clearInput(); save(); el('game-ui').classList.add('dimmed');
  let result: Awaited<ReturnType<typeof openEditor>> = null, chosen = currentPlan(run);
  while (true) {
    if (kind === 'evolve') {
      const id = await openPathScreen({ current: currentPlan(run), choices: children(currentPlan(run).id), size: `${STAGES[run.stage + 1]!.title.toUpperCase()} · ${STAGES[run.stage + 1]!.size}` });
      if (!id) break;
      chosen = plan(id)!;
    }
    result = await openEditor({ genome: run.genome, name: run.name, plan: chosen, unlocked: run.unlocked, budget: run.dna + genomeCost(run.genome), mode: kind });
    if (result || kind === 'edit') break;
  }
  el('game-ui').classList.remove('dimmed');
  if (!result) { mode = 'playing'; syncUI(); return; }
  const before = run.genome;
  applyDesign(run, result.genome, result.name, genomeCost);
  if (kind === 'evolve') { evolve(run, chosen.id); refreshDerived(); startTransformation(); return; }
  refreshDerived(); if (JSON.stringify(before) !== JSON.stringify(run.genome)) { world.setCreature(run.genome); world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#f4e2b9', 30); audio.found(); }
  mode = 'playing'; save(); syncUI();
}
```

Add `import { plan } from './plans';` (the same import line as `children`). In `startTransformation()`, change the banner name to `${run.name}, the ${currentPlan(run).name.toLowerCase()}`. In `syncUI()`, change the size line to `${currentPlan(run).name.toUpperCase()} · ${stage.size}`. If the current plan has no visible children and `run.stage < 4`, hide `#evolve` and set the objective to `Your path ends here for now.` (guards the case in spec §8).

- [ ] **Step 5: Type check and quick browser check**

Run: `npx tsc -b`
Expected: no errors.

Run: `node e2e/tiny-tide.mjs --visual-only`
Expected: `{"errors":[]}`. The editor part of this test still uses `#edit`, which now opens with the Speck plan.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/path-screen.ts src/tiny-tide/path-screen.css src/tiny-tide/editor.ts src/tiny-tide/editor.css src/tiny-tide/main.ts
git commit -m "Tiny Tide: path screen and plan-based evolve flow"
```

---

### Task 7: Plan rules in the editor

**Files:**
- Modify: `src/tiny-tide/editor.ts`, `src/tiny-tide/editor.css`

**Interfaces:**
- Consumes: `problems`, `fixForPlan`, `regionCounts` (Task 2); `regionOf`, `segmentRule` (Task 1); `layout`, `point`, `profile` from `src/tiny-tide/creature.ts`.
- Produces: no new exports. DOM contract for tests:
  - Fix button: `#editor .ed-fix` (hidden when no fixable problem).
  - Region chips: `#editor .ed-region[data-region=head|middle|tail]`, text `Head 3 / 4`.
  - Disabled banned card: `#editor .ed-card[data-part=<id>][disabled]` with `data-reason`.
  - Locked vertebra chip: `#editor [data-v][data-locked=true]`.
  - Red part: the problem list `#editor .ed-problem` lists every problem; red parts have emissive `#ff6b5a`.

- [ ] **Step 1: Banned and wrong-region cards**

In `renderParts()`, compute for each spec:

```ts
const plan = this.options.plan;
const banned = plan.bans.includes(spec.kind), nowhere = !Object.values(plan.regions).some(r => r.kinds.includes(spec.kind));
const reason = banned ? `${plan.name}s can't use ${KIND_LABELS[spec.kind].toLowerCase()}.` : nowhere ? `No room for ${KIND_LABELS[spec.kind].toLowerCase()} on a ${plan.name}.` : '';
```

Render the card as `disabled` when `!open || banned || nowhere`, add `data-reason="${reason}"`, and when `reason` is set, replace the cost line with `<span class="ed-cost">${reason}</span>`. Hide a kind tab (`[data-kind]`) whose every part is banned or has nowhere to go.

- [ ] **Step 2: Region slots on placement**

In `addPart(placed)`, before the complexity check:

```ts
const region = regionOf(placed.t, spec.kind), rule = this.options.plan.regions[region];
if (!rule.kinds.includes(spec.kind)) { this.hint(`${spec.name} doesn't fit in the ${region}.`); return; }
const used = regionCounts(this.draft)[region] - (replacingMouth >= 0 ? 1 : 0);
if (used + (placed.mirror ? 2 : 1) > rule.slots) {
  if (placed.mirror && used + 1 <= rule.slots) placed.mirror = false;
  else { this.hint(`The ${region} is full (${used} / ${rule.slots}).`); return; }
}
```

In `pointerMove` while dragging a part, compute the region of `next.t`; if the part does not fit there, keep the old position and show the hint once per drag.

- [ ] **Step 3: Region display**

Add a DOM element `<div class="ed-regions"></div>` to the editor root, and render in `renderStatsOnly()`:

```ts
const counts = regionCounts(this.draft), rules = this.options.plan.regions;
this.root.querySelector('.ed-regions')!.innerHTML = (['head', 'middle', 'tail'] as const).map(r => `<span class="ed-region ${counts[r] > rules[r].slots ? 'over' : ''}" data-region="${r}">${r[0]!.toUpperCase() + r.slice(1)} ${counts[r]} / ${rules[r].slots}</span>`).join('');
```

In `rebuild()`, when `this.placing || this.dragging`, add two rings at the region borders:

```ts
for (const t of [.25, .75]) {
  const l = this.model.layout, z = l.front - t * (l.front - l.rear), prof = profile(this.draft, l, z);
  const ring = new T.Mesh(new T.TorusGeometry(1, .012, 6, 48), new T.MeshBasicMaterial({ color: '#fff2b3', transparent: true, opacity: .7, depthTest: false }));
  ring.scale.set(prof.r + .04, prof.h + .04, 1); ring.position.set(0, prof.lift, z); ring.renderOrder = 6; this.handles.add(ring);
}
```

CSS:

```css
.ed-regions{position:absolute;left:50%;top:96px;transform:translateX(-50%);display:flex;gap:6px;z-index:2;pointer-events:none}
.ed-region{padding:4px 10px;border-radius:99px;background:#0c2f35c0;font-size:11px;font-weight:700}
.ed-region.over{background:#ff9d8a;color:var(--ink)}
@media (max-width:900px){.ed-regions{top:auto;bottom:calc(40vh + 52px)}}
```

Move `.ed-hint` desktop `top` from `96px` to `134px` so the hint does not cover the chips.

- [ ] **Step 4: Locked segments**

In `renderBody()`:
- Use `this.options.plan.spine.min/max` instead of `SPINE_LIMITS` for the add and remove buttons and the tip text.
- For each vertebra chip, `const locked = segmentRule(plan, i, spine.length).locked`; add `data-locked="${!!locked}"` and the text `🔒` after the label when locked.
- When the selected vertebra is locked, render the sliders with `disabled` and the tip `This part of a ${plan.name} has a fixed shape.`
- In `rebuild()`, skip the handle for locked vertebrae. In `pointerDown`, ignore a handle hit on a locked vertebra.
- When a segment is added, set its values with `segmentRule(...)`: clamp the copied values into the rule's ranges.

- [ ] **Step 5: Red parts, the problem list and Fix for me**

In `rebuild()`, after building the model, mark broken parts:

```ts
const broken = new Set(problems(this.draft, this.options.plan, this.options.unlocked).flatMap(p => p.part === undefined ? [] : [p.part]));
this.model.group.traverse(node => {
  if (!broken.has(node.userData.placedIndex) || !node.userData.partId) return;
  node.traverse(child => { if (child instanceof T.Mesh) { const m = (child.material as T.MeshStandardMaterial).clone(); m.emissive = new T.Color('#ff6b5a'); m.emissiveIntensity = .55; child.material = m; child.userData.ownedMaterial = true; } });
});
```

In `renderStatsOnly()`, list all problems (not only the first): `${issues.map(i => `<p class="ed-problem">${i.message}</p>`).join('')}`, and show the fix button when any problem other than `dna` exists:

```ts
const fixable = issues.some(i => i.code !== 'dna');
this.root.querySelector<HTMLButtonElement>('.ed-fix')!.hidden = !fixable;
```

Add `<button class="ed-fix ghost-button" hidden>Fix for me</button>` to `.ed-actions` before Undo, and its handler in the constructor:

```ts
this.root.querySelector<HTMLButtonElement>('.ed-fix')!.onclick = () => {
  const fixed = fixForPlan(this.draft, this.options.plan, this.options.unlocked);
  this.commit(g => { g.spine = fixed.genome.spine; g.parts = fixed.genome.parts; });
  this.selected = null; this.hint(fixed.notes.slice(0, 2).join(' ') || 'All fixed.');
};
```

On mobile, `.ed-problem` stays hidden (existing CSS); the red parts and the fix button carry the message.

- [ ] **Step 6: Manual check with a script**

Run: `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`
Expected: `{"errors":[]}`. Then open `http://127.0.0.1:5199/tiny-tide.html`, start, and press the pencil: region chips show `Head 3 / 4 · Middle 2 / 4 · Tail 1 / 2` for the starter creature on Speck.

- [ ] **Step 7: Commit**

```bash
git add src/tiny-tide/editor.ts src/tiny-tide/editor.css
git commit -m "Tiny Tide: plan rules, regions, locks and Fix for me in the editor"
```

---

### Task 8: Editor pointer controls

**Files:**
- Modify: `src/tiny-tide/editor.ts` (pointer handlers), `src/tiny-tide/editor.css` (cursor), canvas `aria-label`

**Interfaces:**
- Consumes: nothing new.
- Produces: DOM contract for tests: the editor exposes the view angle as `data-yaw` on `#editor .ed-view` (rounded to 3 decimals, updated in `draw()`), so a test can see whether the model turned. The zoom is `data-zoom`.

Gesture table (from the spec):

| Input | Result |
| --- | --- |
| Left click on body | place the chosen part |
| Left drag on a part | move the part |
| Left drag on empty space | nothing |
| Right or middle drag | turn |
| Wheel | zoom |
| One-finger tap on body | place |
| One-finger drag on a part | move |
| Two-finger drag | turn (cancels a part drag) |
| Pinch | zoom |

- [ ] **Step 1: Replace the pointer handlers**

State fields (replace `orbit`):

```ts
private pointers = new Map<number, { x: number; y: number; type: string }>();
private turning: { x: number; y: number } | null = null;
private pinch: { distance: number; zoom: number; x: number; y: number } | null = null;
```

Constructor: add `this.canvas.addEventListener('contextmenu', e => e.preventDefault());` and change the canvas label to `"Your creature. Right-drag or two-finger drag to turn it. Tap a part to select it."`.

Handlers:

```ts
private pointerDown(event: PointerEvent) {
  this.canvas.setPointerCapture(event.pointerId);
  this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
  const touches = [...this.pointers.values()].filter(p => p.type === 'touch');
  if (touches.length === 2) {
    // A second finger always means "turn and zoom". Drop any part drag.
    if (this.dragging?.moved) this.undo(); this.dragging = null; this.handleDrag = null;
    const [a, b] = touches as [{ x: number; y: number }, { x: number; y: number }];
    this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return;
  }
  if (event.pointerType === 'mouse' && (event.button === 2 || event.button === 1)) { this.turning = { x: event.clientX, y: event.clientY }; return; }
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const { handle, partIndex } = this.pick(event);
  if (handle !== undefined && this.tab === 'body') { /* existing vertebra handle code, minus the orbit assignment */ return; }
  if (!this.placing && partIndex !== null && this.tab === 'parts') { this.selected = partIndex; this.dragging = { index: partIndex, moved: false }; this.rebuild(); this.render(); }
}
private pointerMove(event: PointerEvent) {
  const known = this.pointers.get(event.pointerId); if (known) { known.x = event.clientX; known.y = event.clientY; }
  if (this.pinch) {
    const touches = [...this.pointers.values()].filter(p => p.type === 'touch'); if (touches.length < 2) return;
    const [a, b] = touches as [{ x: number; y: number }, { x: number; y: number }], cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.yaw -= (cx - this.pinch.x) * .008; this.pitch = T.MathUtils.clamp(this.pitch + (cy - this.pinch.y) * .006, -.9, 1.3);
    this.zoom = T.MathUtils.clamp(this.pinch.zoom * this.pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), .55, 2);
    this.pinch.x = cx; this.pinch.y = cy; return;
  }
  if (this.turning) {
    this.yaw -= (event.clientX - this.turning.x) * .008; this.pitch = T.MathUtils.clamp(this.pitch + (event.clientY - this.turning.y) * .006, -.9, 1.3);
    this.turning = { x: event.clientX, y: event.clientY }; return;
  }
  // existing handleDrag, dragging and placing branches stay as they are.
}
private pointerUp(event: PointerEvent) {
  this.pointers.delete(event.pointerId);
  if (this.pinch) { if ([...this.pointers.values()].filter(p => p.type === 'touch').length < 2) this.pinch = null; return; }
  if (this.turning) { this.turning = null; return; }
  if (this.handleDrag) { this.handleDrag = null; this.render(); return; }
  if (this.dragging) { this.dragging = null; this.render(); return; }
  if (this.cardDrag) return;
  if (this.placing) { const { bodyPoint } = this.pick(event); if (bodyPoint) this.addPart(this.placement(bodyPoint, this.placing)); return; }
  // A plain click on empty space clears the selection; it never turns the model.
  const { partIndex, bodyPoint } = this.pick(event);
  if (partIndex === null && !bodyPoint && this.selected !== null) { this.selected = null; this.rebuild(); this.render(); }
}
```

`pointercancel` handler: `this.pointers.delete(e.pointerId); this.pinch = null; this.turning = null; this.dragging = null;`.

Remove the old `orbit` field and every use of it.

In `draw()`, after computing the camera: `this.canvas.dataset.yaw = this.yaw.toFixed(3); this.canvas.dataset.zoom = this.zoom.toFixed(3);`.

CSS: replace `#editor .ed-view{…cursor:grab}` and `:active{cursor:grabbing}` with `#editor .ed-view{…cursor:default}`.

Update the tips: parts tab tip → `Choose a part, then tap your creature. Right-drag (or two fingers) to turn.`

- [ ] **Step 2: Type check and the editor smoke test**

Run: `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`
Expected: `{"errors":[]}`. The `tapCreature()` helper in that test still works, because a left click on the body places the part.

- [ ] **Step 3: Commit**

```bash
git add src/tiny-tide/editor.ts src/tiny-tide/editor.css
git commit -m "Tiny Tide: one job per gesture in the editor view"
```

---

### Task 9: Movement, buttons and food follow the plan

**Files:**
- Modify: `src/tiny-tide/main.ts`, `src/tiny-tide/world.ts`

**Interfaces:**
- Consumes: `constrainMove`, `settle`, `groundBound`, `canBreach`, `reachable`, `zoneAt`, `blockHint` (Tasks 3–4); `currentPlan` (Task 5).
- Produces: `TideWorld.placePlayer(stage: number, groundBound: boolean)`. `__tinyTide` adds `plan: string`, `plans: string[]`, `zone: Zone`, `pathOpen: boolean`.

- [ ] **Step 1: `world.placePlayer`**

```ts
placePlayer(stage: number, onGround = stage === 0) {
  const y = onGround ? this.groundAt(0, 0) + .65 : stage === 1 ? 2 : stage === 2 ? this.surface - 3 : stage === 3 ? this.surface + 2 : 3;
  // …rest unchanged
}
```

`build()` calls `this.placePlayer(stage, run.groundBound ?? stage === 0)`; extend its `run` parameter type with `groundBound?: boolean`. In `main.ts`, `world.build(run.stage, { ...run, groundBound: groundBound(currentPlan(run)) })` and the faint handler calls `world.placePlayer(run.stage, groundBound(currentPlan(run)))`.

In `world.update`, replace `this.stage === 0` in the avatar bob and bite ring with a public field `onGround` that `main.ts` sets each frame (`world.onGround = groundBound(plan)`).

- [ ] **Step 2: Movement in `frame()`**

Replace the movement block between `const s = STAGES[run.stage]!` and `if (holdingChomp …)` with this logic (keep the existing look and leap code inside it):

```ts
const plan = currentPlan(run), onGround = groundBound(plan), breach = canBreach(plan);
world.onGround = onGround;
const from = { x: p.x, y: p.y, z: p.z };
// …existing direction/target code; use world.moveVector(dx, dz, !onGround) and p.addScaledVector(...)
const floor = world.groundAt(p.x, p.z);
if (onGround) p.y = T.MathUtils.damp(p.y, floor + .65, 15, dt);
else if (breach && leap >= 0) { /* existing breach arc, unchanged */ }
else {
  const vertical = Number(rising || keys.has('KeyE')) - Number(diving || keys.has('KeyQ'));
  p.y += vertical * dt * speed * .7;
  const minY = run.stage === 4 ? -18 : floor + .9;
  p.y = Math.max(p.y, minY);
}
if (leap < 0 && !world.transitioning) {
  const result = constrainMove(plan, run.stage, from, { x: p.x, y: p.y, z: p.z }, world);
  p.set(result.point.x, result.point.y, result.point.z);
  if (result.blocked && hintClock <= 0) { toast(blockHint(plan, result.blocked)); hintClock = 6; }
}
```

Add `hintClock` to the `let` list and decrement it with the other clocks. The old hard clamps `maxY = run.stage <= 2 ? world.surface - .6 : 30` and the `run.stage === 3 ? 1.5` floor offset are replaced by `constrainMove` and the plan habitats; keep `p.y <= 30` for size 3 so flyers do not leave the sky box: `if (run.stage === 3) p.y = Math.min(p.y, 30);`.

Tap-to-move on the ground (`canvas pointerup`): change `run.stage === 0` to `groundBound(currentPlan(run))`.

Breach key: `special()` checks `canBreach(currentPlan(run))` instead of `run.stage !== 2`.

- [ ] **Step 3: Settle after an evolution**

In `frame()`, where the transformation ends (`if (mode === 'evolving' && !world.transitioning)`), before switching to `playing`:

```ts
const settled = settle(currentPlan(run), run.stage, world.player.position, world);
world.player.position.set(settled.x, settled.y, settled.z);
```

- [ ] **Step 4: Buttons follow habitats**

In `syncUI()`:

```ts
const plan = currentPlan(run), onGround = groundBound(plan), breach = canBreach(plan);
el('vertical-controls').hidden = onGround; el('special').hidden = onGround;
el('special-label').textContent = breach ? 'BREACH' : 'RISE'; el('special').setAttribute('aria-label', breach ? 'Breach' : 'Rise');
el('special').classList.toggle('cooldown', breach && leapCooldown > 0);
```

Replace `run.stage === 2` in the guide's height hint with `canBreach(currentPlan(run))`, and `run.stage === 0` in the depth hint with `groundBound(currentPlan(run))`.

- [ ] **Step 5: Food guide, objective and hunters use reachability**

- `updateGuide()`: filter `world.edibleFoods` with `reachable(plan, run.stage, f.data, world)` as well as the diet.
- `objective()`: list species of the tier whose food can be reached by at least one live entity: `tierSpecies(run.stage).filter(s => dietCanEat(diet, s.tag) && world.edibleFoods.some(f => f.entity.spec === s && reachable(plan, run.stage, f.data, world)))`.
- `biteTargets()`: skip own-tier food that is not reachable (`!reachable(...)`); attacking hunters are always biteable.
- `world.eco.step({...})`: add `playerZone: zoneAt(run.stage, world.player.position, world)`.

- [ ] **Step 6: Diagnostics**

In the `__tinyTide` getter add: `plan: currentPlan(run).id, plans: [...run.plans], zone: zoneAt(run.stage, world.player.position, world), pathOpen: !!document.querySelector('#path-screen')`.

- [ ] **Step 7: Type check and run the existing browser tests**

Run: `npx tsc -b && node e2e/tiny-tide-mobile.mjs && node e2e/tiny-tide-replay.mjs`
Expected: both PASS. The mobile fixture is a v1 save at size 1, which now loads as a Swimmer: Rise works, so the move-and-rise assertions still hold.

- [ ] **Step 8: Commit**

```bash
git add src/tiny-tide/main.ts src/tiny-tide/world.ts
git commit -m "Tiny Tide: movement, buttons, food and hunters follow the body plan"
```

---

### Task 10: Browser tests for paths, and docs

**Files:**
- Create: `e2e/tiny-tide-paths.mjs`
- Modify: `e2e/tiny-tide.mjs` (evolve through the path screen)
- Modify: `docs/TINY-TIDE.md`, `docs/TINY-TIDE-EVOLUTION.md`

**Interfaces:**
- Consumes: DOM contracts from Tasks 6–8 (`#path-screen [data-plan]`, `.path-later`, `.ed-fix`, `.ed-card[disabled][data-reason]`, `.ed-view[data-yaw]`, `.ed-region`), and `__tinyTide.plan/plans/zone/pathOpen`.

- [ ] **Step 1: Update `e2e/tiny-tide.mjs` for the path screen**

In the `if (s.evolveReady)` block, after `await page.locator('#evolve').click();` add:

```js
await page.locator('#path-screen').waitFor();
const line = ['swimmer', 'darter', 'sky_drifter', 'star_swimmer'][s.stage];
await page.locator(`#path-screen [data-plan=${line}]`).click();
await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
if (await page.locator('#editor .ed-fix').isVisible()) await page.locator('#editor .ed-fix').click();
```

Remove the old `await page.locator('#editor').waitFor();` that followed the Evolve click. Keep the mouth changes (Snapper at size 0→1, Beak at 1→2). At the end, assert `assert.deepEqual(done.plans, ['speck', 'swimmer', 'darter', 'sky_drifter', 'star_swimmer']);`.

In the early editor section, the spike placement uses `tapCreature()`, which places in the middle region of Speck (4 slots, 2 used): still valid.

- [ ] **Step 2: Write `e2e/tiny-tide-paths.mjs`**

```js
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const url = process.env.VERIFY_URL || 'http://127.0.0.1:5199/tiny-tide.html?qa';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
// A v3 save at size 0 with a full DNA bar, so Evolve is ready at once.
const ready = { version: 3, seed: 4242, name: 'Pathy', stage: 0, plans: ['speck'], dna: 200, stageDna: 100, totalDna: 100, bites: 12, elapsed: 60, deaths: 0, health: 6,
  genome: { spine: [{ radius: .5, height: .48, lift: .05 }, { radius: .62, height: .58, lift: .02 }, { radius: .52, height: .48, lift: 0 }, { radius: .32, height: .3, lift: .04 }],
    parts: [{ id: 'mouth_nibbler', t: 0, angle: 0, scale: .8, mirror: false, roll: 0 }, { id: 'eye_stalk', t: .16, angle: .5, scale: .75, mirror: true, roll: 0 }, { id: 'tail_paddle', t: 1, angle: 0, scale: .8, mirror: false, roll: 0 }, { id: 'leg_little', t: .45, angle: 2.47, scale: .7, mirror: true, roll: 0 }],
    paint: { base: '#ffad92', belly: '#ffe1b8', accent: '#ef8a80', pattern: 'freckles' } }, unlocked: [], eatenPlanets: [], completed: false };
async function freshPage(save, viewport = { width: 1440, height: 900 }, mobile = false) {
  const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await context.addInitScript(s => localStorage.setItem('tiny-tide-adventure-v3', s), JSON.stringify(save));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url); await page.waitForFunction(() => window.__tinyTide?.time > .4, {}, { timeout: 60000 });
  await page.locator('#start').click(); await page.waitForTimeout(500);
  return { page, context, errors, state: () => page.evaluate(() => window.__tinyTide) };
}
try {
  // 1. Path screen: cards, gains and losses, postpone, choose.
  {
    const { page, context, errors, state } = await freshPage(ready);
    await page.locator('#evolve').click(); await page.locator('#path-screen').waitFor();
    const ids = await page.locator('#path-screen [data-plan]').evaluateAll(b => b.map(x => x.dataset.plan));
    assert.deepEqual(ids, ['swimmer', 'crawler'], 'Coast plans stay hidden');
    assert.match(await page.locator('[data-plan=swimmer] .loss').allTextContents().then(t => t.join(' ')), /No legs/);
    await page.screenshot({ path: `${out}/paths-01-screen.png` });
    await page.locator('#path-screen .path-later').click(); assert.equal((await state()).mode, 'playing'); assert.equal((await state()).stage, 0);
    // Swimmer: legs are banned, so the design is broken until fixed.
    await page.locator('#evolve').click(); await page.locator('[data-plan=swimmer]').click(); await page.locator('#editor').waitFor();
    assert.equal(await page.locator('#editor .ed-done').isDisabled(), true, 'Legs on a Swimmer block Done');
    await page.locator('#editor .ed-kinds button', { hasText: 'Legs' }).waitFor({ state: 'detached' }).catch(() => {});
    assert.equal(await page.locator('#editor .ed-kinds button', { hasText: 'Legs' }).count(), 0, 'Banned part tab is hidden');
    await page.locator('#editor .ed-fix').click();
    assert.equal(await page.locator('#editor .ed-done').isDisabled(), false, 'Fix for me makes the design valid');
    // Controls: left drag on empty space does not turn; right drag does.
    const view = page.locator('#editor .ed-view'), yaw = () => view.getAttribute('data-yaw').then(Number);
    const y0 = await yaw();
    await page.mouse.move(1300, 800); await page.mouse.down(); await page.mouse.move(1150, 780, { steps: 6 }); await page.mouse.up();
    assert.equal(await yaw(), y0, 'Left drag on empty space does nothing');
    await page.mouse.move(1300, 800); await page.mouse.down({ button: 'right' }); await page.mouse.move(1150, 780, { steps: 6 }); await page.mouse.up({ button: 'right' });
    assert.notEqual(await yaw(), y0, 'Right drag turns the model');
    await page.screenshot({ path: `${out}/paths-02-swimmer-editor.png` });
    await page.locator('#editor .ed-done').click(); await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
    const s = await state(); assert.deepEqual(s.plans, ['speck', 'swimmer']); assert.equal(s.stage, 1);
    assert.ok(!s.genome.parts.some(p => p.id === 'leg_little'));
    // A Swimmer can't rise into the air.
    await page.keyboard.down('KeyE'); await page.waitForTimeout(4000); await page.keyboard.up('KeyE');
    const high = await state(); assert.notEqual(high.zone, 'air'); assert.ok(high.player.y < high.world.surface);
    assert.deepEqual(errors, []); await context.close();
  }
  // 2. Crawler: stays on the seabed, no Rise or Dive.
  {
    const { page, context, errors, state } = await freshPage(ready);
    await page.locator('#evolve').click(); await page.locator('[data-plan=crawler]').click(); await page.locator('#editor').waitFor();
    assert.equal(await page.locator('#editor .ed-done').isDisabled(), false, 'The starter design is a valid Crawler');
    await page.locator('#editor .ed-done').click(); await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
    assert.equal(await page.locator('#vertical-controls').isHidden(), true);
    await page.keyboard.down('KeyE'); await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE');
    const s = await state(); assert.equal(s.zone, 'seabed'); assert.equal(s.plan, 'crawler');
    await page.screenshot({ path: `${out}/paths-03-crawler.png` });
    assert.deepEqual(errors, []); await context.close();
  }
  // 3. Touch: a two-finger drag turns the editor model and does not move a part.
  {
    const { page, context, errors } = await freshPage(ready, { width: 390, height: 844 }, true);
    await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
    const before = await page.locator('#editor .ed-view').getAttribute('data-yaw');
    const cdp = await context.newCDPSession(page);
    const a = { id: 1, x: 150, y: 300, radiusX: 4, radiusY: 4, force: 1 }, b = { id: 2, x: 240, y: 300, radiusX: 4, radiusY: 4, force: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
    for (let i = 0; i < 6; i++) { a.x += 12; b.x += 12; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual(await page.locator('#editor .ed-view').getAttribute('data-yaw'), before, 'Two fingers turn the model');
    assert.equal(await page.locator('#editor .ed-undo').isDisabled(), true, 'No part moved');
    assert.deepEqual(errors, []); await context.close();
  }
  console.log('PASSED: path screen (hidden coast plans, gains/losses, postpone), Swimmer rules and Fix for me, editor mouse and touch gestures, Swimmer surface limit, Crawler seabed limit.');
} finally { await browser.close(); }
```

- [ ] **Step 3: Run the browser tests**

Run: `node e2e/tiny-tide-paths.mjs`
Expected: `PASSED: path screen …`.

Run in the background (about 15 minutes): `node e2e/tiny-tide.mjs`
Expected: `PASSED: editor …` and `done.plans` equals the Swimmer line.

Run: `node e2e/tiny-tide-mobile.mjs && node e2e/tiny-tide-replay.mjs`
Expected: both PASS.

- [ ] **Step 4: A Crawler-line journey check**

The spec asks for the whole game on the Crawler line too. Add an env switch to `e2e/tiny-tide.mjs`: `const LINE = process.env.TIDE_LINE === 'crawler' ? ['crawler', 'shellback', 'sky_drifter', 'star_swimmer'] : ['swimmer', 'darter', 'sky_drifter', 'star_swimmer'];` and use `LINE[s.stage]` in Step 1's click. For the Crawler line, skip the Rise/Dive keys while `s.plan` is `crawler` or `shellback` (the bot steers on the ground only), and skip the `diets` assertion's bird expectations (Shellbacks can't breach). Final assertion: `done.plans` equals `['speck', ...LINE]`.

Run: `TIDE_LINE=crawler node e2e/tiny-tide.mjs`
Expected: `PASSED`.

- [ ] **Step 5: Update the docs**

`docs/TINY-TIDE.md`, add after "Your creature":

```md
## Body plans and habitats

Each evolution offers 2–3 body plans. The path screen shows what each plan
gains and loses. A plan sets where you can go (seabed, shallow water, open
water, land, air), how many segments your body may have, which parts fit in
the head, middle and tail, and which parts it needs or bans. Some plans lock
the shape of the body. Choices close other branches.

| Size | Plans |
| --- | --- |
| Tiny | Speck (seabed) |
| Small | Swimmer (open water, needs a tail, no legs), Crawler (seabed, needs legs) |
| Big | Darter (small and quick), Bulk (wide and tough), Shellback (fixed shell) |
| Huge | Sky drifter (flies) |
| Cosmic | Star swimmer |

Shore plans (Shore-walker, Strider, Mudskipper) arrive with the coast.

When a plan blocks a move, you slide along the border and a hint says why.
Hunters do not follow you into zones they can't enter.

The editor shows each region's slots, marks broken parts in red and offers
**Fix for me**. Controls: click to place, drag a part to move it, right-drag
(or two fingers) to turn, wheel (or pinch) to zoom.
```

In the Verification section add `node e2e/tiny-tide-paths.mjs` and `npm test -- --run tests/tiny-tide-plans.test.ts`. In the saves paragraph, change "Saves use version 2" to "Saves use version 3; version 2 saves join the Swimmer line, and parts that the plan does not allow are refunded."

`docs/TINY-TIDE-EVOLUTION.md`: add one line under "Scope": `Body plans, habitats and part locks: see docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md.`

- [ ] **Step 6: Final verification**

Run: `npx tsc -b && npx vitest run && npm run build && python3 scripts/tiny-tide/blender/check_assets.py`
Expected: no type errors; all test files pass; build succeeds (the existing chunk-size warning is expected); `PASS: 86 self-contained Blender GLBs`.

- [ ] **Step 7: Commit**

```bash
git add e2e/tiny-tide.mjs e2e/tiny-tide-paths.mjs docs/TINY-TIDE.md docs/TINY-TIDE-EVOLUTION.md
git commit -m "Tiny Tide: path, rule and gesture browser tests; docs"
```

---

## Self-review notes

- Spec coverage: §2 plans → Task 1; regions, segments, keystone data → Tasks 1–2 (keystone UI label in Task 6 card); §3 zones, movement, habitat levels, buttons, food and danger → Tasks 3, 4, 9; §4 evolve flow → Task 6; §5 editor rules → Task 7, pointer controls → Task 8; §6 data and saves → Task 5; §7 modules → all; §8 edge cases: corrupt paths (Task 5), no visible children (Task 6 Step 4), settle after evolution (Tasks 3 and 9); §9 tests → Tasks 1–5 (unit) and 10 (browser).
- Types used across tasks: `BodyPlan`, `Zone`, `Terrain`, `Vec`, `regionOf(t, kind?)`, `problems(g, plan, unlocked, budget?)`, `fixForPlan(g, plan, unlocked)`, `evolve(run, planId)`, `currentPlan(run)`, `parseSaveWithNotes(raw)`, `openPathScreen({ current, choices, size })`, `EditorOptions.plan`, `world.placePlayer(stage, onGround)`, `world.onGround`.
