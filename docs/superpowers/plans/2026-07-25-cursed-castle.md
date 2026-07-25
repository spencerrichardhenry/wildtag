# Cursed Castle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Cursed Castle feature set to Wildtag: forageable mushrooms, purifying darts, a day/night cycle, player HP, a grand castle with catchable gargoyles, night goblins, purified elves, a dark crystal whose purification permanently transforms the castle into an elf city — plus a world grandeur rescale (giant trees, taller crags, imposing castle).

**Architecture:** Goblins/elves/castle live in a new `src/castle/` subsystem, fully separate from the critter system (critters stay non-violent). Gargoyles ARE regular critters (new species + new `perch` flee-style) spawned at fixed castle perch slots. Day/night is a pure clock (`src/core/daylight.ts`) whose darkness value drives live mutation of the existing scene lights/sky/fog. All tuning constants go in `src/core/constants.ts`. Pure logic modules never import `three` and are Vitest-TDD'd.

**Tech Stack:** Three.js + Vite + TypeScript, Vitest (`npm test`), Playwright e2e (`PLAYWRIGHT_DIR=<dir with playwright installed> node e2e/verify.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-25-cursed-castle-design.md` — read it before starting any task.

## Global Constraints

- Branch: `feat/cursed-castle`. Commit after every task (conventional commits).
- ALL tuning constants live in `src/core/constants.ts` — never inline numbers elsewhere.
- `heightAt(x,z)` in `src/world/terrain.ts` is the single analytic ground truth — nothing raycasts meshes for gameplay.
- Pure modules (`src/core/`, `src/castle/goblins.ts`, `src/castle/layout.ts`, `src/player/health.ts`, etc.) never import `three`.
- All models procedural from three.js primitives — zero external assets.
- Free flight must remain impossible by construction (gargoyle glide, castle grapple included).
- Critter system gains no combat concepts. Goblins are not critters.
- The full suite must pass after every task: `npm test` (476+ tests) and `npx tsc --noEmit`.
- `npm run dev` serves on port 5199.

---

### Task 1: Forageable mushrooms

Mushrooms exist as decorative forest scatter (`'mushroom'` PropKind). Make them a harvestable resource like fiber/resin/shard/spark.

**Files:**
- Modify: `src/core/types.ts:6` (ResourceKind), `src/craft/inventory.ts` (Inventory + createInventory), `src/world/props.ts:567` (RESOURCE_KINDS), `src/core/save.ts:262-296` (inventory guard), `src/ui/hud.ts:53-62,172-188,371-390` (RES_COLOR + resource strip), `src/ui/screens.ts` (RESOURCE_LABEL), `src/core/constants.ts:478` (mushroom cap 4 → 8)
- Test: `tests/resources.test.ts`, `tests/inventory.test.ts` (or `tests/craft.test.ts` if inventory tests live there), `tests/save.test.ts`

**Interfaces:**
- Consumes: `NodeState`/`harvest` from `src/world/resources.ts` (already generic over `ResourceKind` — no changes needed there).
- Produces: `ResourceKind = 'fiber'|'resin'|'shard'|'spark'|'mushroom'`; `Inventory.mushroom: number`. Task 2's recipe cost uses `{ mushroom: n }`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/resources.test.ts — add:
it('mushroom nodes harvest and respawn like other resources', () => {
  const nodes = [makeNode(1, 'mushroom', 5, 5, 1)];
  const { nodes: after, gained } = harvest(nodes, 1, 100);
  expect(gained).toBe('mushroom');
  expect(isAvailable(after[0], 100)).toBe(false);
  expect(isAvailable(after[0], 100 + SCATTER.respawnS)).toBe(true);
});

// tests/inventory.test.ts (wherever createInventory is tested) — add:
it('inventory tracks mushrooms', () => {
  const inv = createInventory();
  expect(inv.mushroom).toBe(0);
  addResource(inv, 'mushroom', 3);
  expect(inv.mushroom).toBe(3);
  expect(spend(inv, { mushroom: 2 })!.mushroom).toBe(1);
  expect(spend(inv, { mushroom: 9 })).toBeNull();
});

// tests/save.test.ts — add:
it('v2 save without mushroom field loads with mushroom 0', () => {
  const s = decodeSave(encodeSave(makeSaveV2Fixture())); // reuse existing fixture helper
  expect(s!.inventory.mushroom).toBe(0);
});
it('mushroom count round-trips', () => {
  const st = makeSaveV2Fixture(); st.inventory.mushroom = 7;
  expect(decodeSave(encodeSave(st))!.inventory.mushroom).toBe(7);
});
```
Adapt fixture-helper names to what `tests/save.test.ts` actually uses — read it first.

- [ ] **Step 2: Run tests, verify they fail** — `npm test -- resources inventory save` (mushroom not in ResourceKind → type errors count as failures).

- [ ] **Step 3: Implement**
  1. `types.ts:6`: `export type ResourceKind = 'fiber'|'resin'|'shard'|'spark'|'mushroom';`
  2. `inventory.ts`: add `mushroom: number` to `Inventory`; `mushroom: 0` in `createInventory()`. (`addResource`/`spend` are already generic over `ResourceKind` keys.)
  3. `props.ts:567`: `const RESOURCE_KINDS = new Set<PropKind>(['fiber','resin','shard','spark','mushroom'])` — mushrooms now get `NodeState`s, deplete-shrink visuals, and harvest-cone targeting for free.
  4. `save.ts` inventory guard (~L269-276): keep `mushroom` OUT of the required list; copy the `charms` optional-field pattern: present → must be a number; absent → default 0. Include it in the assembled `Inventory` (~L287-296) and ensure `encodeSave` writes it (follow how `charms` is emitted).
  5. HUD: add `mushroom` to `RES_COLOR` (`hud.ts:53`, use `0x9c5bd0` — the cap colour), add `'mushroom'` to the resource-strip build list (`hud.ts:172-188`) and to `paintResources` values (`hud.ts:371-390`). Add `mushroom: 'Mushroom'` to `RESOURCE_LABEL` in `screens.ts`.
  6. `constants.ts:478`: `mushroom: 4` → `mushroom: 8` (forage supply).

- [ ] **Step 4: Run tests** — `npm test` all green; `npx tsc --noEmit` clean. TypeScript will surface any `Record<ResourceKind, ...>` exhaustiveness sites missed — fix each by adding the mushroom entry.

- [ ] **Step 5: Manual smoke (optional but fast)** — `npm run dev`, `?fresh=1&debug=grapple`, teleport to forest, aim at a glow mushroom: harvest prompt appears, KeyF adds to a visible mushroom counter in the HUD strip.

- [ ] **Step 6: Commit** — `git commit -m "feat(resources): forageable glow mushrooms"`

---

### Task 2: Purifying Dart recipe + inventory counter

**Files:**
- Modify: `src/core/types.ts:15,31-47` (RecipeId, Recipe.grants), `src/craft/recipes.ts:16` (RECIPES), `src/craft/inventory.ts` (purifiers counter), `src/core/save.ts` (guard), `src/ui/hud.ts` (strip entry), `src/ui/screens.ts` (labels if needed)
- Test: `tests/craft.test.ts`, `tests/save.test.ts`

**Interfaces:**
- Consumes: `Inventory.mushroom` (Task 1).
- Produces: `RecipeId` gains `'purifier'`; `Recipe.grants` union gains `'purifiers'`; `Inventory.purifiers: number`. Task 12 (dart firing) decrements `inventory.purifiers`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/craft.test.ts — add:
it('purifier recipe crafts a batch of 5 into the purifiers counter', () => {
  const inv = createInventory();
  inv.rp = 75; inv.mushroom = 3; inv.shard = 2; inv.fiber = 1;
  expect(canCraft(inv, 'purifier', new Set()).ok).toBe(true);
  const r = craft(inv, 'purifier', new Set());
  expect(r.inv.purifiers).toBe(5);
  expect(r.inv.mushroom).toBe(0);
});
it('purifier is RP-gated at 75', () => {
  const inv = createInventory();
  inv.mushroom = 3; inv.shard = 2; inv.fiber = 1; inv.rp = 74;
  expect(canCraft(inv, 'purifier', new Set())).toEqual({ ok: false, reason: 'rp' });
});
```

- [ ] **Step 2: Run, verify failure** — `npm test -- craft`

- [ ] **Step 3: Implement**
  1. `types.ts:15`: add `'purifier'` to `RecipeId`. `types.ts:47`: `grants?: 'darts'|'charms'|'purifiers'`.
  2. `inventory.ts`: `purifiers: number` on `Inventory`, `purifiers: 0` in `createInventory()`.
  3. `recipes.ts` RECIPES entry (after the charm entry):
```ts
{
  id: 'purifier', name: 'Purifying Dart', tier: 2, rpRequired: 75,
  cost: { mushroom: 3, shard: 2, fiber: 1 }, kind: 'consumable',
  batch: 5, grants: 'purifiers',
},
```
  4. Verify the consumable branch (`recipes.ts:150-156`) indexes `paid[recipe.grants ?? 'darts']` generically — if it narrows to darts/charms, widen it.
  5. `save.ts`: optional-field guard + emit for `purifiers` (same pattern as Task 1's mushroom).
  6. HUD strip: add a `purifier` row (`RES_COLOR` `0x8ef0c0`, label `Purifiers`) next to the existing `dart` row — follow exactly how `dart`/`charm` (non-ResourceKind counters) are wired in `hud.ts:172-188` and `paintResources`.
  7. Craft screen picks the recipe up automatically from `RECIPES`; confirm `renderCostPills` (`screens.ts:289`) shows the mushroom pill (needs Task 1's `RESOURCE_LABEL` entry).

- [ ] **Step 4: Run tests** — `npm test`, `npx tsc --noEmit` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(craft): purifying dart recipe (mushroom-based, batch of 5)"`

---

### Task 3: Daylight clock (pure core module)

**Files:**
- Create: `src/core/daylight.ts`
- Modify: `src/core/constants.ts` (new `DAYLIGHT` block)
- Test: `tests/daylight.test.ts` (new)

**Interfaces:**
- Consumes: nothing (pure math).
- Produces (used by Tasks 4, 5, 11):
```ts
export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';
export interface DaylightSample { phase: DayPhase; darkness: number; cycleT: number }
export function daylightAt(t: number): DaylightSample;   // t = seconds since world start, any >= 0
export function cycleLength(): number;                    // total seconds in one cycle
```
`darkness`: 0 all day, smoothstep 0→1 across dusk, 1 all night, 1→0 across dawn. `cycleT` ∈ [0,1): fraction through the full cycle (day starts at 0). Time wraps: `daylightAt(t)` = `daylightAt(t % cycleLength())`.

- [ ] **Step 1: Constants** — add to `constants.ts` (near `ENV`):
```ts
/** Day/night cycle timing (seconds) and night look. Consumed by core/daylight.ts and world/environment.ts. */
export const DAYLIGHT = {
  dayS: 480, duskS: 60, nightS: 240, dawnS: 60,
  /** Night sky/fog/light targets, lerped by darkness. */
  night: {
    skyTop: 0x070d1f, skyMid: 0x101c38, skyHorizon: 0x1d2942,
    fogColor: 0x0d1424, fogNear: 110, fogFar: 720,
    sunIntensity: 0.22, sunColor: 0x9db4e0, hemiIntensity: 0.25,
    moonColor: 0xe8efff, moonSize: 46, starCount: 350, starSize: 1.5,
  },
} as const;
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/daylight.test.ts
import { describe, it, expect } from 'vitest';
import { daylightAt, cycleLength } from '../src/core/daylight.ts';
import { DAYLIGHT } from '../src/core/constants.ts';

describe('daylight clock', () => {
  it('cycle length is the sum of the four phases', () => {
    expect(cycleLength()).toBe(DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS);
  });
  it('starts in full day', () => {
    expect(daylightAt(0)).toMatchObject({ phase: 'day', darkness: 0 });
    expect(daylightAt(DAYLIGHT.dayS - 1).phase).toBe('day');
  });
  it('dusk ramps darkness 0 to 1 monotonically', () => {
    const mid = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS / 2);
    expect(mid.phase).toBe('dusk');
    expect(mid.darkness).toBeGreaterThan(0.3);
    expect(mid.darkness).toBeLessThan(0.7);
    const a = daylightAt(DAYLIGHT.dayS + 5).darkness;
    const b = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS - 5).darkness;
    expect(a).toBeLessThan(b);
  });
  it('night is fully dark, dawn ramps back down', () => {
    expect(daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS + 1)).toMatchObject({ phase: 'night', darkness: 1 });
    const dawnMid = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS / 2);
    expect(dawnMid.phase).toBe('dawn');
    expect(dawnMid.darkness).toBeGreaterThan(0.3);
    expect(dawnMid.darkness).toBeLessThan(0.7);
  });
  it('wraps across cycles', () => {
    expect(daylightAt(cycleLength() + 10)).toEqual(daylightAt(10));
    expect(daylightAt(3 * cycleLength()).phase).toBe('day');
  });
  it('cycleT spans [0,1)', () => {
    expect(daylightAt(0).cycleT).toBe(0);
    expect(daylightAt(cycleLength() / 2).cycleT).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 3: Run, verify failure**, then **implement** `src/core/daylight.ts`:

```ts
import { DAYLIGHT } from './constants.ts';
import type { DayPhase, DaylightSample } from './types.ts'; // or define locally + export

const smooth = (t: number) => t * t * (3 - 2 * t); // match terrain.ts smoothstep shape

export function cycleLength(): number {
  return DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS;
}

export function daylightAt(t: number): DaylightSample {
  const len = cycleLength();
  const u = ((t % len) + len) % len;
  const cycleT = u / len;
  const d = DAYLIGHT;
  if (u < d.dayS) return { phase: 'day', darkness: 0, cycleT };
  if (u < d.dayS + d.duskS) return { phase: 'dusk', darkness: smooth((u - d.dayS) / d.duskS), cycleT };
  if (u < d.dayS + d.duskS + d.nightS) return { phase: 'night', darkness: 1, cycleT };
  return { phase: 'dawn', darkness: 1 - smooth((u - d.dayS - d.duskS - d.nightS) / d.dawnS), cycleT };
}
```

- [ ] **Step 4: Run tests** — green. **Step 5: Commit** — `git commit -m "feat(core): day/night clock module"`

---

### Task 4: Save v3 — new fields + ground-snap on load

Do this before the visual/system tasks so they each just fill their field.

**Files:**
- Modify: `src/core/save.ts` (SaveV3, decode guards, encode), `src/main.ts:510` (buildSaveState) + load path (~L421-500)
- Test: `tests/save.test.ts`

**Interfaces:**
- Produces: `SaveV3` (rename or extend `SaveV2` — follow the file's existing style; the exported interface other files import must end up named consistently, update importers):
```ts
export interface SaveV3 { v: 3; /* all SaveV2 fields, plus: */
  daylightT?: number;        // world-clock seconds into the day/night cycle
  elves?: number;            // purified-elf count (castle residents)
  castlePurified?: boolean;  // permanent transformation flag
}
```
- Tasks 5/13/14 read+write these via `buildSaveState()`/load.

- [ ] **Step 1: Write failing tests**

```ts
// tests/save.test.ts — add:
it('v2 saves load as v3 with castle fields defaulted', () => {
  const v2json = encodeSave(makeSaveV2Fixture());          // fixture still emits v:2? if encode now emits 3, hand-build a v:2 JSON string
  const s = decodeSave(v2json)!;
  expect(s.v).toBe(3);
  expect(s.daylightT ?? 0).toBe(0);
  expect(s.castlePurified ?? false).toBe(false);
  expect(s.elves ?? 0).toBe(0);
});
it('v3 castle fields round-trip', () => {
  const st = { ...makeSaveFixture(), daylightT: 123.5, elves: 4, castlePurified: true };
  const s = decodeSave(encodeSave(st))!;
  expect(s.daylightT).toBe(123.5); expect(s.elves).toBe(4); expect(s.castlePurified).toBe(true);
});
it('rejects garbage castle fields', () => {
  const j = JSON.parse(encodeSave(makeSaveFixture()));
  j.elves = 'many'; j.daylightT = null; j.castlePurified = 1;
  const s = decodeSave(JSON.stringify(j))!;
  expect(s.elves ?? 0).toBe(0); expect(s.daylightT ?? 0).toBe(0); expect(s.castlePurified ?? false).toBe(false);
});
```
Build a **literal v:2 JSON fixture string** for the migration test (don't rely on encodeSave emitting v2 after this task).

- [ ] **Step 2: Implement**
  1. Version guard `save.ts:261`: accept `o.v !== 1 && o.v !== 2 && o.v !== 3 → null`; normalize output to `v: 3`.
  2. New optional fields: number/boolean guards, "only surface when present" emit convention (`save.ts:365-375`).
  3. `main.ts` `buildSaveState()` L510: add `daylightT: worldClock` (Task 5 introduces the clock variable — for now emit `daylightT: 0` wired to a placeholder-free local `let daylightT = 0` at module scope that Task 5 takes over; simplest: add the field in Task 5 instead and keep this task purely core/save.ts + tests. Choose that: **buildSaveState untouched here**).
  4. **Ground-snap on load** (`main.ts` load path ~L455 where `player.pos` is restored): after computing the restored position, snap:
```ts
const gy = heightAt(sp.x, sp.z);
if (Math.abs(sp.y - gy) > 3) sp.y = gy + 0.5;  // terrain reshaped under an old save
```
Add a pure helper `export function snapToGround(pos: Vec3, groundY: number, tolerance = 3): Vec3` in `save.ts` with a unit test (returns same object shape, snapped y), and call it from main.ts — keeps the logic testable.

- [ ] **Step 3: Run tests** — `npm test` green, `npx tsc --noEmit`.
- [ ] **Step 4: Commit** — `git commit -m "feat(save): v3 with daylight clock, elves, castlePurified + ground-snap"`

---

### Task 5: Night visuals — environment/lighting daylight application + HUD indicator + persistence

**Files:**
- Modify: `src/world/environment.ts` (dynamic daylight), `src/world/lighting.ts` (ShadowRig intensity), `src/main.ts` (clock, wiring, save/load daylightT, debug handle), `src/debug.ts` (setTimeOfDay), `src/ui/hud.ts` (day/night arc indicator + HudFrame field)
- Test: `tests/environment-daylight.test.ts` (new, pure lerp math), `tests/hud.test.ts` if it covers HudFrame typing

**Interfaces:**
- Consumes: `daylightAt` (Task 3), `SaveV3.daylightT` (Task 4).
- Produces:
```ts
// environment.ts additions:
export interface DaylightRig { update(sample: DaylightSample): void }
export function setupDaylight(scene: THREE.Scene): DaylightRig;  // call once after setupEnvironment
// pure + exported for tests:
export function lerpColorHex(a: number, b: number, t: number): number;
// lighting.ts addition:
class ShadowRig { setSunScale(f: number): void }  // scales baseIntensity distribution across cascades
// main.ts: let worldClock = <restored daylightT>; worldClock += dt each unpaused sim step (NOT scaled beyond timeScale, which already scales dt)
// debug.ts GameDebugHandle addition:
setTimeOfDay(phase: 'day'|'dusk'|'night'|'dawn' | number): void  // number = darkness-position seconds into cycle; phase names jump to phase start
// HudFrame addition: dayCycleT: number (0..1) — HUD draws a small sun/moon arc
```

- [ ] **Step 1: Write failing tests (pure parts)**

```ts
// tests/environment-daylight.test.ts
import { lerpColorHex } from '../src/world/environment.ts';
it('lerps color channels independently', () => {
  expect(lerpColorHex(0x000000, 0xffffff, 0)).toBe(0x000000);
  expect(lerpColorHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
  expect(lerpColorHex(0xff0000, 0x0000ff, 0.5)).toBe(0x7f007f);
});
```
(If importing environment.ts pulls `three` into a jsdom-less vitest run and fails, put `lerpColorHex` in `src/core/daylight.ts` instead and import from there — check how existing tests handle modules that import three; `tests/models.test.ts` imports three-heavy modules already, so importing should be fine.)

- [ ] **Step 2: Implement `setupDaylight` in environment.ts**
  - Grab by name: `'sunLight'`, `'hemiLight'`, `'skyDome'`; keep the dome's original day vertex colours (clone the `color` attribute array once).
  - Build once, parented under the sky dome like the sun sprites (`makeSunSprite` L65 pattern):
    - moon: one sprite at `normalize({x: -ENV.sunPos.x, y: ENV.sunPos.y * 0.9, z: -ENV.sunPos.z}) * skyRadius * 0.92`, color `DAYLIGHT.night.moonColor`, size `moonSize`, start alpha 0.
    - stars: `THREE.Points` — `DAYLIGHT.night.starCount` deterministic points (use `mulberry32(WORLD_SEED ^ 0x57a75)` from `src/core/rng.ts`) on the upper hemisphere at radius `skyRadius * 0.95`, `PointsMaterial({ size: starSize, transparent: true, opacity: 0, depthWrite: false, fog: false })`.
  - `update(sample)`: let `k = sample.darkness`, `N = DAYLIGHT.night`:
    - sun.intensity = lerp(ENV.sunIntensity, N.sunIntensity, k) — **route through `shadowRig.setSunScale(lerp(1, N.sunIntensity / ENV.sunIntensity, k))`** so cascade shares stay correct (see step 3); sun.color lerp `ENV.sunColor → N.sunColor`.
    - hemi.intensity = lerp(ENV.hemiIntensity, N.hemiIntensity, k).
    - fog color/near/far lerp to `N.fog*`; `scene.background` follows fog color.
    - sky dome: rewrite the `color` attribute each time `k` changed by > 0.01 since last write (cheap guard; 32×16 sphere ≈ 561 verts): each vertex = lerp(dayColor[i], nightStop[i], k) where night stops mirror the 3-stop day gradient using `N.skyTop/skyMid/skyHorizon`. Mark `needsUpdate`.
    - sun disc/glow sprite alphas ×(1−k); moon alpha = k × 0.95; stars opacity = k.
  - `DaylightRig.update` is cheap when nothing changed: early-return if `|k - lastK| < 0.005` and phase unchanged.

- [ ] **Step 3: ShadowRig.setSunScale (lighting.ts)** — store `sunScale = 1`; multiply everywhere `baseIntensity` is currently asserted (L126 capture stays; apply at L158/L171/L177 and in a new `applyScale()` invoked from `setSunScale`) so `sun.intensity = baseIntensity * share * sunScale` per cascade and total. Add a unit test if `tests/lighting.test.ts` exists (planShadows is pure-tested there) asserting a `ShadowPlan`-independent behavior is NOT required — visual-only; skip the test if the class needs a real scene.

- [ ] **Step 4: main.ts wiring**
  - `let worldClock = loaded?.daylightT ?? 0;` near boot; in `update()` right after `worldTime += dt` (L895): `if (!paused && !debugFrozen) worldClock += dt;`
  - After `setupEnvironment(scene)` (L145): `const daylight = setupDaylight(scene);` then per-frame in `render()` before shadow follow: `daylight.update(daylightAt(worldClock));`
  - `buildSaveState()` L510: add `daylightT: worldClock`.
  - `debug.ts`: add `setTimeOfDay` to `GameDebugHandle` + `DebugDeps` (a setter callback `setWorldClock(t: number)` and phase-start offsets computed from `DAYLIGHT`). Phase names map: day→0, dusk→dayS, night→dayS+duskS, dawn→dayS+duskS+nightS.
  - HUD: add `dayCycleT` to `HudFrame` + the `hudUi.update({...})` call site (main.ts:1084). In hud.ts draw a 60px-wide arc widget top-right (DOM: a rounded track div + a 12px dot positioned by `cycleT`, sun-coloured when darkness<0.5 else moon-coloured — expose darkness too or compute class from cycleT thresholds; simplest: pass `dayDarkness` as a second new HudFrame field). CSS in `STYLE`.

- [ ] **Step 5: Verify** — `npm test`, `npx tsc --noEmit`. Then `npm run dev`, in console: `__game.setTimeOfDay('night')` → sky goes dark, stars + moon visible, sun dim; `setTimeOfDay('day')` restores; dusk transition smooth via `__game.setTimeScale(8)`.
- [ ] **Step 6: Commit** — `git commit -m "feat(world): day/night cycle visuals, HUD day arc, persisted clock"`

---

### Task 6: Player HP (pure module + HUD bar)

No damage sources exist yet — goblins (Task 11) will be the only one.

**Files:**
- Create: `src/player/health.ts`
- Modify: `src/core/constants.ts` (HEALTH block), `src/ui/hud.ts` (HP bar, clone of stamina bar at hud.ts:107-135/213-217/343-366/755-782), `src/main.ts` (own the state, pass to HUD)
- Test: `tests/health.test.ts` (new)

**Interfaces:**
- Produces (consumed by Task 11):
```ts
export interface HealthState { hp: number; sinceHit: number; dazedFor: number }
export function createHealth(): HealthState;                      // { hp: HEALTH.max, sinceHit: Infinity, dazedFor: 0 }
export function applyHit(h: HealthState, dmg: number): HealthState; // pure; hp floor 0; hitting 0 sets dazedFor = HEALTH.dazedS
export function stepHealth(h: HealthState, dt: number): HealthState; // regen after HEALTH.regenDelayS at HEALTH.regenPerS; ticks dazedFor down; when daze ends → hp = HEALTH.max
export function isDazed(h: HealthState): boolean;
```
Constants:
```ts
export const HEALTH = {
  max: 100, regenDelayS: 4, regenPerS: 12,
  dazedS: 3, /** m the dazed stumble carries the player away from the castle */ dazedRetreat: 16,
  /** HP bar auto-hides this long after reaching full (s). */ barLingerS: 2,
} as const;
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/health.test.ts
import { createHealth, applyHit, stepHealth, isDazed } from '../src/player/health.ts';
import { HEALTH } from '../src/core/constants.ts';

it('starts full and undazed', () => {
  const h = createHealth();
  expect(h.hp).toBe(HEALTH.max); expect(isDazed(h)).toBe(false);
});
it('hits subtract and reset regen delay', () => {
  let h = applyHit(createHealth(), 25);
  expect(h.hp).toBe(HEALTH.max - 25);
  h = stepHealth(h, HEALTH.regenDelayS - 0.1);
  expect(h.hp).toBe(HEALTH.max - 25);            // still waiting
  h = stepHealth(h, 1.1);                         // past delay, 1s of regen
  expect(h.hp).toBeGreaterThan(HEALTH.max - 25);
  expect(h.hp).toBeLessThanOrEqual(HEALTH.max);
});
it('regen clamps at max', () => {
  let h = applyHit(createHealth(), 5);
  h = stepHealth(h, HEALTH.regenDelayS + 100);
  expect(h.hp).toBe(HEALTH.max);
});
it('reaching 0 triggers daze; daze end refills to full', () => {
  let h = applyHit(createHealth(), HEALTH.max);
  expect(h.hp).toBe(0); expect(isDazed(h)).toBe(true);
  h = stepHealth(h, HEALTH.dazedS / 2);
  expect(isDazed(h)).toBe(true);
  h = stepHealth(h, HEALTH.dazedS);                // daze over
  expect(isDazed(h)).toBe(false); expect(h.hp).toBe(HEALTH.max);
});
it('hits during daze are ignored', () => {
  let h = applyHit(createHealth(), HEALTH.max);
  const before = h;
  h = applyHit(h, 25);
  expect(h).toEqual(before);
});
```

- [ ] **Step 2: Run→fail, implement** (pure, ~40 lines, no three import).
- [ ] **Step 3: HUD HP bar** — clone the stamina bar pattern 1:1 (fields hud.ts:107-108/133-135; construct 213-217; `paintHealth(hp: number, dazed: boolean)` like 343-366; CSS near 755-782, position it `bottom: 118px` so it stacks above stamina; red fill `#e0463a`, `wt-dazed` flash class reusing `@keyframes wt-flash`). Add `hp: number` and `dazed: boolean` to `HudFrame` + update call. **Visibility rule:** show when `hp < HEALTH.max` or dazed; hide `HEALTH.barLingerS` after full (mirror `staminaFullSince`).
- [ ] **Step 4: main.ts** — `let health = createHealth();` step it in `update()` when `!paused`: `health = stepHealth(health, dt);` pass to HUD. (Damage/daze movement arrive in Task 11.)
- [ ] **Step 5: Run** — `npm test`, `npx tsc --noEmit`; dev-server sanity: no HP bar visible at full health.
- [ ] **Step 6: Commit** — `git commit -m "feat(player): HP state module + HUD bar"`

---

### Task 7: World grandeur rescale

Kids' feedback: world reads small. Trees currently ≈3–7 m; make tiers up to 20–28 m giants; crags ~2× taller; mesas bigger. Castle scale comes in Task 8.

**Files:**
- Modify: `src/core/constants.ts` (`TERRAIN.baseFrequency`, `TERRAIN.cragSpire`, `SCATTER.scale`, `SCATTER.caps`, new `SCATTER.treeTiers`), `src/world/scatter.ts` (tiered tree scale roll + grapple-top × scale), `tests/scatter.test.ts`, `tests/terrain.test.ts` (expectation updates)
- Test: `tests/scatter.test.ts`

**Interfaces:**
- Produces: `SCATTER.treeTiers` consumed only inside scatter.ts:
```ts
/** Tree size tiers: cumulative probability → uniform scale band. Base tree geometry ≈ 4 m tall at scale 1. */
treeTiers: [
  { p: 0.68, scale: [1.1, 2.2] },   // common ≈ 4.5–9 m
  { p: 0.95, scale: [2.4, 4.0] },   // tall   ≈ 10–16 m
  { p: 1.0,  scale: [5.0, 7.0] },   // giants ≈ 20–28 m (10–15× player)
],
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/scatter.test.ts — add:
it('tree scales follow the three tiers and giants are rare', () => {
  let giants = 0, total = 0;
  for (let cx = -20; cx < 20; cx++) for (let cz = -20; cz < 20; cz++) {
    for (const p of scatterForChunk(cx, cz)) {
      if (p.kind !== 'tree') continue;
      total++;
      expect(p.scale).toBeGreaterThanOrEqual(SCATTER.treeTiers[0].scale[0]);
      expect(p.scale).toBeLessThanOrEqual(SCATTER.treeTiers[2].scale[1]);
      if (p.scale >= SCATTER.treeTiers[2].scale[0]) giants++;
    }
  }
  expect(total).toBeGreaterThan(200);
  expect(giants / total).toBeGreaterThan(0.01);
  expect(giants / total).toBeLessThan(0.12);
});
it('tree grapple collider tops scale with instance scale', () => {
  const giant = { kind: 'tree', x: 0, z: 0, y: 5, scale: 6, rot: 0 } as PropPlacement;
  const c = placementGrappleCollider(giant)!;
  expect(c.yTop - 5).toBeCloseTo(4.5 * 6, 1);   // GRAPPLE_TOP.tree × scale
});
```
First **read** `scatter.ts:291` (`placementGrappleCollider`) — if yTop already multiplies by scale, keep the test as regression; if not, that's the bug this task fixes (giants must be climbable to their crowns).

- [ ] **Step 2: Implement**
  1. `constants.ts`: `TERRAIN.baseFrequency: 1/260 → 1/340` (features ~30% broader); `TERRAIN.cragSpire: 55 → 100`; `SCATTER.scale.mesa: [0.8,1.5] → [1.6,3.0]`; `SCATTER.scale.boulder: [0.7,1.4] → [1.0,2.0]`; `SCATTER.caps.tree: 24 → 16`; add `treeTiers` (above); **delete** `SCATTER.scale.tree` (replaced by tiers) and fix all references.
  2. `scatter.ts`: where tree scale is rolled from `SCATTER.scale.tree`, replace with a tier roll (one extra hash channel: first roll picks tier by cumulative `p`, second rolls uniform within the tier band).
  3. Grapple/obstacle: ensure both `placementGrappleCollider` yTop and `placementObstacle` radius multiply by `p.scale` (obstacle radius already does per constants comment; verify).
  4. `tests/terrain.test.ts`: existing height expectations will shift — update the literal expectations after eyeballing that new values are sane (crag peaks should now reach roughly 80–110 m; add an assertion `heightAt` at a known crag sample > 70).
  5. Check knock-ons: village `findVillageCenter` still finds meadow flat ground (run `npm test -- village layout`); `AI.flyHeightMin/Max` unchanged (fine); `ENV.shadowFrustum`/fog unchanged.

- [ ] **Step 3: Run everything** — `npm test`, `npx tsc --noEmit`. Expect a handful of literal-expectation updates in terrain/scatter/village tests; update only values whose change is explained by the constants above — investigate anything else.
- [ ] **Step 4: Visual check** — dev server, fly the biome tour coordinates from `e2e/verify.mjs` `checkBiomeTour` (L947): giants visible in forest, crags dramatically taller, no floating/buried props (props sample heightAt at placement so they follow automatically).
- [ ] **Step 5: Commit** — `git commit -m "feat(world): grandeur rescale — tiered giant trees, taller crags, bigger mesas"`

---

### Task 8: Castle site, terrain pad, and pure layout

**Files:**
- Create: `src/castle/layout.ts` (pure — no three)
- Modify: `src/world/terrain.ts` (pad blend in heightAt), `src/core/constants.ts` (CASTLE block)
- Test: `tests/castle-layout.test.ts` (new), `tests/terrain.test.ts` (pad tests)

**Interfaces:**
- Produces (consumed by Tasks 9–14):
```ts
// constants.ts
export const CASTLE = {
  /** World position of the castle courtyard centre (chosen on a highland hill, NW lobe). */
  center: { x: 0, z: 0 },        // ← replace with the site-picker result in Step 1
  /** heightAt() is flattened to padHeight inside padRadius, blending back over padBlend. */
  padHeight: 0,                   // ← heightAt(center) BEFORE the pad exists, from the site picker
  padRadius: 80, padBlend: 45,
  /** Footprint half-width of the square curtain wall (m). */ half: 45,
  wallH: 8, wallT: 2.4, towerH: 18, towerR: 5, keepH: 20, keepHalf: 10,
  gateW: 9, gateH: 7,
  /** Gargoyle perch pads: computed from geometry, this many total. */ perchCount: 6,
  /** Goblins stay within this radius of center. */ regionR: 130,
  /** Mushroom clusters scattered along the approach. */ approachMushrooms: 10, approachR: [90, 180],
} as const;

// src/castle/layout.ts
export interface CastleLayout {
  center: Point2;
  towers: { x: number; z: number; r: number; h: number }[];   // 4
  walls: { x1: number; z1: number; x2: number; z2: number; h: number; t: number }[]; // 4 (gate gap in south wall)
  keep: { x: number; z: number; half: number; h: number };
  gate: { x: number; z: number; w: number };
  crystalPos: Vec3;                                            // keep centre, y = padHeight + 1.2
  perches: Vec3[];                                             // CASTLE.perchCount, on tower tops + keep corners
}
export function castleLayout(): CastleLayout;                  // memoised, deterministic
export function castleObstacles(): Obstacle[];                 // circles approximating towers/wall segments/keep
export function castleGrappleColliders(): GrappleCollider[];   // towers, keep, wall segments (climbable)
export function inCastleRegion(x: number, z: number): boolean; // dist to center <= CASTLE.regionR
```
- Consumes: `Obstacle` (`src/player/collision.ts`), `GrappleCollider` (`src/player/grapple.ts:36`), `Point2` (define locally or reuse village's).

- [ ] **Step 1: Pick the site** — write a throwaway node script in the scratchpad (NOT the repo) that imports `heightAt` (pre-pad) via vite-node or a small vitest `it.only`, scans ring r ∈ [420, 620] from origin, angle within `-3π/4 ± 0.5` (highlands lobe), step 10 m, and prints the max-height point and its height. Run it, then write the winning `{x, z}` into `CASTLE.center` and its height into `CASTLE.padHeight` (round to 0.1). Delete the scratch script. Record both numbers in the commit message.

- [ ] **Step 2: Write failing terrain-pad tests**

```ts
// tests/terrain.test.ts — add:
it('castle pad is flat inside padRadius and blends smoothly outside', () => {
  const c = CASTLE.center;
  expect(heightAt(c.x, c.z)).toBeCloseTo(CASTLE.padHeight, 3);
  expect(heightAt(c.x + CASTLE.padRadius * 0.7, c.z)).toBeCloseTo(CASTLE.padHeight, 3);
  const rim = heightAt(c.x + CASTLE.padRadius + CASTLE.padBlend + 30, c.z);
  expect(Math.abs(rim - CASTLE.padHeight)).toBeGreaterThan(0.01); // untouched terrain beyond blend
  // monotone-ish blend: no cliff at the rim
  const a = heightAt(c.x + CASTLE.padRadius + 5, c.z);
  const b = heightAt(c.x + CASTLE.padRadius + CASTLE.padBlend - 5, c.z);
  expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
});
```

- [ ] **Step 3: Implement the pad in `heightAt`** (terrain.ts, end of pipeline just before return, mirroring the coast-falloff style):
```ts
// Castle pad: flatten to CASTLE.padHeight inside padRadius, smootherstep back over padBlend.
const cdx = x - CASTLE.center.x, cdz = z - CASTLE.center.z;
const cd2 = cdx * cdx + cdz * cdz;
const padOuter = CASTLE.padRadius + CASTLE.padBlend;
if (cd2 < padOuter * padOuter) {
  const d = Math.sqrt(cd2);
  const w = 1 - smootherstep((d - CASTLE.padRadius) / CASTLE.padBlend); // 1 inside, 0 at outer
  h = h + (CASTLE.padHeight - h) * Math.min(1, Math.max(0, w));
}
```
Cheap: one sqrt inside the bounding circle only.

- [ ] **Step 4: Write failing layout tests, then implement `src/castle/layout.ts`**

```ts
// tests/castle-layout.test.ts
it('layout is deterministic with 4 towers, 4 walls, gate in the south wall', () => {
  const a = castleLayout(), b = castleLayout();
  expect(a).toBe(b);                       // memoised
  expect(a.towers).toHaveLength(4);
  expect(a.walls).toHaveLength(4);
  expect(a.keep.h).toBe(CASTLE.keepH);
  expect(a.crystalPos.y).toBeCloseTo(CASTLE.padHeight + 1.2);
});
it('perches sit on tower tops', () => {
  const l = castleLayout();
  expect(l.perches).toHaveLength(CASTLE.perchCount);
  for (const p of l.perches) expect(p.y).toBeGreaterThanOrEqual(CASTLE.padHeight + CASTLE.wallH);
});
it('grapple colliders cover towers to their tops', () => {
  const cols = castleGrappleColliders();
  const towerCol = cols.find(c => c.yTop >= CASTLE.padHeight + CASTLE.towerH - 0.5);
  expect(towerCol).toBeDefined();
});
it('region query', () => {
  expect(inCastleRegion(CASTLE.center.x, CASTLE.center.z)).toBe(true);
  expect(inCastleRegion(CASTLE.center.x + CASTLE.regionR + 1, CASTLE.center.z)).toBe(false);
});
```
Implementation: towers at the 4 corners `(±half, ±half)`; walls connect them, south wall split around the gate; perches = 4 tower tops + 2 keep corners, `y = padHeight + towerH` / `padHeight + keepH`. Wall grapple colliders: approximate each wall as 3–4 circle colliders (`GrappleCollider` is cylindrical) spaced along its length, r = wallT × 1.5, yTop = padHeight + wallH. Obstacles similar circles at r = wallT.

- [ ] **Step 5: Run all tests** (`npm test`) — village/terrain/scatter must still pass (pad is far from Haven).
- [ ] **Step 6: Commit** — `git commit -m "feat(castle): site pick, terrain pad, pure layout + colliders (center X,Z / padHeight H)"`

---

### Task 9: Castle builders + world wiring (+ approach mushrooms, ?debug=castle)

**Files:**
- Create: `src/castle/builders.ts` (three.js — cursed AND purified dressings)
- Modify: `src/main.ts` (build castle, concat obstacles/grapple colliders, debug camera), `src/world/scatter.ts` (approach mushrooms), `src/core/constants.ts` (castle colors)
- Test: `tests/castle-layout.test.ts` (approach-mushroom determinism if placed via layout), visual verification

**Interfaces:**
- Consumes: `castleLayout()`, `castleObstacles()`, `castleGrappleColliders()` (Task 8); `buildVillage` merge pattern (`src/village/buildings.ts:312` `mergeVillage`).
- Produces:
```ts
// src/castle/builders.ts
export function buildCastle(scene: THREE.Scene, purified: boolean): THREE.Group; // named 'castle'; call again after removing old group to swap dressing
export function removeCastle(scene: THREE.Scene): void;                           // dispose geometries/materials of group 'castle'
```

- [ ] **Step 1: Colors in constants.ts** (extend a new `CASTLE_COLORS` const):
```ts
export const CASTLE_COLORS = {
  cursed:   { stone: 0x4a4652, stoneDark: 0x37343f, roof: 0x2b2833, ember: 0xb4432a, crystal: 0x6e2bb0 },
  purified: { stone: 0xcfc6b4, stoneDark: 0xa89e8a, roof: 0x7fb0d8, ivy: 0x4a8f52, banner: 0xd8608a, lamp: 0xffd9a0 },
} as const;
```
- [ ] **Step 2: Build it** — follow `village/buildings.ts` builder style (Lambert `flatShading`, `box`/cylinder helpers, `mergeVillage`-style merge into few draw calls; copy `mergeVillage` into a shared or local `mergeGroup` helper rather than importing a private). Geometry from `castleLayout()`: wall boxes (h = wallH, t = wallT) with crenellation teeth (small boxes every ~3 m along the top), cylinder towers with cone roofs, keep as a larger crenellated box (open top — no roof), gatehouse arch (two pillars + lintel over the gate gap). Cursed: ember-emissive window slits; purified: ivy strips (thin green boxes on walls), banner planes on towers, warm PointLights at the gate + keep (≤ 6 lights, like village lamps). Everything sits on `y = CASTLE.padHeight`.
- [ ] **Step 3: Wire into main.ts** (near village construction L243): `const castleGroup = buildCastle(scene, /* purified from save */ loaded?.castlePurified ?? false);` and extend the collider lambdas:
  - L924: `player.obstacles = props.getObstacles(...).concat(villageObs).concat(castleObs)` where `const castleObs = castleObstacles()` (memoised, computed once).
  - L276: `player.grappleColliders = (x, z) => props.getGrappleColliders(x, z).concat(castleGrappleColliders());` — castle collider list is small (~20); fine to concat always, or gate on `inCastleRegion(x,z)` with the region padded by 50 m.
- [ ] **Step 4: Approach mushrooms** — in `scatter.ts` `scatterForChunk`, for chunks intersecting the ring `CASTLE.approachR` around `CASTLE.center`, add up to `approachMushrooms`-worth of deterministic mushroom placements (hash-seeded ring positions, skip water/steep). Add a scatter test asserting > 5 mushroom placements exist within the ring across the covering chunks.
- [ ] **Step 5: ?debug=castle** — in main.ts's debug-camera block (`?debug=grapple|structures|village`, ~L1204): add `castle` mode that teleports the player to `CASTLE.center.x, padHeight + 2, CASTLE.center.z + CASTLE.half + 20` facing the gate.
- [ ] **Step 6: Verify** — `npm test` + tsc green. Dev server `?fresh=1&debug=castle`: castle visible and imposing (towers ~18 m — stand next to one), grapple onto a wall top, walk the battlements, no falling through the pad, keep open with clear crystal plinth space. Screenshot for the record.
- [ ] **Step 7: Commit** — `git commit -m "feat(castle): procedural cursed/purified castle, colliders, approach mushrooms, debug cam"`

---

### Task 10: Gargoyle species (perch AI + fixed spawn slots)

**Files:**
- Modify: `src/core/types.ts:112,141` (fleeStyle 'perch', state 'perch'), `src/critters/species.ts` (entry), `src/critters/models.ts` (builder + BUILDERS), `src/critters/ai.ts` (perch behavior), `src/critters/manager.ts` (addFixedSlots), `src/critters/preview.ts:77-81` (grid for 13), `src/ui/guide.ts:29` (FLEE_LABEL), `src/core/constants.ts` (AI perch tuning), `src/main.ts` (register castle slots)
- Test: `tests/ai.test.ts`, `tests/species.test.ts` (12→13 + table row), `tests/models.test.ts` (tri budget covers new builder automatically)

**Interfaces:**
- Consumes: `castleLayout().perches` (Task 8), `SpawnSlot` (`manager.ts:29`).
- Produces:
```ts
// species entry
{ id: 'gargoyle', name: 'Gargoyle', biomes: [], size: 0.9, walkSpeed: 2, fleeSpeed: 8,
  awareness: 14, fleeStyle: 'perch', bold: true, trackRadius: 14, trackTime: 16,
  rarity: 0.3, rewardSparks: 3, rewardRP: 24, rideable: false,
  ringHeight: 1.1, farmRole: { kind: 'aura', auraPct: 20 } }
// biomes: [] → never appears in procedural cell spawns (manager filters by biome inclusion)
// manager addition:
class CritterManager { addFixedSlots(slots: { species: string; home: Vec3; flightHeight: number }[]): void }
// ids assigned from a reserved negative range (-1, -2, ...) so they never collide with cell-slot ids; persist via existing critterPersist keyed on id.
// AI constants addition to AI block:
perchDwellMin: 6, perchDwellMax: 14, perchGlideR: 12, perchGlideSpeed: 5, perchSettleDist: 0.5,
```
- Perch behavior (`ai.ts`): a `'perch'` critter's `home` is its perch point and `flightHeight = home.y - terrainY(home)`. States: `idle` at the perch (sits, y = home.y); `wander` = glide a deterministic loop: pick a target on a circle of `perchGlideR` around home at the same world height, fly-style banking toward it, then return home and re-enter idle (never gains altitude above `home.y + 0.5` — clamp). Flee (tagged, chased): fly-style escape but altitude clamped to `home.y + 0.5`; calm/linked returns home. In `locomote`, treat `perch` like `fly` for obstacle-skip + vertical handling but with the altitude clamp; `stepAllowed` not consulted (airborne).

- [ ] **Step 1: Write failing AI tests**

```ts
// tests/ai.test.ts — add (mirror the file's existing ctx/mkCritter helpers):
it('perch critter idles at its elevated home', () => {
  const home = { x: 0, y: 20, z: 0 };
  let c = mkCritter('gargoyle', home);               // state 'idle', pos = home
  for (let i = 0; i < 120; i++) c = stepAI(c, ctxWithFlatGround(0), 1 / 60);
  expect(c.pos.y).toBeCloseTo(20, 0);                // stays perched, never drops to terrain (y=0)
});
it('perch critter never climbs above its perch while gliding or fleeing', () => {
  const home = { x: 0, y: 20, z: 0 };
  let c = { ...mkCritter('gargoyle', home), tagged: true };
  const ctx = ctxWithPlayerAt({ x: 1, y: 20, z: 1 }); // player adjacent → flee
  let maxY = 0;
  for (let i = 0; i < 600; i++) { c = stepAI(c, ctx, 1 / 60); maxY = Math.max(maxY, c.pos.y); }
  expect(maxY).toBeLessThanOrEqual(20.6);            // free-flight guard
});
```

- [ ] **Step 2: species/tests bookkeeping** — add the entry; update `tests/species.test.ts` count 12→13 and its verbatim table with the gargoyle row; add `perch: 'Perches'` to `FLEE_LABEL` (`guide.ts:29`); bump preview grid (`preview.ts:77-81`) to handle 13 (3 rows or 7 cols — pick 7 cols).
- [ ] **Step 3: implement AI + run tests.**
- [ ] **Step 4: Model** (`models.ts`) — `buildGargoyle(rng)`: crouched plump body (`egg`), big folded bat wings (two flattened `capsule` pairs angled back — put them in `parts.wings` so `animateCritter` flaps them when moving), horned brow (`segmentedHorn` ×2), stone-gray `jitterColor(0x8a8894,...)`, amber `eye` pair (emissive), small `smile`. Register `gargoyle: buildGargoyle` in BUILDERS (models.ts:1411). Stay under the 1200-tri budget (`tests/models.test.ts:26`). Verify look: `?preview=critters&focus=gargoyle`.
- [ ] **Step 5: Fixed slots** — `manager.ts`: `addFixedSlots` appends to the slot list with ids `-1..-n`, always-active treatment identical to procedural slots (they activate by distance like others). Guard: fixed slots skip the water/village drop rules. In `main.ts` after castle build: `critters.addFixedSlots(castleLayout().perches.map(p => ({ species: 'gargoyle', home: p, flightHeight: p.y - heightAt(p.x, p.z) })));`
- [ ] **Step 6: Full suite + manual** — `npm test`, tsc. Dev: `?fresh=1&debug=castle` — gargoyles perched on towers; dart one from a wall top (tracker dart, they're bold so they sit still until tagged), Link it, Bond-Charm it. `?preview=critters` shows 13.
- [ ] **Step 7: Commit** — `git commit -m "feat(critters): gargoyle species with perch AI on castle towers"`

---

### Task 11: Goblins — pure FSM + castle system + combat wiring

**Files:**
- Create: `src/castle/goblins.ts` (pure FSM), `src/castle/system.ts` (CastleSystem: three.js presentation + spawning), goblin model builder in `src/castle/builders.ts`
- Modify: `src/core/constants.ts` (GOBLIN block), `src/main.ts` (wire CastleSystem, damage → health, dazed movement), `src/player/controller.ts` (impulse + input suppression), `src/debug.ts` (spawnGoblin)
- Test: `tests/goblins.test.ts` (new)

**Interfaces:**
- Consumes: `daylightAt` (Task 3), `HealthState`/`applyHit`/`isDazed` (Task 6), `inCastleRegion`/`castleLayout` (Task 8), `GroundQuery`.
- Produces:
```ts
// constants.ts — read MOVE (constants.ts:104) first and set chase below the SPRINT/dash ground speed:
export const GOBLIN = {
  count: 8, patrolSpeed: 1.8, patrolR: 25,
  noticeR: 20, /** MUST stay below the player's sprint speed — asserted in tests. */ chaseSpeed: 0,  // ← set to 0.85 × MOVE sprint speed value
  lungeRange: 2.4, windupS: 0.5, lungeS: 0.35, lungeSpeed: 11, recoverS: 1.2,
  damage: 25, knockback: 7.5, giveUpR: 40,
} as const;

// src/castle/goblins.ts (pure)
export type GoblinPhase = 'patrol'|'alert'|'chase'|'windup'|'lunge'|'recover';
export interface GoblinState { id: number; pos: Vec3; yaw: number; phase: GoblinPhase; phaseT: number; home: Vec3 }
export interface GoblinCtx { playerPos: Vec3; ground: GroundQuery; rand: () => number }
export interface GoblinStep { g: GoblinState; hitPlayer: boolean }
export function makeGoblin(id: number, home: Vec3): GoblinState;
export function stepGoblin(g: GoblinState, ctx: GoblinCtx, dt: number): GoblinStep;
// spawn-position helper (pure, deterministic per night index):
export function goblinSpawnPoints(nightIndex: number, count: number): Vec3[]; // ring positions inside castle region, seeded mulberry32(WORLD_SEED ^ nightIndex)

// src/castle/system.ts
export class CastleSystem {
  constructor(scene: THREE.Scene, ground: GroundQuery, opts: {
    onPlayerHit: (damage: number, fromPos: Vec3) => void;
    purified: () => boolean;                    // reads castlePurified — no spawns when true
  });
  update(dt: number, playerPos: Vec3, sample: DaylightSample): void; // spawn at dusk, despawn at dawn, step goblins, animate
  goblinTargets(): { id: number; pos: Vec3; r: number }[];           // for purifying-dart hit tests (Task 12)
  purifyGoblin(id: number): Vec3 | null;                              // removes goblin, returns its pos (elf spawn point); null if unknown
  goblinCount(): number;
  dispose(): void;
}
```
FSM rules (all tested): patrol wanders around `home` at `patrolSpeed`; → `alert` when player within `noticeR` (0.4 s freeze + face player); → `chase` toward player at `chaseSpeed`; chase → `windup` within `lungeRange`; `windup` (windupS) → `lunge`: fixed-direction hop at `lungeSpeed` for `lungeS`, `hitPlayer = true` on the step where distance ≤ 1.2 during lunge (once per lunge); → `recover` (recoverS) → chase or patrol. Chase → patrol when player beyond `giveUpR` OR outside `inCastleRegion` (goblins never leave the region — clamp position). Ground: `pos.y = ground.heightAt(x,z)` always.

- [ ] **Step 1: Write failing FSM tests**

```ts
// tests/goblins.test.ts (helpers: flatGround = { heightAt: () => 0, normalAt: () => ({x:0,y:1,z:0}) }, seeded rand)
it('chase speed is strictly below player sprint speed', () => {
  // read the sprint constant from MOVE — find its exact field name and assert:
  expect(GOBLIN.chaseSpeed).toBeGreaterThan(0);
  expect(GOBLIN.chaseSpeed).toBeLessThan(SPRINT_SPEED); // ← import the real MOVE field
});
it('patrols until player enters noticeR, then alerts and chases', () => { /* step with player far → phase stays patrol; move player to 15m → eventually 'chase' */ });
it('lunges within range and reports a hit exactly once per lunge', () => { /* park player at 1.0m; run until phase==='lunge'; count hitPlayer===true steps === 1 */ });
it('gives up beyond giveUpR and returns to patrol', () => { ... });
it('never exits the castle region', () => {
  // player outside region baiting the goblin: run 30s of steps, assert inCastleRegion(g.pos.x, g.pos.z) every step
});
it('spawn points are deterministic per night and inside the region', () => {
  expect(goblinSpawnPoints(3, 8)).toEqual(goblinSpawnPoints(3, 8));
  for (const p of goblinSpawnPoints(1, 8)) expect(inCastleRegion(p.x, p.z)).toBe(true);
});
```
Write full test bodies (the comments above describe the scenario each must implement).

- [ ] **Step 2: Run→fail, implement `goblins.ts`** (pure, ~150 lines).
- [ ] **Step 3: Goblin model** in `builders.ts`: `buildGoblin(rng)` — knee-high chunky green body (`egg`), oversized ears (`plumpEar` style — copy helpers or re-implement locally; models.ts helpers are private to critters), tattered hood cone, glowing yellow eyes. Reuse the critters `bakeSubtree` approach OR simple shared Lambert materials (goblin count ≤ 8; per-mesh is fine).
- [ ] **Step 4: `CastleSystem`** — tracks `nightIndex` (increment each dusk transition), spawns `GOBLIN.count` at dusk (skips when `purified()`), removes all at dawn. Per-frame: step FSMs, on `hitPlayer` call `opts.onPlayerHit(GOBLIN.damage, g.pos)`, sync meshes (pos/yaw; simple bob while moving, squash-stretch on lunge — sine on phaseT, no animation system needed).
- [ ] **Step 5: main.ts combat wiring**
  - Construct after castle build: `const castleSys = new CastleSystem(scene, ground, { purified: () => castlePurified, onPlayerHit: (dmg, from) => { if (!isDazed(health)) { health = applyHit(health, dmg); player.applyImpulse(awayFrom(from, player.pos, GOBLIN.knockback)); blip(180, 0.12); } } });` — call `castleSys.update(dt, p, daylightAt(worldClock))` in `update()` after `npcs.update`.
  - `player.applyImpulse(v: Vec3)`: add to `PlayerController` — adds v to the current velocity (read controller.ts first; add to whatever internal velocity field `update` integrates; one-line method + a controller test if `tests/controller.test.ts` exists).
  - **Dazed handling** in `update()`: when `isDazed(health)`, suppress player input for the frame (the controller reads `input` — cleanest: add `player.inputLocked: boolean` consulted in controller's read of move axes) and instead push the player at 4 m/s along `normalize(playerPos - CASTLE.center)` (the stumble-away). Screen dim: reuse the HUD dazed flash + add a full-screen `.wt-daze-veil` div with opacity driven by `dazed` (hud.ts).
  - `debug.ts`: `spawnGoblin(): number` (spawns one at `player.pos + 6 m forward` via CastleSystem regardless of phase — for tests/e2e) and expose `goblinCount()` inside `state()`.
- [ ] **Step 6: Full suite + manual** — `npm test`, tsc. Dev: `?fresh=1&debug=castle`, `__game.setTimeOfDay('night')` → goblins patrol; get close → chased, lunged, HP bar drops, knockback felt; let HP hit 0 → daze veil, stumble out, refill. `setTimeOfDay('day')` → goblins vanish.
- [ ] **Step 7: Commit** — `git commit -m "feat(castle): night goblins with chase/lunge FSM, player damage + dazed retreat"`

---

### Task 12: Elves (`src/castle/elves.ts`)

**Files:**
- Create: `src/castle/elves.ts`
- Modify: `src/castle/builders.ts` (buildElf), `src/core/constants.ts` (ELF block), `src/main.ts` (wire, save/load count)
- Test: `tests/elves.test.ts` (new, pure placement/wander math)

**Interfaces:**
- Consumes: `CASTLE`/`castleLayout` (Task 8), `SaveV3.elves` (Task 4), NPC wander pattern (`src/village/npcs.ts:37,261` — copy the constants shape, do not import).
- Produces:
```ts
export const ELF = { walkSpeed: 1.4, wanderR: 30, danceChance: 0.35, dancePeriod: 2.2, pauseMin: 2, pauseMax: 5 } as const;
// pure, exported for tests:
export function elfHomePosition(index: number): Vec3;   // deterministic ring/spiral around castle center on the pad
// three.js manager:
export class ElfSystem {
  constructor(scene: THREE.Scene, ground: GroundQuery);
  setCount(n: number): void;      // reconcile: spawn/remove to match (load + purify events)
  get count(): number;
  addAt(pos: Vec3): void;         // purify burst: elf appears where the goblin stood, then wanders home-ward
  update(dt: number, playerPos: Vec3): void;
  dispose(): void;
}
```

- [ ] **Step 1: Failing tests** — `elfHomePosition` determinism + spread (`expect(elfHomePosition(3)).toEqual(elfHomePosition(3))`; positions within `CASTLE.regionR`; indices 0–19 pairwise > 2 m apart).
- [ ] **Step 2: Implement** — homes on golden-angle spiral around center (radius 8→wanderR). Wander AI: copy the NpcManager wander/pause state machine shape (npcs.ts:185-318) with per-elf `mulberry32(WORLD_SEED ^ 0xe1f ^ index)`; "dance" = pause state variant that spins + bobs (yaw += dt × 3, y bob sine) rolled with `danceChance`. Model `buildElf(rng)`: small (≈0.9 m) — green tunic capsule, cream face sphere, pointy hat cone, pointy ears, permanent `smile`-style grin (copy geometry approach from village NPC blocky style OR critters plump style — pick plump; elves should look happy/cute).
- [ ] **Step 3: Wire** — main.ts: `const elves = new ElfSystem(scene, ground); elves.setCount(loaded?.elves ?? 0);` update in loop; `buildSaveState()` adds `elves: elves.count`.
- [ ] **Step 4: Suite + manual** (`__game`-less check: temporarily `elves.setCount(5)` via a debug handle — add `__game.setElves(n)` to debug.ts for e2e use too). Commit — `git commit -m "feat(castle): happy elves settle the castle grounds"`

---

### Task 13: Purifying dart firing — hotbar slot 5 + goblin purification

**Files:**
- Create: `src/castle/purifier.ts` (PurifierSystem)
- Modify: `src/player/input.ts:167-179` (Digit5), `src/ui/hud.ts:110-246,393-416` (5th slot + selected getter), `src/ui/screens.ts:376` (help row '1 – 5'), `src/main.ts` (selection-aware LMB + wiring), `src/debug.ts` (grant purifiers already works via `grant`? read `grant(kind)` — extend to accept `'purifiers'`), `src/core/constants.ts` (PURIFIER visual constants)
- Test: `tests/input.test.ts` (Digit5 action), `tests/hud.test.ts` (slot clamp), `tests/purifier.test.ts` (hit logic, pure)

**Interfaces:**
- Consumes: `spawnDart`/`stepDart` + `segPointDist2` pattern (`src/tracking/darts.ts:33,51,65`), `Inventory.purifiers` (Task 2), `CastleSystem.goblinTargets()/purifyGoblin()` (Task 11), `ElfSystem.addAt` (Task 12), crystal target (Task 14 — this task lands the callback interface, Task 14 fills it).
- Produces:
```ts
export const PURIFIER = { color: 0x8ef0c0, burstS: 0.6, burstR: 1.6 } as const;
// pure hit helper, exported for tests (mirrors dartHitCritter):
export function dartHitTarget(d: DartState, targets: { id: number; pos: Vec3; r: number }[]): number | null;
export class PurifierSystem {
  constructor(scene: THREE.Scene, camera: THREE.Camera, inventory: Inventory, ground: GroundQuery, opts: {
    goblinTargets: () => { id: number; pos: Vec3; r: number }[];
    onPurifyGoblin: (id: number) => void;
    crystalTarget: () => { pos: Vec3; r: number; active: boolean } | null;  // null until Task 14
    onPurifyCrystal: () => void;
  });
  tryThrow(): boolean;      // decrements inventory.purifiers; false when 0
  update(dt: number): void; // steps darts, tests goblins THEN crystal, spawns sparkle burst on hit
  dispose(): void;
}
```

- [ ] **Step 1: Failing tests**
```ts
// tests/purifier.test.ts — dartHitTarget: swept hit registers; miss returns null; nearest of two wins.
// tests/input.test.ts — pressing Digit5 yields { type: 'hotbar', slot: 5 }.
// tests/hud.test.ts — selectHotbar(5) selects; selectHotbar(6) ignored (read existing hud tests for the harness; hud.ts:246 clamp must become 1..5).
```
Write real bodies mirroring each file's existing test style.

- [ ] **Step 2: Implement**
  - `input.ts`: add `case 'Digit5'` (copy Digit4 shape).
  - `hud.ts`: 5th slot def `{key:'5', name:'Purify'}`; widen clamp; badge shows `inventory.purifiers` (mirror the Darts badge logic in `paintHotbar` L393-416, incl. `locked[]` — purify slot dims until `unlocks.has('purifier')`); add `get selected(): number` returning the private `selected` field (hud.ts:130).
  - `PurifierSystem`: clone the `DartSystem` shape (darts.ts:122-244) — same `LiveDart` mesh/trail approach, `PURIFIER.color` material; on goblin hit: `opts.onPurifyGoblin(id)` + sparkle burst (a short-lived `THREE.Points` shell of ~40 points expanding to `burstR` over `burstS`, additive, fading) + `blip(1200, 0.08)`; on crystal hit (when `crystalTarget()?.active`): `opts.onPurifyCrystal()`.
  - `main.ts` LMB dispatch (L1052-1060): 
```ts
else if (player.mode !== 'zipline') {
  if (hudUi.selected === 5) purifier.tryThrow(); else darts.tryThrow();
}
```
  - Wire onPurifyGoblin: `const pos = castleSys.purifyGoblin(id); if (pos) { elves.addAt(pos); toast('A goblin becomes a happy elf!'); }` (use the existing toasts module — read `src/ui/toasts.ts` for the call).
  - `debug.ts` `grant`: confirm `grant('purifiers', n)` works (it indexes inventory by kind for known counters — read `debug.ts` grant impl and extend its accepted kinds if it's an allowlist).
- [ ] **Step 3: Suite + manual** — night at castle, craft/grant purifiers, select slot 5, dart a goblin → sparkle → elf dances. Tracker darts still work on slot 1. Commit — `git commit -m "feat(castle): purifying darts turn goblins into elves (hotbar slot 5)"`

---

### Task 14: Dark crystal + permanent transformation

**Files:**
- Modify: `src/castle/system.ts` (crystal mesh/pulse, purify sequence, transformation), `src/castle/builders.ts` (crystal + rebuild swap), `src/main.ts` (castlePurified state, save, ambient), `src/debug.ts` (purifyCrystal)
- Test: `tests/castle-state.test.ts` (new, pure sequence logic)

**Interfaces:**
- Consumes: everything above; `buildCastle/removeCastle` (Task 9), `SaveV3.castlePurified` (Task 4).
- Produces:
```ts
// pure, in src/castle/system.ts or a small src/castle/state.ts:
export interface CastleWorldState { purified: boolean; nightIndex: number }
export function purifySequenceSteps(goblinPositions: Vec3[]): { elfSpawns: Vec3[] }  // trivial but keeps the burst testable
// CastleSystem additions:
crystalTarget(): { pos: Vec3; r: number; active: boolean };  // active = !purified; r = 1.4
purifyCastle(): void;   // full sequence (idempotent)
```
Sequence in `purifyCastle()`: flash (white full-screen veil fading 0.5 s — reuse the daze veil div with a different class), expanding sparkle ring (scaled-up purifier burst at crystal pos, r → 60 over 1.5 s), every live goblin → `elves.addAt(goblinPos)`, `removeCastle(scene)` + `buildCastle(scene, true)`, crystal mesh swaps to bright cyan gentle pulse, `castlePurified = true` (main.ts owns the flag via a callback `onPurified`), toast "The castle is purified! ✨".

- [ ] **Step 1: Failing tests** — `purifySequenceSteps` maps N goblin positions → N elf spawns; `CastleSystem` skip-spawn when purified is already covered by Task 11's `purified()` — add a state test: after purify, `nightIndex` dusk transitions spawn 0 goblins (test the pure decision function you extract for "should spawn this dusk": `shouldSpawnGoblins(purified: boolean, phase: DayPhase): boolean` — false when purified or phase !== 'dusk').
- [ ] **Step 2: Implement** — crystal mesh: dark `crystal()`-style octahedron (2 stacked cones) on a stone plinth at `castleLayout().crystalPos`, emissive pulse `0.4 + 0.3·sin(2t)`; purified variant: `CASTLE_COLORS.purified.roof` colour, slow pulse. Wire `crystalTarget` into the `PurifierSystem` opts (replace the `null` stub from Task 13). main.ts: `let castlePurified = loaded?.castlePurified ?? false;` — `onPurified` sets it; `buildSaveState()` emits it; initial `buildCastle(scene, castlePurified)` already lands from Task 9.
- [ ] **Step 3: debug** — `__game.purifyCrystal()` → `castleSys.purifyCastle()`.
- [ ] **Step 4: Suite + manual full arc** — fresh save, `?debug=castle`: day castle cursed; night → goblins; purify 2 goblins → 2 elves; grapple into the keep, dart the crystal → flash, burst, remaining goblins become elves, castle rebuilds bright, banners visible; `setTimeOfDay('night')` → no goblins, elves dancing; reload page → still purified (save round-trip). Commit — `git commit -m "feat(castle): dark crystal purification permanently transforms castle into elf city"`

---

### Task 15: e2e verification + final polish pass

**Files:**
- Modify: `e2e/verify.mjs` (new checks), `FOLLOWUPS.md` (anything deferred), refresh `docs/verify/` screenshots
- Test: the e2e run itself

- [ ] **Step 1: New checks** (follow the `check('<letter>. <title>')` idiom, verify.mjs:139/295; next screenshot numbers continue from `21`):
  - `checkDayNight`: open `?fresh=1`, `setTimeOfDay('night')`, sleep 1200, shot `22-night.png`, assert luminance stddev > 2 AND mean luminance well below the day boot shot (compute mean from `decodePNG` — add a `meanLuminance` helper beside `luminanceStdDev` L275); `setTimeOfDay('day')` restores brightness.
  - `checkCastle`: `?fresh=1&debug=castle` (or teleport pattern from `checkVillage` L770), shot `23-castle-day.png`; assert `state()` shows castle debug fields OR simply assert page has no errors + gargoyle present: `__game.listCritters()` contains a `gargoyle` within 150 m.
  - `checkGoblinsAndHp`: teleport to castle, `setTimeOfDay('night')`, poll `state().goblinCount > 0` (expose via Task 11), `__game.spawnGoblin()` next to player, poll until `state().hp < 100` (expose `hp` in `state()` — add in Task 11's debug work if missed, else here), shot `24-goblins-night.png`.
  - `checkPurifyArc`: `grant('purifiers', 5)` … but simpler and robust: `__game.purifyCrystal()`, poll `state().castlePurified === true` (expose), `setTimeOfDay('day')`, teleport castle, shot `25-elf-city.png`; reload → `state().castlePurified` still true (mirror `checkSaveRoundtrip` L551 reload pattern).
  - Refresh biome-tour screenshots (`11`–`15`) — rescale changed them; just rerun, they overwrite.
  - Register all in `main()` (verify.mjs:988-1004).
- [ ] **Step 2: Run the full gauntlet** — `npm test` (target: all green, ~530+ tests), `npx tsc --noEmit`, `npm run build`, then `PLAYWRIGHT_DIR=<scratchpad playwright install> node e2e/verify.mjs` → all checks pass. Playwright is deliberately not a repo dep: install it in the scratchpad (`cd <scratchpad> && npm i playwright && npx playwright install chromium`).
- [ ] **Step 3: Playtest-tuning sweep** — dev server, play the loop start to finish at 1× time scale. Tune ONLY in constants.ts: goblin chase feel (escapable but scary), dusk length, purifier cost, giant-tree frequency, castle mushroom supply. Note anything deferred in FOLLOWUPS.md.
- [ ] **Step 4: Commit** — `git commit -m "test(e2e): day/night, castle, goblin, purify-arc checks + screenshot refresh"`

---

## Self-Review Notes (already applied)

- Spec §1–§9 each map to tasks: castle §1→8/9, day/night §2→3/5, gargoyles §3→10, goblins+HP §4→6/11, darts+elves §5→1/2/12/13, crystal §6→14, rescale §7→7, save §8→4, testing §9→15 + per-task tests.
- Perch "glide between perches" is implemented as glide-loops around each gargoyle's own perch (pure per-critter AI has no shared perch registry) — visually equivalent; noted as an accepted spec adaptation.
- Task 11 leaves `GOBLIN.chaseSpeed` as a formula against the real MOVE sprint constant because MOVE's field name must be read from constants.ts:104 — the test asserting `chaseSpeed < sprint` makes this safe.
- Type/name consistency: `Inventory.purifiers`, `grants: 'purifiers'`, `hudUi.selected`, `CastleSystem.goblinTargets/purifyGoblin/crystalTarget/purifyCastle`, `ElfSystem.setCount/addAt/count`, `daylightAt/DaylightSample`, `HealthState/applyHit/stepHealth/isDazed`, `castleLayout/castleObstacles/castleGrappleColliders/inCastleRegion` — used identically across tasks.
