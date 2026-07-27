# Castle Ward Maze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the castle to a 180×180 m walled town whose interior is a hand-authored maze of tight corridors, 3 plazas, and 2 torchlit roofed halls guarding the keep.

**Architecture:** A hand-authored 36×36 ASCII tile map (`src/castle/wardMap.ts`) is parsed by a pure module (`src/castle/ward.ts`) into wall runs, plaza/hall regions, goblin zones, and a spatial-hash collision index. Existing castle builders stamp the geometry (both cursed/purified dressings); movement gains an "under a roof → no grapple/glider" rule; goblins get zone homes and elves move to the plazas.

**Tech Stack:** Three.js + Vite + TypeScript, Vitest (`npm test`), Playwright e2e (`node e2e/verify.mjs`, resolved via PLAYWRIGHT_DIR or repo node_modules).

**Spec:** `docs/superpowers/specs/2026-07-27-castle-ward-design.md` — read it before starting any task.

## Global Constraints

- Branch `feat/castle-ward` (off `build/fidelity-2`). Commit per task, conventional commits, no push.
- ALL tuning constants in `src/core/constants.ts`; the ward map itself is authored content in `src/castle/wardMap.ts`.
- `heightAt(x,z)` is the only ground truth; nothing raycasts meshes; no standing on hall roofs.
- Pure modules (`ward.ts`, `wardMap.ts`, goblins/elves logic) never import `three`.
- Free flight stays impossible: hall roofs are grapple-transparent BUT grapple/glider are suppressed while inside a hall.
- Gates after every task: `npm test` all green AND `npx tsc --noEmit` clean.
- Cell size 5 m; map 36×36 spanning x,z ∈ [center−90, center+90). World coords: `worldX = CASTLE.center.x + (col − 18 + 0.5) * 5`, same for z with rows.

---

### Task 1: Ward map + parser (pure)

**Files:**
- Create: `src/castle/wardMap.ts` (the authored map), `src/castle/ward.ts` (parser + queries)
- Modify: `src/core/constants.ts` (WARD block)
- Test: `tests/ward.test.ts` (new)

**Interfaces:**
- Consumes: `CASTLE.center` (constants.ts), `Point2` (src/castle/layout.ts:21).
- Produces (used by Tasks 2–6):
```ts
// constants.ts
export const WARD = {
  cellSize: 5, cols: 36, rows: 36,
  wallH: 5.5, wallT: 1.2, hallH: 7, hallRoofRise: 1.5,
  /** Spatial-hash bucket size (m) for near-queries. */ hashCell: 15,
} as const;

// src/castle/wardMap.ts
export const WARD_MAP: readonly string[];   // 36 strings × 36 chars; legend: # . P H K G T

// src/castle/ward.ts
export interface WardLayout {
  wallRuns: { x1: number; z1: number; x2: number; z2: number }[]; // world coords, merged straight runs
  plazas: { cells: Point2[]; center: Point2 }[];                  // 3 (cells in world coords of cell centers)
  halls: { cells: Point2[]; center: Point2; entrances: Point2[] }[]; // 2, entrances = open cells adjacent to hall interior through a gap in its perimeter
  keep: { center: Point2 };
  zones: Point2[];    // goblin zone homes: plaza centers + corridor junction cells (open cell with ≥3 open orthogonal neighbors, excluding P/H/K cells)
  gate: Point2;       // world position of the G cell
}
export function parseWard(map: readonly string[]): WardLayout;   // throws on invalid legend/dimensions
export function wardLayout(): WardLayout;                        // memoised parseWard(WARD_MAP)
export function inHall(x: number, z: number): boolean;           // cell membership in any hall region
export function cellToWorld(col: number, row: number): Point2;   // exported for tests
```

