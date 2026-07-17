# Wildtag

**Wildtag** is a first-person, non-violent creature-tracking exploration game for
the web. You wander a hand-shaped procedural island — meadow, forest, wetland,
crags and highlands — hunting nothing and harming nobody. Instead you *track*:
harvest plant fibre and mineral shards, craft tracker darts, tag skittish
critters with a soft dart, then keep pace inside their tracking ring long enough
to **Link** them into your Field Guide. Linking earns Research Points that
unlock a movement toolkit — a grappling hook, sky boots, a glider, a rocket
boost, deployable ziplines and camera drones — turning the island itself into
the puzzle. Back at **Haven**, a little village at spawn, you can *bond* the
critters you've researched, put them to work on a farm, barter them and their
goods up a no-money reward track, and saddle a sixteen-legged crystal Prismhorse
to ride. It is a game about patience, traversal and the quiet thrill of getting
close to something wild without scaring it off.

The whole thing runs in the browser on WebGL (three.js) with zero external
assets: every mesh, critter, texture-free colour and sound is generated
procedurally at runtime.

---

## Quickstart

```bash
npm i          # install dependencies (three.js + dev tooling)
npm run dev    # start the vite dev server
```

Then open **http://localhost:5199/** and click the canvas to capture the mouse.

Build a production bundle with `npm run build` (output in `dist/`), preview it
with `npm run preview`.

---

## Controls

| Input        | Action                                             |
| ------------ | -------------------------------------------------- |
| `W A S D`    | Move                                               |
| `Shift`      | Sprint (drains stamina)                            |
| `Space`      | Jump — *hold* to Glide once the Glider is crafted  |
| `Q`          | Dash (short stamina-cost burst; available from start) |
| `R`          | Rocket boost (once crafted)                        |
| `RMB`        | Fire the Grapple hook (once crafted) — a projectile that arcs, latches to trees/rocks/terrain/drones, and auto-zips you in; tap again from a hang to re-fire |
| `LMB`        | Throw a tracker dart · confirm a structure placement |
| `F`          | Context interact: harvest a node · **bond** a Linked critter (with a Bond Charm) · **talk** to an NPC · collect a farm hopper · recall a zipline/drone |
| `B`          | **Roster** — your bonded critters (assign to farm, set as mount, release) |
| `V`          | **Mount** — ride / dismount your Prismhorse, or summon/locate it |
| `1` – `4`    | Hotbar (1 Darts · 2 Grapple · 3 Zipline · 4 Drone) — 3/4 enter placement mode |
| `C`          | Crafting menu                                      |
| `Tab`        | Field Guide                                        |
| `Esc`        | Pause / close menu (also cancels a placement)      |

Click the canvas to (re)acquire pointer lock; opening any menu releases it.

---

## Progression

Everything downstream flows from tracking critters, and RP is a **gate**, never a
spent currency — it only ever grows, and crafting checks it without subtracting.

1. **Harvest** — press `F` at fibre, resin, crystal/shard and spark nodes scattered
   across the biomes.
2. **Craft darts** — `C` → *Tracker Dart* (3 Fibre + 1 Resin → 10 darts). You also
   start every fresh game with 4 darts.
3. **Track & Link** — `LMB` throws a dart; a hit *tags* a critter and opens its
   tracking ring. Stay inside the ring's radius until the ring fills to **Link**
   it — that grants Sparks + RP and adds it to your Field Guide.
4. **Tier 1 (25 RP)** — craft the **Grapple Hook** (a Terraria-style projectile
   that arcs out, latches to trees/rocks/terrain/drones, and auto-zips you in —
   hang and re-fire to climb) or **Sky Boots** (an extra mid-air jump).
5. **Tier 2 (75 RP)** — the **Glider** (hold Space to glide) or the **Zipline Kit**
   (deployable two-post cable you can ride).
6. **Tier 3 (180 RP)** — the **Rocket Boost** (vertical + forward impulse) and the
   **Sky Drone** (a hovering deployable that also registers as a grapple anchor).

### Crafting tree

