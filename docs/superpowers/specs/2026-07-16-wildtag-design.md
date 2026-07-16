# Wildtag — Design Spec (2026-07-16)

Overnight autonomous build. Spencer's brief: a 3D first-person **web** game about exploring a vast
world full of critters and **tagging** them (non-combat) — attach a tracker, stay within a radius
for a duration. High-fidelity movement is the core: dash from the start, stamina, a light crafting
tree (no bronze/iron tropes) unlocking grappling hook, boots, deployable ziplines, and eventually
drones you can grapple to. Rocket boost + glide are allowed; **free flight is never allowed**.
Spencer is asleep; all decisions below were made autonomously, following funnel-crm/canvas-pm
conventions.

## 1. Feasibility & Stack

Yes, this works as a web game. Decision: **Three.js + Vite + TypeScript, no framework, no physics
engine.**

- Three.js (ES modules, current release) for rendering. Low-poly flat-shaded aesthetic
  (mobademo-proven): all models procedural from primitives — zero external assets, zero load time,
  no license concerns. Codex/asset downloads kept as a fallback only; not needed for the demo.
- **Custom kinematic character controller** instead of a physics engine (rapier/cannon). Movement
  feel is the product; grapple swings, ziplines, and gliding are far easier to tune with bespoke
  math than by fighting a rigid-body engine. Terrain collision = analytic heightfield lookup;
  obstacles = sphere/AABB pushout.
- Rejected: React Three Fiber (this is a game loop, not a UI tree); Babylon (heavier, no gain);
  rapier-wasm (would own the player body and make grapple/zipline feel worse).
