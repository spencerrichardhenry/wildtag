# The Cursed Castle — Design Spec

**Date:** 2026-07-25
**Base branch:** `feat/cursed-castle` (off `build/fidelity-2`)
**Requested by:** Spencer's kids

## Summary

A large cursed castle appears in the world, home to catchable **gargoyles**. A new
**day/night cycle** brings out **goblins** at night who attack the player, introducing
a kid-friendly **HP system**. A craftable **purifying dart** turns goblins into
**happy elves** who settle the castle grounds. A **dark crystal** in the keep can be
purified with a single dart at any time, permanently transforming the castle into a
bright **elf city**.

Decisions locked with Spencer:

- HP fail state: **dazed + escorted out** (no death, no item loss).
- Night: **full automatic day/night cycle** (not a local curse bubble).
- Elves: **settle the castle permanently** (persisted; become elf-city residents).
- Crystal: **direct dart, no gate; transformation permanent**.
- Architecture: **goblins are a new hostile module**, NOT critters; gargoyles ARE
  regular critters.
- Mushrooms become **forageable** and are a purifying-dart ingredient.
- The world gets a **grandeur rescale**: trees range up to 10–15× player height,
  terrain features grow to match, castle towers ~10× player height.

## Non-negotiable invariants preserved

- **No free flight** — every new traversal affordance (castle walls as grapple
  anchors, gargoyle glides) obeys existing grapple/glide constraints.
- **Critters stay non-violent** — the critter system gains no combat concepts.
  Goblins live in a separate subsystem and are not trackable, linkable, charm-able,
  or roster-visible.
- **All tuning constants in `src/core/constants.ts`.**
- **`heightAt(x,z)` is the only ground truth** — no mesh raycasts for gameplay.
- **Pure logic modules never import `three`** and are Vitest-TDD'd.
- **All models procedural** from three.js primitives (no external assets).

## 1. The castle (`src/castle/layout.ts`, `src/castle/builders.ts`)

- Procedural stone castle in the Haven-buildings style: square curtain wall,
  4 corner towers, gatehouse, central **open-roofed keep** holding the dark crystal.
- **Scale: imposing.** Corner towers and the keep reach ~10× player height
  (≈17–20 m); curtain walls ≈8 m; footprint roughly 80–100 m on a side. It should
  dwarf the player and read from far across the island.
- Placed on elevated terrain a few hundred meters from spawn, roughly opposite
  Haven, so it reads as "the far scary place." Exact site chosen during
  implementation by sampling `heightAt` for a suitably prominent hill; position
  becomes a constant (`CASTLE.center`).
- Walls, towers, and battlements register with `PropManager.getGrappleColliders`
  — climbing the castle is a grapple movement puzzle.
- Terrain interface: castle sits on a flattened analytic pad (same approach as
  Haven) so `heightAt` remains authoritative inside the grounds.
- Two visual dressings for every castle piece: **cursed** (dark stone, ember
  windows) and **purified** (bright stone, ivy, banners, warm lights). Builders
  take a `purified` flag; swapping is a rebuild, not a material hack.

## 2. Day/night cycle (`src/core/daylight.ts` + lighting/environment consumers)

- Pure module: `daylightAt(elapsedSeconds) → { phase, darkness, sunAngle }` where
  phase ∈ day | dusk | night | dawn and darkness ∈ [0,1].
- Cycle lengths (constants, tunable): ~8 min day, ~1 min dusk, ~4 min night,
  ~1 min dawn. Clock persists in the save so reloading doesn't reset time.
- `world/lighting.ts`: sun intensity/color lerp with darkness; cascade shadow
  system inherits the dimmed sun unchanged across all three quality presets.
  Night keeps a faint cool "moonlight" floor so the world stays readable.
- `world/environment.ts`: sky dome gains a night palette (3 stops) lerped by
  darkness; moon disc (reuses sun-disc technique); small starfield (points)
  faded in at night; fog color follows the sky horizon.
- HUD: small sun/moon arc indicator so kids can see night coming.
- Time scale respects the existing `setTimeScale` debug handle.

## 3. Gargoyles (critter system additions)

- New species in `src/critters/species.ts` + builder in `models.ts`: stone-gray,
  folded bat wings, horned brow, glowing amber eyes. Chunky-cute per the round-2
  Neopets-style pass.
- Entire existing loop applies unchanged: tracker darts, tracking ring, Link,
  Bond Charms, pens, barter requests.
- New **perch** behavior in `critters/ai.ts`: gargoyles idle on assigned perch
  points (tower tops, battlements — provided by castle layout), occasionally
  **gliding** to another perch along a descending path that reuses existing
  glide-style constraints (no altitude gain; no free flight).
- Active day and night; unaffected by purification (they remain as friendly
  city guardians after the transformation).

## 4. Goblins & player HP

### Goblins (`src/castle/goblins.ts` — pure FSM; presentation in castle manager)

- Spawn around castle grounds at dusk (cap ~8), despawn at dawn. Unpurified
  goblins are not persisted individually — each night spawns a fresh patrol.
- FSM: `patrol → alert (player within ~20 m) → chase → lunge → recover`.
  Chase speed is below player sprint speed so escape is always possible.
- Lunge: short telegraph, then a hop-attack; on hit applies damage + knockback.
  Goblins never leave a generous castle-region radius (constant) — the rest of
  the world stays safe at night.
- Model: small, chunky, green, big ears, tattered hood — menacing-but-cute.
- Purified by a purifying dart hit (see §5). Never drops anything; no player
  attack can harm them — purification is the only interaction.