- [ ] **Step 1: Write the map-validity + parser failing tests** (`tests/ward.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { WARD_MAP } from '../src/castle/wardMap.ts';
import { parseWard, wardLayout, inHall, cellToWorld } from '../src/castle/ward.ts';
import { WARD, CASTLE } from '../src/core/constants.ts';

const LEGEND = new Set(['#', '.', 'P', 'H', 'K', 'G', 'T']);

describe('ward map validity', () => {
  it('is 36×36 with only legal symbols', () => {
    expect(WARD_MAP).toHaveLength(WARD.rows);
    for (const row of WARD_MAP) {
      expect(row).toHaveLength(WARD.cols);
      for (const ch of row) expect(LEGEND.has(ch)).toBe(true);
    }
  });
  it('has 3 plazas, 2 halls, 1 keep region, 1 gate', () => {
    const l = wardLayout();
    expect(l.plazas).toHaveLength(3);
    expect(l.halls).toHaveLength(2);
    expect(l.gate).toBeDefined();
  });
  it('keep center matches the castle center', () => {
    const l = wardLayout();
    expect(Math.abs(l.keep.center.x - CASTLE.center.x)).toBeLessThan(WARD.cellSize);
    expect(Math.abs(l.keep.center.z - CASTLE.center.z)).toBeLessThan(WARD.cellSize);
  });
});

describe('connectivity (BFS over open cells: . P H K G)', () => {
  // Implement bfsReachable(map, from) as a local test helper over the raw map grid:
  // 4-neighbor flood fill from the gate cell through every non-# non-T cell.
  it('gate reaches the keep', () => { /* flood from G; assert some K cell visited */ });
  it('gate reaches every plaza and every hall', () => { /* assert ≥1 cell of each P/H region visited */ });
  it('there are at least 2 edge-disjoint gate→keep routes', () => {
    // Simple check: for EVERY single open cell c (not gate/keep), removing c alone
    // must not disconnect gate from keep. (No articulation point on the route ⇒ ≥2 routes.)
    // Restrict the scan to corridor '.' cells to keep runtime sane (~hundreds of BFS runs, fine).
  });
  it('each hall has exactly 2 doorways', () => {
    // A doorway = an open non-H cell orthogonally adjacent to an H cell such that the
    // boundary between them is not a # cell. Count per hall region via the parser's entrances.
    for (const hall of wardLayout().halls) expect(hall.entrances).toHaveLength(2);
  });
});

describe('parser geometry', () => {
  it('merges adjacent wall cells into straight runs', () => {
    const tiny = [
      '####',
      '#..#',
      '#..#',
      '####',
    ];
    // parseWard must accept arbitrary rectangular test maps (relax 36×36 to map.length) —
    // dimension strictness applies only to WARD_MAP via the validity test above.
    const l = parseWard(tiny);
    // 4×4 ring → exactly 4 runs (top row, bottom row, left column interior, right column interior)
    expect(l.wallRuns.length).toBeLessThanOrEqual(6);
    expect(l.wallRuns.length).toBeGreaterThanOrEqual(4);
  });
  it('cellToWorld maps the grid onto ±90 m around the castle center', () => {
    const tl = cellToWorld(0, 0), br = cellToWorld(35, 35);
    expect(tl.x).toBeCloseTo(CASTLE.center.x - 87.5);
    expect(br.x).toBeCloseTo(CASTLE.center.x + 87.5);
  });
  it('zones include all plaza centers and ≥4 corridor junctions', () => {
    const l = wardLayout();
    for (const p of l.plazas) {
      expect(l.zones.some(z => Math.hypot(z.x - p.center.x, z.z - p.center.z) < 1)).toBe(true);
    }
    expect(l.zones.length).toBeGreaterThanOrEqual(7); // 3 plazas + ≥4 junctions
  });
  it('inHall is true inside a hall cell and false in a corridor', () => {
    const hall = wardLayout().halls[0];
    expect(inHall(hall.center.x, hall.center.z)).toBe(true);
    expect(inHall(wardLayout().gate.x, wardLayout().gate.z)).toBe(false);
  });
  it('wardLayout is memoised', () => { expect(wardLayout()).toBe(wardLayout()); });
});
```
Write the full bodies for the BFS helpers/tests sketched in comments — they are the heart of this task.

- [ ] **Step 2: Run tests, confirm failure** — `npm test -- ward`.

- [ ] **Step 3: Author the map + implement the parser.**
Authoring guidance for `WARD_MAP` (the deliverable is a map that passes every test above; iterate until it does):
  - Outer ring of cells: `T` at the 4 corners, `G` for a 2-cell gate span centered on the EAST edge (col 35, middle rows — the castle gate faces the origin/east, matching `castleLayout().gate`), `#` elsewhere on the ring (represents the curtain wall line; the actual curtain wall mesh is built by the existing builder — the ring cells just mark it for connectivity/collision purposes; do NOT emit interior maze-wall geometry for ring cells, see Task 4 note).
  - Keep: a 4×4 `K` block centered on cells (16–19, 16–19).
  - 3 plazas (`P` regions ~5×5): NW quadrant, SE quadrant, and one south-center.
  - 2 halls (`H` regions ~3×5): one north-center, one west-center; leave exactly 2 one-cell gaps in each hall's `#` perimeter as doorways.
  - Maze district: fill remaining space with `#`/`.` corridors 1 cell wide; include loops (test enforces no articulation point); ensure a route from the gate that must wind through the maze to reach the keep (no straight boulevard).
  - Tip: author it in a text editor with a monospace font; run `npm test -- ward` repeatedly; the BFS tests are your lint.
Parser implementation notes: region extraction via flood fill per symbol; wall-run merging: horizontal scan for runs of `#` length ≥2, vertical scan for the rest (each `#` cell belongs to ≥1 run; a lone `#` becomes a 1-cell run); entrances: for each hall region, open non-H neighbors adjacent across a missing perimeter wall; junctions: open `.` cells with ≥3 open orthogonal neighbors. Memoise `wardLayout()` module-level like `castleLayout()`.

- [ ] **Step 4: All tests green** — `npm test`, `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(castle): hand-authored ward map + pure parser"`

---

### Task 2: Castle resize to 180×180

**Files:**
- Modify: `src/core/constants.ts` (CASTLE block), `tests/castle-layout.test.ts`, `tests/terrain.test.ts`, `tests/scatter.test.ts` (approach ring), `e2e/verify.mjs` (CASTLE_APPROACH offset if hardcoded — grep)
- Test: existing suites (expectation updates only)

**Interfaces:**
- Consumes/produces: `CASTLE.half: 45 → 90`, `padRadius: 80 → 135`, `regionR: 130 → 175`, `approachR: [90,180] → [140,230]`. `padBlend`, `padHeight`, `center`, tower/keep/gate constants unchanged. Everything downstream (castleLayout walls/towers, curtain-wall circles, gargoyle perches, pad flattening, goblin leash, elf keep-clearance) recomputes from these constants.

- [ ] **Step 1: Change the four constants** in the `CASTLE` block; update their doc comments.
- [ ] **Step 2: Run `npm test`; triage failures.** Expected legitimate updates: castle-layout literal expectations (wall lengths 90→180 m, tower positions ±90, wall-circle counts from `coverSegment` roughly double, gate world position), terrain pad tests (flat radius now 135; blend window), scatter approach-mushroom ring tests (new radii). NOT expected: village, species, goblins, elves failures — investigate anything there rather than editing expectations (goblin spawn ring [30,60] still inside regionR; elf spiral still clears the keep — both constants-derived, should pass).
- [ ] **Step 3: Sanity-assert the pad doesn't swallow terrain features:** add one test — `heightAt` at `center ± (padRadius+padBlend+40)` differs from `padHeight` (world beyond the blend is untouched), mirroring the existing pad rim test at the new radii.
- [ ] **Step 4: grep `e2e/verify.mjs` for castle offsets** (`half`, `+ 45`, `+ 65`, `+ 70`) and update the approach/teleport constants to the new wall distance (gate side offset ≈ `half + 20` outside). Don't run the e2e suite yet (Task 7 does).
- [ ] **Step 5: Gates + commit** — `git commit -m "feat(castle): resize to 180×180 walled town (half 90, pad 135)"`

---

### Task 3: Ward collision — spatial hash + wiring

**Files:**
- Modify: `src/castle/ward.ts` (obstacle/grapple emission + hash + near-queries), `src/main.ts` (player wiring), `src/castle/system.ts` + `src/castle/elves.ts` (goblin/elf near-query)
- Test: `tests/ward.test.ts` (extend)

**Interfaces:**
- Consumes: `WardLayout.wallRuns` (Task 1), `Obstacle`/`resolveCollision` (src/player/collision.ts), `GrappleCollider` (src/player/grapple.ts), the private `coverSegment`/`wallCircles` pattern in `src/castle/layout.ts:170-214` (export `coverSegment` from layout.ts and reuse it — do not duplicate).
- Produces:
```ts
// src/castle/ward.ts
export function wardObstaclesNear(x: number, z: number): Obstacle[];        // 3×3 hash-bucket neighborhood
export function wardGrappleNear(x: number, z: number): GrappleCollider[];   // same buckets
```
Circles: per wall run, `coverSegment(runLength, r = WARD.wallT * 1.5)` packing (matching curtain-wall convention), `yTop = CASTLE.padHeight + WARD.wallH`, obstacle r = `WARD.wallT`, grapple r = `WARD.wallT * 1.5`, `yBase = CASTLE.padHeight`. All circles bucketed once (memoised) into a `Map<string, …>` keyed `` `${floor(x/WARD.hashCell)},${floor(z/WARD.hashCell)}` ``; near-query concatenates the 9 buckets around the query point. Ring cells (the outer `#` ring, map row/col 0/35) are EXCLUDED from emission — the curtain wall already has colliders.

- [ ] **Step 1: Failing tests:**

```ts
it('near-query returns every circle within 10 m and nothing beyond 3 buckets', () => {
  const l = wardLayout();
  const run = l.wallRuns.find(r => r.x1 !== r.x2 || r.z1 !== r.z2)!;
  const near = wardObstaclesNear(run.x1, run.z1);
  expect(near.length).toBeGreaterThan(0);
  for (const o of near) {
    expect(Math.hypot(o.x - run.x1, o.z - run.z1)).toBeLessThan(WARD.hashCell * 2.2);
  }
  // exhaustive containment: every emitted circle within 10 m of the query point appears in near
});
it('ward wall circles carry yTop = padHeight + wallH', () => {
  const any = wardObstaclesNear(wardLayout().gate.x, wardLayout().gate.z).concat(/* a maze point */);
  for (const o of any) expect(o.yTop).toBeCloseTo(CASTLE.padHeight + WARD.wallH);
});
it('a walker cannot cross a ward wall', () => {
  // pick a wall run midpoint; resolveCollision from one side stepping toward the other stays on its side over 200 steps
});
it('outer ring emits no ward circles (curtain wall owns it)', () => { /* query a ring cell center; assert no circle within cellSize/2 */ });
```
Write full bodies.

- [ ] **Step 2: Implement** (export `coverSegment` from layout.ts; build + memoise the hash; near-queries).
- [ ] **Step 3: Wire main.ts:** player obstacles line (main.ts:1057) appends `.concat(wardObstaclesNear(prev.x, prev.z))`; grapple lambda (main.ts:303) appends `.concat(wardGrappleNear(x, z))`. In `CastleSystem`'s goblin step (system.ts, the `obstacles:` ctx) append `wardObstaclesNear(goblin pos)` per goblin; in `ElfSystem.update` per elf likewise.
- [ ] **Step 4: Gates + commit** — `git commit -m "feat(castle): ward wall collision via spatial hash near-queries"`

---

### Task 4: Ward builders (maze walls, plazas, halls — both dressings)

**Files:**
- Modify: `src/castle/builders.ts` (buildWard section called from buildCastle), `src/core/constants.ts` (WARD_COLORS additions if needed — prefer reusing CASTLE_COLORS)
- Test: visual verification (three.js layer); `npm test` guards regressions

**Interfaces:**
- Consumes: `wardLayout()` (Task 1), `WARD` constants, existing wall/crenellation/merge helpers in builders.ts (`wallRunSegments`, `addCrenellations`, `mergeCastle` — read the file, names may differ slightly), `CASTLE_COLORS`.
- Produces: `buildCastle(scene, purified)` now also stamps: maze walls (WARD.wallH, crenellations only on runs ≥ 4 cells to keep triangle counts sane), plaza dressing (4 corner banner poles per plaza; purified adds ≤2 warm PointLights per plaza), halls (walls to WARD.hallH with the 2 doorway gaps, shallow pyramid roof at hallH+hallRoofRise — grapple-transparent by construction since only ward.ts emits colliders, 2 torch sconces inside per hall: emissive cone + 1 warm PointLight per hall, BOTH dressings). All merged via the existing merge path; light count budget: ≤ 2 (halls) cursed, ≤ 2+6 purified.

- [ ] **Step 1: Read builders.ts helpers**, then implement `buildWard(root: THREE.Group, purified: boolean)` called from `buildCastle` after the keep. Walls sit on `y = CASTLE.padHeight`.
- [ ] **Step 2: Gates** — `npm test` (no regressions; builders aren't unit-tested), `npx tsc --noEmit`.
- [ ] **Step 3: VISUAL VERIFICATION (required)** — dev server :5199, headless Chromium via repo Playwright: `?fresh=1&debug=castle` — screenshots: (a) from outside the gate (curtain wall + maze visible through gate), (b) inside a corridor (tightness), (c) a plaza, (d) inside a hall (torchlit, dark), (e) wall-top view over the maze toward the keep, (f) purified dressing (inject `castlePurified: true` save, reload) — plazas lamplit, banners. Inspect each screenshot yourself; save to the session scratchpad. Fix what looks broken (z-fighting, floating banners, doorway gaps misplaced) before committing.
- [ ] **Step 4: Commit** — `git commit -m "feat(castle): ward geometry — maze walls, plazas, torchlit halls, both dressings"`

---

### Task 5: Roofed-hall movement rules

**Files:**
- Modify: `src/player/controller.ts` (suppression seam), `src/main.ts` (wiring + toast), `src/debug.ts` (state().inHall)
- Test: `tests/ward.test.ts` (inHall covered in Task 1) + a controller-seam test if the seam is pure

**Interfaces:**
- Consumes: `inHall(x, z)` (Task 1), toast API (`src/ui/toasts.ts`), controller internals (read first — grapple fires in controller/grapple path on RMB; glider deploys from jumpHeld when unlocked).
- Produces: `PlayerController.movementCeiling: (x: number, z: number) => boolean` — a injected predicate (default `() => false`); when true at the player's position: RMB grapple fire is ignored and glide cannot deploy (already-latched hooks and in-flight zips are NOT interrupted). main.ts injects `(x, z) => inHall(x, z)`. On suppressed grapple attempt: toast `'No sky in here!'` at most once per hall entry (track a boolean reset when leaving halls).

- [ ] **Step 1: Read controller.ts + grapple.ts** to find the exact fire/deploy gates.
- [ ] **Step 2: Implement the predicate + gates + toast**; keep the controller seam generic (`movementCeiling`), no castle imports in player code (main.ts injects — preserves module boundaries).
- [ ] **Step 3: debug.ts:** add `inHall` to `state()` (from the same injected predicate or direct import in debug deps via main.ts).
- [ ] **Step 4: Behavioral verify (headless):** teleport into a hall, attempt RMB (dispatch pointer event with faked pointer lock as prior tasks did) → no hook + toast visible; step outside → grapple works. Confirm `state().inHall` flips.
- [ ] **Step 5: Gates + commit** — `git commit -m "feat(player): no grapple/glider under hall roofs"`

---

### Task 6: Inhabitants — goblin zones + elf plazas

**Files:**
- Modify: `src/core/constants.ts` (GOBLIN.count 8→12, patrolR 25→8), `src/castle/goblins.ts` (zone-based spawn points), `src/castle/system.ts` (spawn wiring), `src/castle/elves.ts` (plaza homes)
- Test: `tests/goblins.test.ts`, `tests/elves.test.ts`, `tests/castle-system.test.ts` (expectation updates + new)

**Interfaces:**
- Consumes: `wardLayout().zones` / `.plazas` (Task 1).
- Produces:
```ts
// goblins.ts — signature change:
export function goblinSpawnPoints(nightIndex: number, count: number, zones: readonly Point2[]): Vec3[];
// Round-robin over zones (shuffled by mulberry32(WORLD_SEED ^ nightIndex)), one goblin per zone until
// count exhausted (zones repeat if count > zones.length); jitter ±2 m; y = 0 placeholder as today
// (CastleSystem grounds via heightAt). CastleSystem passes wardLayout().zones.
// elves.ts — elfHomePosition re-targets plazas:
export function elfHomePosition(index: number): Vec3;
// Round-robin across the 3 plazas: plaza = plazas[index % 3]; within-plaza position from a
// deterministic per-plaza golden-angle mini-spiral (radius ≤ 2 cells) so indices stay ≥2 m apart.
```

- [ ] **Step 1: Failing tests:** goblinSpawnPoints determinism + every point within 3 m of some zone + all inside `inCastleRegion`; different nightIndex → different assignment order; elfHomePosition determinism + each home inside a plaza's cell bounds + indices 0–27 pairwise ≥2 m; existing keep-clearance test updated (plazas replace the spiral, keep-clearance now trivially true — keep the assertion).
- [ ] **Step 2: Implement + update `GOBLIN.count: 12`, `GOBLIN.patrolR: 8`** (doc comments updated). CastleSystem: pass zones at spawn; everything else (presence flag, purify, despawn) unchanged. Fix castle-system tests expecting 8 goblins (use `GOBLIN.count`, not literals, where they don't already).
- [ ] **Step 3: Behavioral spot-check (headless):** night at castle — goblins distributed through the ward (not one ring), a goblin in a corridor chases and gives up at walls; elves (setElves(9)) spread across 3 plazas.
- [ ] **Step 4: Gates + commit** — `git commit -m "feat(castle): goblin zone patrols and elf plaza homes in the ward"`

---

### Task 7: e2e + FOLLOWUPS + final gauntlet

**Files:**
- Modify: `e2e/verify.mjs` (checks + screenshots), `FOLLOWUPS.md`
- Test: full e2e run

- [ ] **Step 1: Update existing castle checks** for the new footprint (approach offsets from Task 2; `checkCastle` gargoyle-within-150m still holds — towers at ±90 keeps them in range of the gate approach; verify).
- [ ] **Step 2: New checks** (next screenshot numbers): `checkWardMaze` — teleport into a corridor cell (compute from `wardLayout` constants inline in the check via `__game` teleport to hardcoded world coords copied from the map; add `__game.state().inHall` polling), screenshot `26-ward-corridor.png`; walk into a hall → `state().inHall === true`, RMB suppressed (skip if pointer-lock faking is flaky — assert `inHall` + screenshot `27-hall-interior.png` at night minimum); `checkWardElves` — `setElves(9)`, day, plaza screenshot `28-elf-plaza.png`, assert `elfCount === 9`.
- [ ] **Step 3: Full gauntlet** — `npm test`, `npx tsc --noEmit`, `npm run build`, full `node e2e/verify.mjs` with all checks green (biome/castle screenshots refresh as side effect).
- [ ] **Step 4: FOLLOWUPS.md** — add a "Castle ward fast-follows" list: anything deferred (e.g. crenellation budget tuning, goblin corridor behavior notes from the spot-check, map iteration ideas).
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): ward maze checks + screenshot refresh"`

---

## Self-Review Notes (applied)

- Spec coverage: §1→Task 1, §2→Tasks 2+4, §3→Task 3, §4→Task 5, §5→Task 6, §6→Task 2 (+snapToGround pre-existing), §7→per-task tests + Task 7. Out-of-scope list respected (no pathfinding, no minimap, no roof-standing).
- Type consistency: `WardLayout`/`wardLayout()`/`inHall`/`wardObstaclesNear`/`wardGrappleNear`/`goblinSpawnPoints(nightIndex, count, zones)`/`elfHomePosition(index)` used identically across tasks.
- The map itself is authored in Task 1 against executable tests (BFS connectivity, no articulation point, doorway counts) — the tests are the spec for the content.