- DOM overlay for HUD/menus (like funnel-crm's overlay-over-canvas approach).
- Vitest for pure logic TDD; Playwright (per-session install) for e2e against `npm run dev`;
  debug handles on `window.__game`.

## 2. World

- Seeded procedural island, **~2 km × 2 km**, generated from layered simplex noise (deterministic
  seed, pure function `heightAt(x,z)` shared by generation, collision, and AI — no mesh raycasts
  for ground queries).
- Terrain mesh in **chunks** (64×64 m, ~33×33 verts) built around the player; vertex-colored by
  biome; fog + sky dome + day cycle skipped (fixed golden-hour lighting — scope control).
- **Biomes** by height/moisture bands: Meadow (start), Forest, Wetland/lake, Crags (mesa spires —
  grapple/zipline territory), Highlands (glider/rocket territory). Water plane at sea level;
  swimming = slow surface movement, no diving.
- Scatter (deterministic, instanced meshes): trees, rocks, crystal outcrops, glow-flowers.
- Resource nodes (interact `E` to harvest, respawn on timer):
  - **Fiber** — grass tufts/flowers (meadow, wetland)
  - **Resin** — amber blobs on trees (forest)
  - **Shard** — crystal outcrops (crags, highlands)
  - **Spark** — rare motes + reward from tracking creatures (the "creature loop feeds crafting" glue)

## 3. Movement (the core)

Capsule kinematic controller, tuned-constants module (`movement.ts`) fully unit-tested.

- **Base**: pointer-lock mouse look, WASD, walk 6 m/s, sprint 9.5 m/s (drains stamina), jump with
  **coyote time** (120 ms) + **jump buffering** (150 ms), strong air control, fall damage none
  (knockdown stagger only — exploration game).
- **Dash** (available from the start): directional 18 m/s burst, 180 ms, 25 stamina, 0.6 s
  cooldown, works airborne (once per airtime, resets on land).
- **Stamina**: 100 max. Sprint 10/s, dash 25, grapple reel 15/s, rocket boost 40. Regen 22/s after
  a 0.8 s delay; exhausted state (<1) blocks sprint/dash until 20.
- **Grapple hook** (craft): raycast up to 45 m to any terrain/rock/tree/structure/**drone**. Two
  behaviors in one: taut-rope **pendulum swing** when airborne + **reel** (hold) that pulls you in,
  costing stamina. Release preserves momentum. This is the skill-expression centerpiece.
- **Sky boots** (craft): double jump + higher jump + no stagger.
- **Glider** (craft): hold Space while airborne to deploy; descent-only (vertical speed clamped to
  [-2, 0] m/s gravity-relative, i.e. always sinking), forward 12–16 m/s, banking turns. No stamina
  drain, but you can never gain height with it.
- **Rocket boost** (craft): double-tap Space / dedicated key — one big upward+forward impulse
  (+14 m/s vertical), 40 stamina, 4 s cooldown, max 1 charge airborne. Chains: rocket → glide →
  grapple a drone → swing → dash. **No hover, no sustained thrust — flight is impossible by
  construction** (glide always sinks, rocket is impulse+cooldown, grapple needs an anchor).
- **Zipline riding**: interact at an anchor, ride at 14 m/s with gravity assist on slopes, jump off
  anytime (momentum preserved).

## 4. Critters & tracking

- **8 species**, procedural blocky models (mobademo `buildBlockEnemy` style) with procedural
  animation (leg swing, bob, ear flicks). Species define: size, speed, biome, awareness radius,
  flee style, rarity, and the tracking parameters.
- Roster (name / biome / behavior / difficulty):
  1. **Puffle** — meadow; docile grazer; tutorial-easy (R 12 m, 8 s)
  2. **Skitterling** — meadow/forest; skittish, short panic sprints
  3. **Bellowbuck** — forest; large strider, walks fast, doesn't panic but never stops
  4. **Mirefin** — wetland; swims lake surface, forces shoreline play
  5. **Craghorn** — crags; mesa climber, ledge-hops (grapple/zipline required in practice)
  6. **Zephyrfinch** — flocking flyer, low-altitude loops; needs glider/rocket to stay in radius
  7. **Emberpup** — highlands; fast, curious-then-bolts; dash-heavy chase
  8. **Lumen Stag** — rare roamer, spawns far, huge awareness; the endgame trophy
- **AI**: lightweight state machine per critter — `idle/graze → wander → alert (sees you inside
  awareness radius) → flee (species-specific: sprint bursts, zigzag, fly-off, swim) → calm`.
  Fleeing uses terrain-aware steering (never into deep water unless swimmer, avoids cliffs).
  ~70 active critters streamed around the player from deterministic spawn tables.
- **Tracking loop** (the whole game):
  1. Craft **tracker darts** (Fiber+Resin). Throw (LMB) — projectile with arc; hit attaches a
     blinking tracker.
  2. A **progress ring** appears (HUD + above critter): stay within the species' radius R for
     cumulative T seconds. Inside radius: fills; outside: **decays at half speed** (not reset —
     feels fair). Tagged critters remain tagged until completed.
  3. Completion = **Linked**: fanfare, critter calms permanently, awards **Sparks + Research
     points**, entry unlocked in the **Field Guide** (Tab).
- Research points gate the crafting tiers → the loop: track easy critters → unlock mobility →
  reach hard critters.

## 5. Crafting & structures

Light, nature-tech themed, one screen (`C`), no benches/stations. Recipes = resources + research
tier. Tree (3 tiers, 9 items):

- **Tier 0** (start): Tracker Dart (consumable, 3 Fiber + 1 Resin, craft in batches)
- **Tier 1** (25 RP): **Grapple Hook** (8 Fiber, 4 Resin, 6 Shard); **Sky Boots** (6 Fiber,
  8 Resin, 2 Shard)
- **Tier 2** (75 RP): **Glider** (12 Fiber, 6 Resin, 4 Shard, 2 Spark); **Zipline Kit** (per-kit:
  4 Fiber, 2 Shard — max **3 lines** deployed); **Field Beacon** (fast-travel-lite: respawn/compass
  marker, max 2) — *stretch*
- **Tier 3** (180 RP): **Rocket Boost** (10 Shard, 6 Spark); **Sky Drone** (8 Shard, 8 Spark, max
  **2** deployed) — deployable hovering anchor: place it, it rises to ~25 m and holds station;
  grapple-able like terrain. The intended chain for reaching flyers/mesas.
- **Structures**: placement mode with ghost preview + validity check; limited counts (above);
  recall (E, hold) refunds the kit. Ziplines: place anchor A, then B within 80 m with line-of-sight.

## 6. HUD / UI

Crosshair (state-colored), stamina bar, hotbar (1–4: darts / grapple / zipline / drone), resource
counters, tracking rings (screen-projected above critters + list edge indicators when offscreen),
compass strip with tagged-critter pips, Field Guide (Tab), Crafting (C), pause/help (Esc) with
keybind list, first-run hint toasts ("Throw a dart at that Puffle"). All DOM overlay, minimal CSS,
readable > pretty.

## 7. Persistence & debug

- localStorage save: inventory, RP, unlocks, linked species, placed structures, player position.
- `window.__game` debug handles (Playwright + console): `player` (pos/teleport/setStamina),
  `spawn(species, dist)`, `grant(resource, n)`, `unlockAll()`, `track(id)`, `state()` snapshot,
  `setTimeScale(f)`. Deterministic world seed fixed at build.

## 8. Testing

- **Vitest (TDD)** for all pure logic: stamina model, dash/cooldown rules, glide clamps, grapple
  rope math, tracking ring accumulate/decay, crafting affordability/unlocks, terrain `heightAt`
  determinism, AI state transitions, zipline traversal param, placement validity.
- **Playwright** e2e (per-session install): boot → canvas renders (non-blank pixel), pointer-lock
  sim via debug handles, dart-hit → ring fills → Linked flow, craft flow, zipline ride, structure
  limits. Screenshots for the morning report.

## 9. Success criteria (what "full working demo" means at wake-up)

1. `npm run dev` in `~/projects/wildtag` → walk around a vast varied island at 60 fps-ish.
2. Full movement kit with tuned feel: sprint/dash/stamina/jump/coyote from minute one; grapple,
   boots, glider, rocket, ziplines, drones all craftable and functional.
3. All 8 species present with distinct behavior; tracking loop complete with Field Guide.
4. Crafting tree + RP gating creates a real 20–40 min progression arc.
5. Vitest suite green; Playwright verification run with screenshots; README with controls.