| Tier | Item          | RP gate | Cost                              | Effect                        |
| ---- | ------------- | ------- | --------------------------------- | ----------------------------- |
| 0    | Tracker Dart  | 0       | 3 Fibre, 1 Resin (→ ×10)          | Tag critters                  |
| 1    | Grapple Hook  | 25      | 8 Fibre, 4 Resin, 6 Shard         | Projectile hook + auto-zip (RMB) |
| 1    | Sky Boots     | 25      | 6 Fibre, 8 Resin, 2 Shard         | One extra mid-air jump        |
| 2    | Glider        | 75      | 12 Fibre, 6 Resin, 4 Shard, 2 Spark | Hold-Space glide            |
| 2    | Zipline Kit   | 75      | 4 Fibre, 2 Shard                  | Deploy + ride a zipline       |
| 3    | Rocket Boost  | 180     | 10 Shard, 6 Spark                 | Vertical + forward impulse    |
| 3    | Sky Drone     | 180     | 8 Shard, 8 Spark                  | Hovering drone + grapple anchor |

---

## Haven Village

A small seeded settlement sits in the spawn meadow — five blocky buildings
(Farmhouse, Barter Stand, three homes), dirt paths, lamp posts and fences, home
to **five NPCs**: Mayor Fenn, Farmer Odd, Trader Juno, Old Bram and Kit the Kid.
It anchors the phase-2 loop: research a critter, *capture* it, then put it to
work or trade it up.

The full progression:

1. **Bond** — craft a **Bond Charm** (3 Fibre + 1 Shard + 1 Spark → 2), aim at a
   critter you have already **Linked**, and press `F` to bond it. The charm is
   spent, the critter leaves the wild permanently and joins your **roster** with
   an auto-generated nickname. (Link first, *then* capture — research gates the
   bond.)
2. **Roster** (`B`) — every bonded critter, with per-critter actions: **assign
   to a farm plot**, **set as mount** (rideable species, once you own a Saddle),
   or **release** back to the wild.
3. **Farm** — at the Farmhouse, a plot grid (2 to start, +2 per Plot Deed, max 6).
   Assign a bonded critter and it putters on its plot, producing its species
   resource into the plot hopper on a ~90 s timer (`F` collects). Roles differ:
   haulers produce bulk fibre, others resin/shard/spark, and some are **auras** —
   Mirefin/Emberpup add +25 % speed to adjacent plots (cap +50 %), Bumblewhale
   raises adjacent hopper caps, adjacent Snickerdoodles double each other.
4. **Barter** (no money, ever) — each NPC holds one request (`Bring me N × species`
   or `N × resource`). `F` to talk, then **Fulfill** when you can meet it.
   Delivered critters are **traded away for good** and live on visibly in a pen by
   that NPC's home. Every fulfilment grants the next item on a shared **reward
   track**: Saddle → Plot Deed ×2 → Golden Dart Tip (rings fill 1.5×) → Critter
   Whistle (remote mount summon) → Lantern Charm → then rotating resource bundles.
5. **Mount** — with a Saddle, set a bonded **Prismhorse** as your mount in the
   roster, then `V` to ride it (15 m/s, jump 11, stamina-free; `V` or hold-Space
   to dismount). Walk up and `V` to mount, or — once you own the Whistle — `V`
   summons it to your side. It is ground-bound: never free flight, and it can't
   wade into deep water.

---

## Species

Twelve procedural critters, ordered easiest → hardest. Difficulty rises with
awareness radius, flee speed/style and the tracking time needed to Link. Every
species also has a **farm role** once bonded (produce / aura / none).

