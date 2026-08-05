# Inventory Rework + Building System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Minecraft-style inventory (Escape screen, 6-slot scroll-wheel hotbar, first-person hands with a permanent right-hand grapple) plus buildable walls/ramps (freeform + snap-stack, 8 m cap, standable) powered by farm-only wood/stone from two new producer critters.

**Architecture:** Pure hotbar model (`src/craft/hotbar.ts`) + pure build math (`src/structures/buildmath.ts`: buildTopAt / snap / validity) under a three.js BuildSystem cloned from PlacementSystem. Ground truth becomes `effectiveGroundAt = max(heightAt, buildTopAt)` composed in main.ts's GroundQuery for floor-consumers. Wood/stone are new ResourceKinds produced only by two new farm species. Hands are a camera-parented viewmodel.

**Tech Stack:** Three.js + Vite + TS, Vitest (`npm test`), Playwright e2e (`PLAYWRIGHT_DIR=$(pwd) node e2e/verify.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-04-inventory-building-design.md` — read before any task.

## Global Constraints

- Branch `feat/inventory-building` (off master — master is LIVE; never push). Commit per task, conventional commits.
- ALL tuning constants in `src/core/constants.ts`. Pure modules never import `three`. All models procedural, ≤1200 tris for critters (tests/models.test.ts enforces).
- Ground rule: `effectiveGroundAt(x,z) = max(heightAt(x,z), buildTopAt(x,z))` is the new floor for player/goblins/elves/mounts/darts; raw `heightAt` remains for terrain meshing, scatter, water, village/castle layout, wild critters. No mesh raycasts anywhere.
- Save: every new field optional with the established decode-guard convention (absent → default, garbage → dropped); old saves must load.
- Gates per task: `npm test` green AND `npx tsc --noEmit` clean. Heavy sims follow the env-gated local-only convention (see tests/goblins.test.ts).
- Existing e2e checks must keep passing at Task 7 (hotbar semantics change WILL break some — fix them per the new semantics, don't weaken).

---

### Task 1: Wood + stone resources and the two producer critters

**Files:**
- Modify: `src/core/types.ts` (ResourceKind), `src/craft/inventory.ts`, `src/core/save.ts` (guards), `src/ui/hud.ts` (RES_COLOR + strip), `src/ui/screens.ts` (RESOURCE_LABEL), `src/core/constants.ts` (FARM.cubeColors + any species tuning), `src/critters/species.ts` (2 entries), `src/critters/models.ts` (2 builders), `src/critters/preview.ts` (grid 15), `src/ui/guide.ts` (if flee labels/entries need it)
- Test: `tests/resources.test.ts` or `tests/craft.test.ts` (inventory), `tests/save.test.ts`, `tests/species.test.ts` (13→15 + table rows), `tests/farm.test.ts` (produce flows for wood/stone)

**Interfaces:**
- Produces: `ResourceKind = ... | 'wood' | 'stone'`; `Inventory.wood/stone: number`; species ids `'timberchomp'` (biomes ['forest','wetland'], farmRole {produce, wood, 2}) and `'pebbleshrew'` (biomes ['crags','highlands'], farmRole {produce, stone, 2}). Task 5's recipes cost {wood, stone}.
- Checklist precedent: the mushroom ResourceKind addition (same guard/HUD/label/cubeColors touch points — grep 'mushroom' for the exact sites). CRITICAL: wood/stone get NO scatter nodes and NO RESOURCE_KINDS (props.ts) entry — farm-only; add a test asserting scatterForChunk never emits them and props' RESOURCE_KINDS excludes them.
- Species entries follow the SpeciesDef shape; sizes ~0.7/0.5, walk/flee/awareness/track values in family with existing rodents (copy snickerdoodle/emberpup ranges); rarity 0.4/0.35. Models: Timberchomp — plump egg body, broad flat tail (capsule squashed), buck teeth, dam-brown jitter; Pebbleshrew — sandy egg, plated back ridge (stacked cones), digging claws, small. Verify look via `?preview=critters&focus=timberchomp,pebbleshrew` headlessly, inspect screenshot.
- Farm produce needs zero farm-code changes (data-driven) — but ADD farm.test.ts cases: assigned timberchomp banks wood at producePeriod; pebbleshrew stone.

Steps: TDD failing tests (inventory counters, save round-trip + absent-default, species count 15 + verbatim rows, farm produce, no-scatter assertion) → implement → full gates → commit `feat(critters): timberchomp + pebbleshrew produce farm-only wood/stone`.

---

### Task 2: Hotbar model + save migration (pure)

**Files:**
- Create: `src/craft/hotbar.ts`
- Modify: `src/core/save.ts` (SaveV3.hotbar), `src/core/constants.ts` (HOTBAR block if tunables emerge)
- Test: `tests/hotbar.test.ts` (new), `tests/save.test.ts`

**Interfaces (produced, consumed by Tasks 3/5):**
```ts
export type ItemId = 'darts' | 'purifiers' | 'charms' | 'kit:zipline' | 'kit:drone' | 'wall' | 'ramp';
export interface HotbarState { slots: (ItemId | null)[]; selected: number } // 6 slots, selected 0..5
export function createHotbar(): HotbarState;                      // darts in slot 0, rest null, selected 0
export function assign(h: HotbarState, slot: number, item: ItemId | null): HotbarState; // pure; assigning an item already in another slot MOVES it (no dupes)
export function select(h: HotbarState, slot: number): HotbarState;
export function selectStep(h: HotbarState, dir: 1 | -1): HotbarState; // wheel, wraps
export function migrateLegacy(): HotbarState;                     // darts→0, kit:zipline→1, kit:drone→2, purifiers→3
export function itemCount(inv: Inventory, item: ItemId): number;  // maps ItemId → inventory counter (kits via inv.kits)
```
- Save: `SaveV3.hotbar?: { slots: (string | null)[]; selected: number }` — decode guard validates each slot against the ItemId union (unknown string → null), selected clamped 0..5; absent → `migrateLegacy()` on load for saves that predate it (v3 without hotbar field), `createHotbar()` for fresh starts.

Steps: failing tests (all ops incl. no-dupe move, wrap both directions, migration mapping, save round-trip + garbage slots dropped, itemCount incl. kits) → implement (~80 lines) → gates → commit `feat(craft): pure 6-slot hotbar model with save migration`.

---

### Task 3: Inventory screen, HUD hotbar rework, wheel input, selection semantics

**Files:**
- Modify: `src/player/input.ts` (wheel events + Digit6), `src/ui/screens.ts` (inventory ScreenDef + Escape flow + quality row relocation), `src/ui/hud.ts` (6 assignable slots, icons + counts, selected highlight), `src/main.ts` (selection→action rewiring: LMB dispatch per selected ItemId; kit ghost enter/cancel on selection change; remove old slot-toggle code), `src/debug.ts` (state().selectedSlot)
- Test: `tests/input.test.ts` (wheel + Digit6 actions via the pure actionForCode/wheel seam), `tests/hud.test.ts` (clamp/labels if seams exist)

**Interfaces:**
- Consumes: HotbarState ops (Task 2). Produces for Task 5: main.ts owns `let hotbar: HotbarState`; LMB dispatch switch on `hotbar.slots[hotbar.selected]`: 'darts'→darts.tryThrow(), 'purifiers'→purifier.tryThrow(), 'charms'→existing bond flow (find how charms are used today — KeyB roster? charms are consumed on bond; if charms aren't LMB-usable today, the hotbar slot shows count and LMB no-ops with shake — decide from code and document), 'kit:*'→placement.confirm() when ghost active, 'wall'/'ramp'→build.confirm() (Task 5 stub: guard behind a `buildSystem?` optional until Task 5 lands — keep compiling).
- Selection change handler: entering a placeable slot calls placement.toggle(tool)/build.enter(kind); leaving cancels. Old Digit3/4 toggle paths deleted. Help screen keybinds updated ('1 – 6', 'Wheel — select item', Esc — inventory).
- Wheel: `wheel` DOM event → queued `{type:'hotbarStep', dir}` action (respect pointer lock only; passive listener). Escape flow: input.ts already queues Escape; screens.handleEscape() when open; main.ts: Escape with none open → open inventory screen.
- Inventory screen: grid of owned items (icon + count; the 7 ItemIds when owned>0 or assigned) + resources row (fiber/resin/shard/spark/mushroom/wood/stone read-only) + 6 hotbar slots; click-item-then-slot assign; click-slot clear; quality selector row at bottom (move from wherever it lives — find the existing Esc/quality menu in screens.ts and relocate). Persist via buildSaveState emitting hotbar.
- Icons: small canvas-drawn or DOM/emoji-free procedural swatches consistent with hud.ts's existing style (RES_COLOR dots + label text is fine — match the file's conventions; no image assets).

Steps: failing input tests → wheel/Digit6 → hotbar model wiring + HUD render → inventory screen → LMB dispatch rewrite → migration wired on load → gates + headless behavioral check (open inventory, assign purifiers to slot 2 via clicks, scroll to it, state().selectedSlot changes, LMB throws purifier; old checks e2e NOT run yet) → commit `feat(ui): minecraft-style inventory screen + scroll-wheel hotbar`.

---

### Task 4: Build math (pure): pieces, buildTopAt, snap, validity

**Files:**
- Create: `src/structures/buildmath.ts`
- Modify: `src/core/constants.ts` (BUILD block)
- Test: `tests/buildmath.test.ts` (new)

**Interfaces (produced; consumed by Task 5 + main.ts ground composition):**
```ts
// constants.ts
export const BUILD = {
  wall: { w: 2, h: 2, t: 0.4 }, ramp: { w: 2, run: 2, rise: 2 },
  maxStackH: 8, maxPieces: 200, snapR: 1.0, yawStepDeg: 15,
  pickupRange: 6, pickupHoldS: 0.5,
} as const;
// buildmath.ts
export interface BuildPiece { id: number; kind: 'wall' | 'ramp'; x: number; y: number; z: number; yaw: number }
export function buildTopAt(pieces: readonly BuildPiece[], x: number, z: number): number;
//  -Infinity when no piece covers (x,z). Walls: y+h over the rotated w×t footprint.
//  Ramps: y + rise * clamp(alongRun/run, 0, 1) over the rotated w×run footprint. Overlaps → max.
export interface SnapResult { x: number; y: number; z: number; yaw: number; snapped: 'top' | 'edge' | 'rampfoot' | null }
export function resolveSnap(pieces: readonly BuildPiece[], kind: 'wall'|'ramp', aim: {x,y,z}, camYawDeg: number): SnapResult;
//  nearest candidate within BUILD.snapR else freeform (yaw snapped to yawStepDeg, y = caller-supplied ground).
export function placementValid(pieces: readonly BuildPiece[], candidate: BuildPiece, terrainY: number): { ok: boolean; reason?: 'height' | 'overlap' } ;
//  height: candidate.y + pieceHeight - terrainY > BUILD.maxStackH → invalid. overlap: OBB-ish XZ overlap at intersecting y-ranges (approximate with footprint rect overlap + y-interval overlap; document the approximation).
export function pieceAtRay(pieces: readonly BuildPiece[], origin: Vec3, dir: Vec3, maxDist: number): BuildPiece | null; // for pickup aiming (coarse: ray vs piece AABB expanded by 0.2)
export function pieceObstacles(p: BuildPiece): Obstacle[];       // walls: 2 circles r=t*1.5 along the panel, yTop=y+h; ramps: 1 circle r=0.9 at center, yTop=y+rise
export function pieceGrapple(p: BuildPiece): GrappleCollider[];
```
- Rotation math: footprint membership via inverse-rotate the query point by -yaw about the piece center; all pure trig, no three.

Steps: failing tests FIRST covering — flat wall top, 2-stack top, ramp slope interpolation at 0/25/75/100% + off-footprint -Infinity, rotated footprints (45°), overlap max, snap top/edge/rampfoot each with a hand-built fixture + freeform fallback beyond snapR, height cap boundary (exactly 8 m ok, over → invalid), overlap rejection, pieceAtRay hit/miss → implement → gates → commit `feat(structures): pure build math — buildTopAt, snapping, validity`.

---

### Task 5: BuildSystem + recipes + ground composition + persistence

**Files:**
- Create: `src/structures/build.ts` (BuildSystem, modeled on src/structures/placement.ts)
- Modify: `src/craft/recipes.ts` + `src/core/types.ts` (RecipeId 'wall'|'ramp', grants 'walls'|'ramps'), `src/craft/inventory.ts` (walls/ramps counters), `src/core/save.ts` (SaveV3.builds), `src/main.ts` (GroundQuery composition, wiring, LMB/build confirm, pickup hold-F, obstacle/grapple concat), `src/debug.ts` (grant walls/ramps, state().placedPieces), `src/ui/hud.ts`/`screens.ts` (labels for new items)
- Test: `tests/craft.test.ts` (recipes), `tests/save.test.ts` (builds round-trip), `tests/build-system.test.ts` (headless THREE.Scene pattern like castle-system tests)

**Interfaces:**
- Recipes: `{id:'wall', name:'Wall Block', tier:1, rpRequired:25, cost:{wood:2, stone:3}, kind:'consumable', batch:4, grants:'walls'}`; `{id:'ramp', name:'Ramp', tier:1, rpRequired:25, cost:{wood:3, stone:1}, kind:'consumable', batch:2, grants:'ramps'}` (widen grants union).
- BuildSystem: `enter(kind)`, `cancel()`, `confirm(): boolean` (validity + decrement + mesh spawn), `update(dt, aim, camYaw)` (ghost track + green/red material), `beginPickup(origin, look)` / `tickPickup(dt): boolean` (hold-F progress → reclaim), `pieces(): readonly BuildPiece[]`, `obstaclesNear(x,z)` / `grappleNear(x,z)` (chunk-hash 16 m buckets, REBUILT on place/pickup — pieces are dynamic, so the hash invalidates on mutation; keep it a simple rebuild, ≤200 pieces), `serialize()/deserialize()`.
- **Ground composition (THE critical wiring):** main.ts:314's `ground` becomes `{ heightAt: (x,z) => Math.max(heightAt(x,z), build.topAt(x,z)), normalAt: groundNormalAt }` where `build.topAt` delegates to buildmath.buildTopAt over live pieces (fast path: return heightAt when no piece within the coarse hash bucket). AUDIT + DECIDE each existing `ground`/heightAt consumer: player controller (composed ✓), darts + purifier ground-hit (composed ✓ — darts stop on build tops), mounts (composed ✓), CastleSystem goblins + ElfSystem (composed ✓ — they walk on/up pieces; obstacles block sides), snapToGround on load (composed ✓ — build deserializes BEFORE the snap), stumble/retreat (composed ✓ via player), CritterManager/AI wild critters (RAW heightAt — deliberate, matches their ward behavior; FOLLOWUPS), chunk meshing/scatter/water/village/castle layout/daylight (RAW — terrain-only by definition). Implement by passing the composed query where the raw one used to go — list every touched call site in the report.
- Normal: keep `groundNormalAt` terrain-based (pieces are flat/ramped; the movement core tolerates normal mismatch — verify slope-slide code doesn't misbehave standing on a wall over steep terrain; if it does, return {0,1,0} when buildTopAt wins — decide from movement.ts's use of normalAt and document).
- Meshes: per-piece Mesh (shared geometry per kind, shared materials; stone-gray walls / wood-brown ramps... ramps read wood). Ghost: translucent clone tinted green/red (placement.ts precedent). Dispose on pickup.
- Save: `builds?: {k:'w'|'r', x,y,z,yaw}[]` compact; guard per entry; cap at maxPieces on load.
- Pickup UX: aiming at a piece within range shows the harvest-style prompt ('Hold F — reclaim'); holding interact for pickupHoldS reclaims (+1 walls/ramps).

Steps: failing tests (recipes, counters, save round-trip, BuildSystem place/confirm/pickup/serialize headless, hash invalidation after pickup) → implement → ground composition + audit → gates → headless behavioral: grant materials, craft, place wall, stack second (snap), walk onto top (pos.y ≈ terrain+4 via composed ground), place ramp, walk up it, hold-F reclaim → commit `feat(structures): buildable walls + ramps — snap stacking, standable, persisted`.

---

### Task 6: First-person hands

**Files:**
- Create: `src/player/hands.ts`
- Modify: `src/main.ts` (construct + per-frame update), `src/core/constants.ts` (HANDS block: sway/bob amplitudes, offsets)
- Test: visual verification (three.js layer); `npm test` guards regressions

**Interfaces:** `class HandsView { constructor(camera: THREE.Camera); update(dt: number, opts: { speed: number; selectedItem: ItemId | null; grappleUnlocked: boolean; hookLive: boolean; riding: boolean; hidden: boolean }): void; dispose(): void }` — main.ts feeds it each render frame.
- Right hand: forearm + mitten + hook model (small cylinder + prongs) when grappleUnlocked && !hookLive && !riding. Left: per-ItemId viewmodels (dart stick, tinted purify dart, charm orb, satchel for kits, mini wall slab, mini ramp wedge, empty = open mitten). Idle sway (sin t) + bob scaled by speed. hidden → group.visible=false (screens open, daze blackout, preview/debug cams).
- Render on top: either camera-child with depthTest-off materials or a high renderOrder — match how the game renders the rope/crosshair; simplest that doesn't clip through walls badly (document choice; camera-child with narrow FOV placement offsets is fine).

Steps: build → wire → headless screenshots per held item (cycle slots via debug) + empty + hook-live states, inspect ALL → tsc/test gates → commit `feat(player): first-person hands with held-item viewmodels`.

---

### Task 7: e2e + gauntlet + FOLLOWUPS

**Files:** `e2e/verify.mjs`, `FOLLOWUPS.md`, refreshed `docs/verify/` screenshots.

- Fix existing checks broken by the hotbar semantics change (checkCraft/checkStructures/checkTracking use slots/toggles — update to the new selection model; species preview grid 13→15 assertions; any '1 – 5' remnants).
- New checks: `checkInventoryHotbar` (open inventory via Escape, assign purifiers to a slot by DOM clicks, scroll-select it, state().selectedSlot matches, screenshot 29); `checkBuilding` (grant wood/stone + craft or grant walls/ramps, place a wall + stack a second + a ramp via debug-driven aim/confirm — if aiming is too flaky headless, add `__game.placePiece(kind, x, y, z, yaw)` debug seam that routes through the SAME validity path, and note it; then teleport above the stack and assert landing y ≈ stack top via composed ground; pick one back up; screenshot 30); `checkHands` (screenshot 31 with dart held; assert canvas region non-empty is enough — visual).
- Full gauntlet: `npm test`, `npx tsc --noEmit`, `npm run build`, full e2e ALL green.
- FOLLOWUPS: add — wild critters don't stand on/collide with build pieces; hands on low preset unmeasured; any deferred minors from reviews.
- Commit `test(e2e): inventory, building, hands checks + screenshot refresh`.

---

## Self-Review Notes (applied)

- Spec §1→Tasks 2+3, §2→Task 6, §3→Tasks 4+5, §4→Task 1, §5→per-task + Task 7. Charms-on-LMB ambiguity delegated to Task 3 implementer with explicit decide-from-code instruction.
- Type consistency: ItemId/HotbarState/BuildPiece/buildTopAt/resolveSnap/placementValid/BuildSystem method names used identically across tasks; grants union widened once (Task 5).
- Task 1 is independent of 2-6 (only Task 5's recipes consume wood/stone); Tasks 2→3 and 4→5 are ordered; 6 depends on 3's ItemId only.

---

### Task 8 (playtest feedback): building UX — height cap bug, rotation, cube piece, Ctrl-snap

Spencer's live playtest: (1) can only stack 3 high, not 4 — DEBUG ROOT CAUSE FIRST (suspect: the ghost's snapped base y comes from composed ground/top-snap with float drift, so 4th piece top computes as 8+ε over terrainY; or terrainY sampled at a slightly different x/z than the stack base). Write the failing repro test at exact boundary, then fix (tolerance in the height gate or consistent terrainY sampling). (2) Ghost rotation: KeyR rotates the ghost +90° (accumulates; applied on top of freeform camera yaw AND snap yaw). (3) New CUBE piece `{w:2, h:2, d:2}`, recipe Cube ×4 {wood 2, stone 2} tier 1 rp 25, grants 'cubes', ItemId 'cube', full pipeline (buildmath top/footprint/obstacles/grapple — top-snap + edge-snap; mesh; hands mini-cube; save counter; labels). Ramps must edge/top-snap against cubes so ramp→cube→ramp staircases work — add a compositional test placing exactly that staircase and walking it (composed-ground sim). (4) Snapping becomes EXPLICIT: only while Ctrl is held (input plumbs a `snapHeld` modifier); otherwise pure freeform. Also fix "ghost lands behind the target": the aim ray must test build pieces BEFORE terrain (pieceAtRay first, then terrain march) so aiming at a wall face anchors on the wall, not the ground behind it. Update the help screen + FOLLOWUPS.

### Task 9 (playtest feedback): destruction mode + drone limit

(1) Destruction mode: KeyX toggles (crosshair turns red / toast on toggle; state().demolish exposed). While active: LMB on any reclaimable within 8 m instantly reclaims with NO penalty — build pieces (wall/ramp/cube → counters), drones (→ kits.drone, anchor unregistered), zipline posts/lines (→ kits.zipline; read ZiplineSystem for its removal semantics — a placed pair reclaims as one kit). Aim highlight: tint the targeted object red-ish while in mode (cheap: emissive pulse on the aimed mesh, or skip highlight if invasive — document). Hotbar/ghosts suppressed while in mode. Exiting mode restores normal LMB. Tests: pure reclaim flows headless (BuildSystem + DroneSystem + ZiplineSystem), toggle state, no-penalty counters. (2) `DRONE maxDrones 2 → 12` (constants + any tests/comments; check droneAnchor perf note none needed). e2e: extend checkBuilding or add checkDemolish (placePiece + demolish toggle via a debug seam + assert counters restored).
