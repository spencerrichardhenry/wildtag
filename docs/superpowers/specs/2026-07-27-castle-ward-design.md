# Castle Ward Maze — Design Spec

**Date:** 2026-07-27
**Branch:** `feat/castle-ward` (off `build/fidelity-2`, which contains the Cursed Castle feature)
**Requested by:** Spencer — "bigger, more like a maze, areas where movement is pretty tight/constrained like corridors, halls, or city squares."

## Summary

The castle grows from a 90×90 m shell with one keep room into a **180×180 m
walled town**: a hand-authored maze of tight corridors between the gate and
the keep, punctuated by **3 plazas** (city squares), **2 roofed great halls**,
and the existing keep at the heart. The maze **guards the keep** — reaching
the dark crystal on foot means navigating it (skilled players can still
grapple wall tops and glide to shortcut). The layout is a **fully
hand-authored ASCII tile map**, deterministic forever, so the kids can learn
it.

Decisions locked with Spencer:
- Mostly open-air maze **plus 2 roofed halls** (dark inside, no grapple).
- **~180×180 m** footprint (walls at ±90 m).
- **Maze guards the keep** (no open boulevard).
- **Fully hand-authored ASCII map** (not generated).

## Invariants preserved

- Free flight impossible: hall roofs are solid (`yTop`), and grapple/glider
  are suppressed under roofs (see §4); everything else unchanged.
- `heightAt(x,z)` remains the only ground truth; the ward sits on the
  (enlarged) flattened pad.
- All tuning constants in `src/core/constants.ts`; the ward map itself lives
  in `src/castle/wardMap.ts` as authored content (a map, not a tunable).
- Pure modules never import `three`; all models procedural.
- Critters stay non-violent; goblins stay out of the critter system.

## 1. The ward map (`src/castle/wardMap.ts`)

- A **36×36** array of single-character strings, **5 m per cell**, spanning
  the full ±90 m interior. Hand-authored, committed, human-editable.
- Legend:
  - `#` maze wall (5.5 m tall, thickness ~1.2 m, centered on the cell)
  - `.` corridor / open ground
  - `P` plaza cell (open; plazas are contiguous `P` regions, 4–6 cells across)
  - `H` roofed hall interior (halls are contiguous `H` regions, ~3×5 cells)
  - `K` keep footprint (the existing keep builder stamps here; crystal home)
  - `G` gate opening in the curtain wall (east side, as today)
  - `T` corner tower anchor (existing towers/gargoyle perches)
- The outer ring of the map IS the curtain wall (existing builder, resized);
  `G` marks its gate span. Interior `#` cells are the maze.
- Corridors are 1 cell wide → ~2.6–3.6 m clear between wall faces: tight.
- Authoring requirements (enforced by tests, §7): gate→keep connected;
  gate→every plaza and every hall connected; each hall has exactly 2 doorway
  gaps; at least 2 distinct gate→keep routes (loops, not a single solution
  path); 3 plazas, 2 halls.
- Initial map authored during implementation; Spencer and the kids can edit
  the ASCII later — tests keep edits honest.

## 2. Parser + geometry (`src/castle/ward.ts` pure; builders extend `src/castle/builders.ts`)

- `parseWard(map: string[]) → WardLayout`:
  ```ts
  interface WardLayout {
    cellSize: number;                       // 5
    wallRuns: { x1: number; z1: number; x2: number; z2: number }[]; // merged straight runs of adjacent # cells, world coords
    plazas: { cells: Point2[]; center: Point2 }[];                  // 3
    halls:  { cells: Point2[]; center: Point2; entrances: Point2[] }[]; // 2
    keep:   { center: Point2 };             // must match CASTLE keep constants
    zones:  Point2[];                       // goblin zone homes: plaza centers + corridor junctions (cells with 3+ open neighbors)
  }
  ```
- Wall runs merge maze-wall cells row/column-wise into long segments so
  builder + collision work per-run, not per-cell.
- Builders: maze walls reuse the existing crenellated-wall builder at
  `WARD.wallH` (5.5 m); both dressings (cursed dark / purified bright + ivy +
  banners). Plazas get corner banners; purified plazas add warm lamps
  (PointLight budget: ≤2 per plaza, purified only — cursed ward stays
  lightless outside halls). Halls: walls to `WARD.hallH` (7 m), flat roof
  slab, 2 doorways from the layout, 2 torch sconces inside each (emissive
  cones + 1 warm PointLight per hall, both dressings — halls are always lit
  inside). Everything merges into the castle group (`mergeCastle`).
- The curtain wall, towers, gatehouse, and keep builders are reused with
  `CASTLE.half: 45 → 90`; keep stays at the castle center.

