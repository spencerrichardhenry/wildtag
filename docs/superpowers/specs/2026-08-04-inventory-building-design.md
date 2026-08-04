# Inventory Rework + Building System — Design Spec

**Date:** 2026-08-04 · **Branch:** feat/inventory-building (off master — master is the live deploy branch)
**Requested by:** Spencer + kids: Minecraft-style inventory with scroll-wheel hotbar and
first-person hands; buildable walls/ramps (freeform place, snap-stack, height cap);
wood/stone materials produced only by two new farm critters.

## Decisions locked with Spencer

- **6 assignable hotbar slots** (scroll wheel + Digit1–6); grapple leaves the
  hotbar — permanently equipped, right hand, RMB as today.
- Walls/ramps **crafted in batches** from **wood + stone**, which are
  **farm-only resources** (never gatherable in the world) produced by two new
  critters: a beaver-like (forests) → wood; a sand-shrew-like
  (crags/highlands) → stone.
- **Height cap: 4 pieces (8 m)** — curtain-wall height is acceptable cheese.
- Standing on placed pieces via the analytic `buildTopAt` ground extension
  (approved as the load-bearing architectural change).

## Invariants (updated, not broken)

- Ground truth becomes `effectiveGroundAt(x,z) = max(heightAt(x,z), buildTopAt(x,z))`
  where `buildTopAt` is a pure function over placed-piece data (axis-aligned
  boxes + ramp planes). No mesh raycasts, deterministic, unit-testable. Every
  consumer that means "the floor" migrates to the composed query; consumers
  that mean "the terrain" (chunk meshing, scatter, water) keep raw `heightAt`.
- Free flight still impossible: build pieces are static standables like
  terrain; the 8 m cap bounds what they add.
- All tuning constants in `src/core/constants.ts`; pure modules never import
  `three`; all models procedural; save stays backward compatible.

## 1. Inventory model + screen (Escape)

- Pure model `src/craft/hotbar.ts`: `HotbarState` = 6 slots, each
  `ItemId | null` where `ItemId = 'darts' | 'purifiers' | 'charms' |
  'kit:zipline' | 'kit:drone' | 'wall' | 'ramp'`. Operations: `assign(slot,
  item)`, `clear(slot)`, `selectNext/Prev` (wheel wrap), `select(slot)`.
  Assignments + selection persist in the save (new optional field `hotbar`).
- Escape with no screen open → inventory screen (new `ScreenDef` in
  screens.ts); Escape with any screen open → close (unchanged). The existing
  quality selector moves into a compact row at the bottom of this screen.
- Layout: item grid (owned usable items with counts, plus a read-only
  resources row incl. wood/stone) above the 6-slot hotbar strip. Click item →
  click slot to assign; click assigned slot → clear. No drag needed.
- Migration: fresh saves get darts in slot 1; existing saves map old fixed
  slots darts→1, zipline→2, drone→3, purify→4 (grapple drops out; slots 5–6
  empty).
- HUD hotbar renders the 6 slots with item icons + counts; scroll wheel and
  Digit1–6 select. Selection semantics: selecting a placeable slot (kit,
  wall, ramp) enters its ghost mode automatically; selecting anything else
  (or an empty slot) cancels any ghost. LMB = use the selected item: throw
  dart / confirm ghost placement. Empty/zero-count slot → LMB no-ops with a
  subtle shake. (This replaces the old slot-3/4 toggle behavior.)

## 2. First-person hands

- `src/player/hands.ts` (three.js): low-poly arms/hands parented to the
  camera. Right hand: grapple hook model once `unlocks.has('grapple')`;
  hidden while a hook is live (rope visuals take over) and while riding.
  Left hand: held-item viewmodel per selected slot (dart, purify dart tinted,
  charm, kit satchel, wall block, ramp wedge; empty open hand otherwise).
  Idle sway + small bob from movement speed; hidden while screens open,
  during daze blackout, and in preview/debug cameras.
- Purely cosmetic — no gameplay reads from hands. Quality: skip render on
  `low` preset if draw calls matter (measure; likely fine — ≤6 draw calls).

## 3. Building system