| Species       | Biome(s)                     | Flees by       | Difficulty | Farm role |
| ------------- | ---------------------------- | -------------- | ---------- | --------- |
| Snickerdoodle | Meadow                       | zigzags        | Easy       | fibre ×1 (×2 beside another) |
| Puffle        | Meadow                       | stands ground  | Easy       | fibre ×2 |
| Skitterling   | Meadow, Forest               | sprints        | Easy       | resin ×2 |
| Gloomgobbler  | Forest                       | sprints        | Medium     | resin ×3 |
| Bellowbuck    | Forest                       | stands ground  | Medium     | fibre ×4 (hauler) |
| Mirefin       | Wetland, Water               | dives & swims  | Medium     | aura: +25 % speed |
| Bumblewhale   | Wetland (drifts above)       | slow rise      | Medium     | aura: +1 hopper cap |
| Craghorn      | Crags                        | scales ledges  | Medium     | shard ×2 |
| Zephyrfinch   | Meadow, Forest, Highlands    | takes flight   | Hard       | spark ×1 |
| Emberpup      | Highlands                    | zigzags        | Hard       | aura: +25 % speed |
| Prismhorse    | Crags, Highlands             | sprints        | Hard       | none — **the mount** |
| Lumen Stag    | Forest, Highlands, Crags     | sprints        | Legendary  | spark ×2 |

The Lumen Stag is effectively unique world-wide (rarity ~0.02, concurrency
capped) — a rare deep-wood trophy. The **Prismhorse** (horse-sized, 16 legs, a
body of translucent crystal clusters, glowing antennae) is the rideable mount.

---

## Architecture

Wildtag is built on a **pure-core + three-layer** pattern so the game's logic is
unit-testable without a browser, WebGL or DOM.

- **Pure core** (`src/core`, plus the pure halves of movement/grapple/tracking/
  structures/AI): plain `{x,y,z}` math, deterministic PRNG, no `three` import, no
  randomness beyond a seeded hash. All tuning constants live in
  `src/core/constants.ts` and are never inlined elsewhere.
- **System layer**: thin classes that own three.js objects and drive the pure
  core each fixed step (`ChunkManager`, `PropManager`, `CritterManager`,
  `PlayerController`, `ZiplineSystem`, `DroneSystem`, `PlacementSystem`, `HUD`).
- **Wiring** (`src/main.ts`): constructs everything, runs the fixed-timestep
  accumulator loop (`SIM_DT = 1/60`), and routes input → systems → render.

Key modules:

| Area        | Modules |
| ----------- | ------- |
| World       | `world/terrain.ts` (single `heightAt` ground truth), `world/noise.ts`, `world/chunks.ts`, `world/scatter.ts`, `world/props.ts`, `world/resources.ts`, `world/environment.ts` |
| Player      | `player/movement.ts` (pure core), `player/controller.ts`, `player/input.ts`, `player/collision.ts`, `player/grapple.ts` (pure rope), `player/grapple-visuals.ts` |
| Critters    | `critters/species.ts` (data), `critters/ai.ts` (pure state machine), `critters/manager.ts` (streaming world manager), `critters/models.ts`, `critters/animation.ts`, `critters/roster.ts` (pure bonded roster) |
| Tracking    | `tracking/darts.ts`, `tracking/progress.ts` (pure), `tracking/tracker.ts` |
| Crafting    | `craft/inventory.ts`, `craft/recipes.ts` (pure `canCraft`/`craft`) |
| Structures  | `structures/ziplines.ts`, `structures/drones.ts`, `structures/anchors.ts`, `structures/placement.ts` |
| Village     | `village/layout.ts` (pure seeded layout), `village/buildings.ts`, `village/npcs.ts`, `village/barter.ts` (pure requests/rewards), `village/rewards.ts`, `village/pens.ts`, `village/dialog.ts` |
| Farm & mount | `farm/farm.ts` (pure production/auras), `farm/visuals.ts`, `player/mount.ts` (pure ride gates), `player/mount-system.ts` |
| UI          | `ui/hud.ts` (+ pure `ui/hud-math.ts`), `ui/screens.ts`, `ui/guide.ts`, `ui/roster.ts`, `ui/toasts.ts`, `ui/audio.ts` |
| Persistence | `core/save.ts` (pure encode/decode + localStorage glue), `debug.ts` (`window.__game`) |

---

## Development

```bash
npm test         # vitest — the full pure-logic suite (390 tests)
npm run build    # tsc -b && vite build
npm run dev      # vite dev server on :5199
```

### URL dev hooks

Append to `http://localhost:5199/`:

| Query               | Effect |
| ------------------- | ------ |
| `?fresh=1`          | Skip loading the save (always start fresh) |
| `?dev=1`            | Playtest mode: all unlocks, 999 darts, deep material stacks, zipline/drone kits — never saves |
| `?screen=craft`     | Open the crafting menu on boot |
| `?screen=guide`     | Open the Field Guide on boot |
| `?screen=roster`    | Open the roster on boot (seeded with a few bonded critters for a screenshot) |
| `?screen=help`      | Open the pause/help overlay on boot |
| `?preview=critters` | Turntable showcase of all 12 species |
| `?debug=grapple`    | Drop into the crags, auto-fire a grapple and freeze for a static rope shot |
| `?debug=structures` | Auto-place a zipline + drone and frame them |

`window.__game` exposes a debug handle (see `src/debug.ts`): `state()` (now also
reports `rosterCount`, `rewards`, `linked`), `player.{pos,teleport,setStamina}`,
`grant(kind, n)` (plain resource fields incl. `charms`, or a kit via the
`kit:<id>` prefix), `unlockAll()`, `spawn(speciesId, dist)`, `track(id)`,
`completeTracking(id)`, `bond(id)`, `fulfillRequest(npcId)`, `grantReward(id)`,
`farmState()`, `assignFarm(entryId)`, `summonMount()`, `ride()`,
`setTimeScale(f)`, `listCritters()`, `save()`, `reset()`. A companion
`window.__village` exposes `{ center, anchors, talk(npcId), lookAt(x,y,z) }` for
framing village screenshots.

### End-to-end verification

`e2e/verify.mjs` drives the real game in a headless Chromium (SwiftShader WebGL)
and asserts the whole loop — boot, movement, tracking/Link, crafting, structures,
grapple, save round-trip, the full **Haven** loop (village NPCs, bond → roster,
barter reward track + farm-plot unlock, farm production tick, Prismhorse ride,
and a 12-species preview) and a perf smoke — writing a screenshot per phase to
`docs/verify/`.

Playwright is installed **per session, outside this repo** (never a dependency
here):

```bash
# in any scratch directory outside the repo
npm i playwright && npx playwright install chromium

# then, from the repo root:
PLAYWRIGHT_DIR=/abs/path/to/that/dir node e2e/verify.mjs
```

Set `VERIFY_URL=http://localhost:PORT/` to drive an already-running server
instead of letting the script spawn its own `npm run dev`.

> **Headless notes.** WebGL in headless Chromium requires SwiftShader
> (`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`, added
> automatically by the script), which renders this scene at ~11–15 fps — a real
> GPU targets 60. The environment cannot acquire pointer lock, so mouse-gated
> actions (dart throw, grapple *fire*, zipline *confirm*) are exercised via the
> debug handle / `?debug=*` hooks and the pure unit suite rather than synthetic
> mouse input.

---

## Assets & provenance

**Everything is procedural.** There are no imported models, textures, audio
files or fonts beyond the OS monospace stack. Terrain, props, all twelve critters
and their animations, the village and its NPCs, the sky gradient and water, the
UI and the chime are all generated in code at runtime from a single world seed.
Nothing is downloaded and no third-party art is bundled.

## Save data

Progress autosaves to `localStorage` every 10 seconds and on tab close —
inventory, unlocks, linked species, placed structures, position, plus the Haven
state (bonded roster, farm plots/hoppers/deeds, NPC barter requests, traded-away
pen critters, owned rewards and your active mount).

The save is now **version 2** (`v: 2`). `decodeSave` migrates older **v1** saves
in place: it accepts either version, defaults any absent Haven field to empty and
always returns the v2 shape — so a pre-Haven save loads losslessly, keeping every
existing bit of progress. The `localStorage` **key stays `wildtag-save-v1`** on
purpose: the version lives inside the payload, and renaming the key would orphan
the real save under the old name. A missing or malformed save always falls back
to a clean fresh start (it never crashes boot). To wipe your save, open the pause
menu (`Esc`) and use **Reset Save** (a double-confirm), which clears storage and
reloads to a fresh loadout.

---

Known fast-follows (deferred, non-blocking) are tracked in [`FOLLOWUPS.md`](FOLLOWUPS.md).