## 3. Collision & performance

- Ward walls emit obstacles (`yTop = padHeight + WARD.wallH`) and grapple
  colliders per wall run via the existing `coverSegment` circle packing —
  but a 36×36 maze yields too many circles for the flat
  every-frame scan used today.
- New **spatial hash** in `ward.ts`: circles bucketed by 15 m cell;
  `wardObstaclesNear(x, z)` / `wardGrappleNear(x, z)` return the 3×3
  neighborhood's circles (O(1), ~tens of circles).
- `main.ts` obstacle wiring changes from a static concat to:
  `props.getObstacles(x,z) + villageObs + castleObs (curtain/towers/keep,
  small, static) + wardObstaclesNear(x,z)`. Same for grapple colliders.
- Goblins/elves already run `resolveCollision` against castle obstacles —
  they switch to the same near-query (per-goblin position).
- Hall roofs are **cosmetic shallow pyramids**: grapple-transparent (no
  collider) and not standable — standing on meshes has never existed in this
  game (`heightAt` is the only floor). The under-roof rule (§4) is what
  prevents grappling up through them, and the sloped shape makes "landing"
  on one read as sliding off rather than clipping.

## 4. Roofed halls: movement rules

- `inHall(x, z): boolean` pure query from the layout (cell membership).
- While `inHall(player)`: grapple **cannot fire** (RMB shows a brief
  "No sky!" toast, once per entry) and the glider cannot deploy. Existing
  hook/zip already in flight is unaffected (edge case: zipping THROUGH a
  doorway is allowed and fun).
- Halls are dark-ish: interior torch light only (per-hall PointLight +
  emissive sconces). Night in a hall ≈ the scariest place in the game.
- Goblin lunges/chases work inside halls (they're just open cells with a
  roof); the danger-zone HP bar already covers the ward (castle region).

## 5. Inhabitants

- **Goblins:** night count `GOBLIN.count 8 → 12`. Spawn/zone changes: each
  goblin's `home` is a **zone** from `WardLayout.zones` (plaza centers +
  corridor junctions), assigned round-robin from the seeded night roll
  instead of the free ring. Patrol radius shrinks (`GOBLIN.patrolR 25 → 8`)
  so they haunt their zone; chase/lunge/leash logic unchanged. **No
  pathfinding** — a goblin that loses the player against a wall gives up
  (existing giveUpR/wall-slide behavior) and returns home; the spec
  explicitly accepts this as "lost him!" behavior.
- **Elves:** `elfHomePosition(i)` re-targets plaza cells — elves distribute
  round-robin across the 3 plazas (deterministic per index, ≥2 m apart).
  Purified plazas fill with dancing elves: the "city squares" read.
- **Gargoyles:** unchanged (towers move outward with the curtain wall; the
  6 fixed perch slots recompute from `castleLayout()` automatically).

## 6. Compatibility & knock-ons

- `CASTLE.half 45 → 90`, `padRadius 80 → 135`, `padBlend 45` (unchanged),
  `regionR 130 → 175`. Terrain near the castle reshapes; the existing
  load-time `snapToGround` covers old saves. Approach-mushroom ring
  `approachR [90,180] → [140,230]`.
- Save format: **unchanged** (no new fields; ward is static content).
- Purified state: all new geometry takes the existing `purified` flag; the
  purify sequence's rebuild automatically produces the purified ward.
- The e2e castle checks re-shoot (bigger castle changes screenshots); the
  `?debug=castle` spawn moves to outside the new gate.

## 7. Testing & debug

- **Pure (Vitest):** map validity (36×36, legend-only chars, counts: 3
  plazas / 2 halls / 1 keep / 1 gate); **BFS connectivity** gate→keep,
  gate→each plaza, gate→each hall; ≥2 distinct gate→keep routes (edge-
  disjoint check); hall doorway count; wall-run merging correctness;
  spatial-hash near-query exactness (near-set ⊇ circles within 10 m);
  `inHall` membership; goblin zone assignment determinism; elf plaza
  distribution spacing.
- **e2e:** corridor screenshot (tightness visible), hall interior at night
  (torchlit), plaza with elves post-purify, existing castle checks updated
  for the new footprint.
- **Debug:** `?debug=castle` spawns at the new gate; `__game.state()` adds
  `inHall` for e2e polling.

## Out of scope (YAGNI)

Goblin pathfinding; minimap or compass; interior furniture beyond
torches/banners/lamps; standing on hall roofs; more than 2 halls/3 plazas
(the map format makes later additions a content edit, not a code change);
secret passages (fun future content edit).