- New craftables (recipes.ts): `wall` — Wall Block ×4, cost {wood 2, stone 3};
  `ramp` — Ramp ×2, cost {wood 3, stone 1}; both tier 1, rpRequired 25.
  Inventory counters `walls`, `ramps` (same optional-save pattern as charms).
- Piece geometry: wall = 2×2×0.4 m stone panel; ramp = 2 m wide × 2 m run ×
  2 m rise right wedge. Procedural meshes, one shared material each,
  per-piece instances (cap total placed pieces `BUILD.maxPieces` 200 —
  toast when full).
- **Placement** (`src/structures/build.ts`, modeled on PlacementSystem):
  selecting wall/ramp in the hotbar enters ghost mode; ghost at aim point on
  `effectiveGroundAt`, yaw = camera yaw snapped to 15°. **Snap within 1 m**
  of an existing piece: (a) flush on top (stack, inherits x/z/yaw), (b)
  edge-to-edge (row, inherits yaw + aligned edge), (c) ramp-foot-to-wall-base.
  Freeform placement wherever no snap candidate is near. Green/red ghost
  validity: red when base > 8 m above terrain (`BUILD.maxStackH`), when
  intersecting an existing piece/obstacle, or when pieces are exhausted.
  LMB confirms, decrements inventory.
- **Pick-up:** aim at a placed piece within 6 m, hold F for 0.5 s → piece
  returns to inventory (prompt reuses the harvest prompt UI).
- **Physics:** each piece contributes (a) obstacle circles (walls: 2 circles
  along the panel; ramps: 1) with `yTop`, wired into player/goblin/elf sets
  via a chunk-hash near-query like ward walls; (b) grapple colliders; (c)
  `buildTopAt(x,z)`: walls → top-face height over their footprint; ramps →
  linear interpolation along the slope over theirs. `effectiveGroundAt`
  replaces `heightAt` in the GroundQuery handed to the player controller,
  critter/goblin/elf grounding, and dart ground-hit — each call site audited
  and listed in the plan.
- Persistence: `SaveV3.builds?: {kind, x, y, z, yaw}[]` (y = base height at
  place time), same optional-field convention.

## 4. Producer critters + materials

- `ResourceKind` gains `'wood' | 'stone'` (inventory, save guards, HUD strip,
  RESOURCE_LABEL, FARM.cubeColors). **No scatter nodes, no harvest sources** —
  farm produce only.
- Species #14 **Timberchomp** (beaver-like): biomes forest + wetland; plump
  body, broad flat tail, buck teeth, dam-brown; `farmRole {kind:'produce',
  resource:'wood', amount:2}`. Mid rarity, modest track difficulty.
- Species #15 **Pebbleshrew** (sand-shrew-like): biomes crags + highlands;
  sandy plated back, digging claws; `farmRole {produce, 'stone', 2}`.
- Full critter integration: models (≤1200 tris), preview grid, guide,
  species tests 13→15, barterable/pennable like all species. Farm system
  needs zero changes (produce roles are data-driven).

## 5. Testing & debug

- Pure/TDD: hotbar model ops + migration; buildTopAt (flat, stacked, ramp
  slope, edges, overlapping pieces take max); snap resolution (top/edge/
  ramp-foot + freeform fallback); height-cap validity; placement/pickup
  inventory flows; save round-trips (hotbar, builds, wood/stone counters);
  species bookkeeping. Physical: player stands on a 2-stack
  (effectiveGroundAt), walks up a ramp; goblin/elf collide with pieces.
- e2e: inventory open/assign/scroll check; place wall → stack second →
  climb (teleport above, land on top via effectiveGroundAt); pick-up check;
  hands visible screenshot; two new species in preview (grid 15).
- Debug: `__game.grant('wood'|'stone'|'walls'|'ramps', n)`;
  `state()` gains selectedSlot, placedPieces.

## Out of scope (YAGNI)

Floors/roofs/doors; paint/skins; durability; world-grid alignment; moving
placed pieces (pick up + re-place instead); critter pathing around builds
beyond existing collision; hand animations beyond sway/bob (no swing anims).