### Player HP (`src/player/health.ts` — pure)

- `maxHp` constant; damage from goblin lunges only (nothing else in the game
  deals damage). Slow regen after an out-of-combat delay.
- HUD HP bar appears only when relevant: after first damage, or within the
  castle region at night; fades out when full and out of danger.
- **0 HP → dazed:** input suppressed ~3 s, screen dims/desaturates, player
  auto-stumbles a short distance away from the castle center, HP refills to
  full, control returns. No death, no respawn teleport, no item loss.

## 5. Purifying darts & elves

- **Forageable mushrooms:** the existing glow-mushroom clusters become
  harvestable resource nodes (`mushroom` joins fiber/resin/shard/spark as a
  `ResourceKind`, using the same deplete/respawn `NodeState` system and harvest
  cone). Forest remains their home biome; spawn caps rise enough (and clusters
  also scatter along the castle approach) that stocking up for darts is a
  pleasant forage loop, not a grind.
- New recipe in `src/craft/recipes.ts`: **Purifying Dart ×5**, RP-gated at a
  mid tier. Ingredients: **glow mushrooms** plus existing gatherables
  (e.g. 3 mushroom + 2 shard + 1 fiber; exact mix playtest-tuned).
- Ballistics reuse `tracking/darts.ts` spawn/step exactly (same feel); the
  payload differs: on goblin hit → sparkle burst → goblin replaced by an elf.
  On critter hit: harmless sparkle (critters are already pure). Purifying darts
  are a separate inventory item occupying their own slot in the existing
  Digit1–4 hotbar, selected exactly like other hotbar tools.
- **Elves** (`src/castle/elves.ts`): each purified goblin becomes a persistent
  happy elf who wanders/dances around the castle grounds day and night,
  reusing the village NPC wander/idle patterns. Elf count (and enough state to
  respawn them) is saved. Elves are ambient — no dialog/barter in this phase.

## 6. Dark crystal & permanent transformation

- Pulsing dark crystal on a plinth in the open-roofed keep; reachable by
  grapple-climbing walls, sneaking past goblins, or purifying the patrol first
  — **no gate**: one purifying dart hit purifies it at any time.
- Purification sequence: flash + radial sparkle wave → every present goblin
  simultaneously bursts into an elf → castle rebuilds with purified dressing →
  ambient near the castle brightens (purified castle region reads warm even at
  night). Goblins never spawn again.
- All previously purified elves plus the finale batch become the elf city's
  residents.
- State: `castlePurified: boolean` in save — permanent, no reset.

## 7. World grandeur rescale

The world currently reads "small and clean": trees top out ≈7 m (~2–4× the
1.65 m player) and crag spires at ~55 m. Kids want person-scale grandeur —
short trees AND giants, with mountains that still dwarf them.

- **Trees** (constants + `props.ts` builders): per-biome height tiers replace
  the flat `scale.tree [0.85, 1.6]` band:
  - *common* ≈4–9 m (bulk of spawns),
  - *tall* ≈10–16 m,
  - *rare giants* ≈20–28 m (10–15× player; roughly one per few chunks, biome
    flavored — ancient oak, great pine, elder willow) with proportionally
    thicker trunks. Giants are grappleable like all trees, so their crowns
    become chain-climb playgrounds (no free flight — existing constraints).
  - Per-chunk tree caps drop slightly to keep density from choking views;
    BatchedMesh consolidation absorbs the added geometry.
- **Terrain** (`TERRAIN` constants only; `heightAt` formula unchanged):
  feature wavelength up ~30% (baseFrequency 1/260 → ≈1/340) and crag spires
  roughly doubled (cragSpire 55 → ≈100) so peaks remain 3–4× the tallest
  giants. Mesas/boulders scale up ~2×. Island radius unchanged.
- **Knock-on audit (explicit implementation tasks):** grapple reach vs giant
  crowns and taller crags (chain-climb must still summit everything
  grappleable); Haven pad, castle pad, zipline/drone anchors, and barter pens
  re-validated against the reshaped `heightAt`; existing saves load with
  positions snapped to the new ground height; e2e biome screenshots refreshed.
- Movement constants are NOT retuned preemptively — a playtest-tuning task at
  the end adjusts only what the audit or feel demands.

## 8. Save (v3)

- Save bumps to v3 (same localStorage key, migrates v2 → v3, which migrates v1).
- New fields: day/night clock time, purifying-dart inventory + recipe unlock
  (existing inventory/unlock structures), elf count/state, `castlePurified`.

## 9. Testing & debug

- **Vitest (TDD, pure):** daylight clock math, goblin FSM transitions, chase
  speed invariant, HP damage/regen/dazed logic, purify interactions, recipe
  gating/costs, crystal state machine, elf persistence, save v2→v3 migration
  (including position ground-snap), mushroom node harvest/respawn, tree-tier
  selection math.
- **Playwright (`e2e/verify.mjs`):** new asserted checks + screenshots —
  castle by day, night sky at castle, goblins spawned at night, HP bar visible
  after a hit, purified elf city. Driven via debug handles.
- **Debug handles:** `__game.setTimeOfDay(phaseOrDarkness)`,
  `__game.spawnGoblin()`, `__game.grantPurifyingDarts(n)`,
  `__game.purifyCrystal()`; `?debug=castle` teleports to the castle.

## Out of scope (YAGNI)

- Elf dialog, barter, or quests; goblin variants/bosses; player weapons of any
  kind; interior castle rooms (keep is open-roofed); weather; sleeping to skip
  night; multiple castles.
