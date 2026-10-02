# Tiny Tide

A mobile-first 3D eat-and-evolve adventure at `/tiny-tide.html`. Design a tiny
creature on the seabed. Eat to earn DNA, spend DNA on new parts, and grow
through five sizes until your creature eats all 12 planets.

The design of this update is in [TINY-TIDE-EVOLUTION.md](TINY-TIDE-EVOLUTION.md).

## Play

Run `npm run dev` and open `http://localhost:5199/tiny-tide.html`.

- **Move:** drag the left joystick, or use WASD / arrow keys.
- **Look:** swipe or drag the world. Swimming/flying forward follows the camera,
  including its pitch, so the habitat can be explored in three dimensions.
- **Eat or bite back:** hold Chomp / Space near food or near a creature that attacks you.
- **Change depth:** hold Rise / E or Dive / Q. Releasing the controls hovers.
- **Orca-size breach:** at the Big size, tap Breach / E and hold Chomp to catch seabirds.
- **Edit your creature:** the pencil button. **Evolve:** the Evolve button when the DNA bar is full.
- **Pause:** the pause button, Escape, or P. Backgrounding the game pauses it.

## Your creature

The creature editor has three tabs:

- **Parts:** 34 Blender parts in 11 groups (mouths, eyes, fins, tails, legs,
  arms, armor, senses, wings, jets and cosmic parts). Choose a card, then tap
  the creature, or drag the card onto it. Drag a placed part to move it. The
  toolbar changes size and turn, makes a mirrored pair, or removes the part.
- **Body:** add or remove spine segments, and change the width, height and
  arch of each segment. Drag a glowing dot to shape the body directly.
- **Paint:** body, belly and accent colors, and four patterns. Paint is free.

Parts cost DNA. Removing a part refunds the credit it still holds (see
[The ledger](#the-ledger)). Each size has a complexity limit and a body-length
limit. The creature must have one mouth.

The mouth sets the diet. Herbivores eat plants, carnivores eat meat, and
omnivores eat both for 70% of the DNA. Everyone eats the Huge-size landmarks
and the planets. Parts also give stats: speed, bite, reach, armor, health
(hearts), sense (how far away you notice hunters) and stealth (how close a
hunter must be to notice you).

## The living ocean

| Size | Plants | Meat | Danger |
| --- | --- | --- | --- |
| Tiny (2 cm) | sprouts, kelp, grapes, lettuce | copepods, bristle worms | crabs hunt you, jellies sting |
| Small (30 cm) | grape clusters, lettuce beds | shrimp, crabs, jellies, snails | squid hunt you, crabs pinch back, rays sting |
| Big (8 m) | kelp fronds, sprout groves | tuna, squid, rays, gulls | squid hunt you, rays sting |
| Huge (120 m) | palms, sailboats, seaplanes, balloons, lighthouses (any diet) | | seaplanes chase you |
| Cosmic | 12 planets | | — |

Prey runs away from a creature that can eat it, but it tires quickly. Food
regrows out of sight. Hunters show a red **!** marker. Chomp a creature that
attacks you to bite back. Defeating a crab, jelly, squid or seaplane can unlock
a part before its size. When you lose every heart, you wake up at the size's
start point with 70% of your DNA. Your stage and your design stay.

Every new adventure has a seed. The seed places biomes such as kelp forests,
coral gardens, crab flats and squid deeps. Biomes change the food and the
danger, the reef scenery and the water tint.

## World

The universe is constructed once per adventure. Every tier shares physical
coordinates. During evolution, the world scales smoothly around the
character's physical location; small reef details are culled as they become
insignificant. The camera remains near the player, and the visible world
changes from seafloor to open water, surface, sky and space.

The creature body is generated at runtime from its genome as a skinned mesh
with one bone for each spine segment. All parts, food, scenery and planets
are original Blender GLBs. Parts and the body move with procedural animation.
The models preload once before play; editing and evolving make no network
requests. Water, caustics, light shafts, particles and sound remain runtime effects.

The editable source is `art/tiny-tide/tiny-tide-art.blend`. See
[the authoring notes](TINY-TIDE-ART.md) for rebuilding, asset inventory and checks.

Progress saves locally when browser storage is available (see [Saves](#saves)).
A fresh adventure replaces the save and makes a new world.

## Body plans and lines

Each evolution picks a body plan. The plan sets the habitat, the movement, the
body rules, the part rules and the lineage commitments. The data is in
`src/tiny-tide/plans.ts` (plans) and `src/tiny-tide/profiles.ts` (habitat and
movement profiles). The full design is in
[the evolution core spec](superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md).

| Size | Plan | Line | Main rules |
| --- | --- | --- | --- |
| 0 | Speck | root | Seabed. The start. |
| 1 | Swimmer | swimmer | Free water. Needs a tail. Commits "Can never grow legs again". |
| 1 | Crawler | crawler | Seabed. Needs legs. Seabed food ×1.25. Commits "Never swims freely or flies". |
| 2 | Darter | swimmer | Speed ×1.15, quick turns. Thin body (radius ≤ .7). Breach. |
| 2 | Bulk | swimmer | Hearts +2, knockback resistance .6, mass ×1.5, speed ×.9. Wide middle, 8 middle slots. Breach. |
| 2 | Shellback | crawler | Needs armor 2 or more from parts. Armor +2. Speed ×.8. Fixed wide middle. Seabed food ×1.25. |
| 2 | Burrower | crawler | Stealth +2, hearts −1 (5 base), speed ×.95, no fins. Seabed food ×1.4. |
| 3 | Sky drifter | swimmer | Water and air (flies). No legs. |
| 3 | Colossus | crawler | Seabed and land, wades. Armor +1, hearts +1. No wings or jets. |
| 4 | Star swimmer | swimmer | Space. No legs. |
| 4 | Star crawler | crawler | Space, slow (×.85). Armor +1, hearts +1. No wings. |

The Shore-walker line (Shore-walker, Strider, Mudskipper, Dune giant, Shore
giant, Star walker) needs the coast. This build has no coast
(`COAST_READY = false`), so the path screen does not show it.

A run keeps every commitment on its path. A plan that breaks a commitment is
not eligible. Effective stats are the part stats plus the plan bonuses. Maximum
hearts are `max(3, 6 + round(health))`.

**The path screen.** When the growth bar is full, Evolve opens the path
screen. Each eligible plan has a card with "Playstyle" (up to three gains),
"This form's cost" (up to two losses), "Lasting sacrifice" (a new commitment,
or "None new" with the inherited ones) and "Leads to". "Details" shows all
changes, a preview and the DNA result. "Choose your diet now": the evolve
editor accepts any unlocked mouth. "Not yet" goes back to play.

## Habitats and movement

**Borders.** One admission test decides where a body can be. It tests the whole
body (one capsule per spine segment, with the swim-wave envelope) against the
ground, the water, the land band, the air, space and the world bounds. The
simulation never installs a pose that the test refuses. A blocked move stops at
the border and slides along it where the border allows.

**World edge.** The world bound is a square at ±50 stage-local units
(`PLAYER_HALF`). It is not felt as a wall. From 0.8 × the bound (40 units,
`EDGE_SOFT_START`), a current pushes the creature back toward the centre, on
each horizontal axis separately (in a corner, both axes push). The current
rises with a smoothstep from 0 at 40 units to 30 units/s at the bound
(`EDGE_CURRENT_MAX` × size). That is more than the fastest possible top speed
(about 15.2 units/s), so a creature that swims or walks straight at the edge
settles before the bound: a starter Swimmer or Crawler at about 43 units, a
Darter at about 43.3 units, and a Darter at the highest speed factor at about
44.8 units. The current is added to the movement in every stage and for every
plan, and it is not stored in a velocity. When the input is released, the
creature drifts back inward. The admission bound stays as a safety net. In the
push zone the water gets darker and the fog gets thicker. The seabed, the reef,
the islands and the water surface fade into the fog between 50 and 58 units
from the centre. Space (the stars and the sun) does not change. New food and
creatures are placed inside 40 units (`SPAWN_HALF`), and a tap-to-walk target
is clamped there too.

**Hints.** When a move hits a border, a toast says why (at most one each 6 s).
The world-edge hint also shows in the edge's push zone:

| Border | Hint |
| --- | --- |
| World edge | "That's the edge of the world for now." |
| Sky limit | "That's as high as you can go for now." |
| Ground | "Something solid is in the way." |
| Water surface | "<Plan>s can't leave the water." |
| Air | "<Plan>s can't fly." |
| Land | "<Plan>s can't go on land." |
| Floor gap | "<Plan>s stay on the seabed." |
| Depth | "<Plan>s stay in shallow water." |

**Movement.** Ground plans (Speck, Crawler, Shellback, Burrower, Colossus) stay
on their support height. Swim, fly and space plans move in three dimensions:
hold Rise / E or Dive / Q, and forward follows the camera pitch. Each movement
profile sets speed, acceleration, braking and turn rates.

**Breach.** Darter and Bulk (size 2, free water) Breach instead of Rise: tap
Rise / E. A Breach is a 1.8 s arc (`BREACH_SECONDS`) that rises 3.8 × the
size scale above the surface (`BREACH_RISE × size`) and ends 1.3 × the size
scale under it (`BREACH_END_DEPTH × size`).
An air permit lasts 1.9 s. The cooldown is 2.3 s (`BREACH_COOLDOWN`). When the
permit ends, the game checks the landing and recovers the pose if needed.

**Recovery.** When a pose stops being legal (for example, after a design
change, a growth step or the end of a Breach), the game looks for the nearest
legal pose: the current orientation, then level, then the start anchor. If all
fail, the game enters a stuck state and tries again each second. It never
installs an unchecked pose.

**Start anchors.** Each size has a start anchor: the nearest legal pose to a
point just above the ground at the origin (in space, `(0, 3 × size, 0)`). A
design is valid for a plan only if an anchor exists at growth 1 and at growth
1.38. Respawn uses the anchor, with 3 s of grace.

## Avoidance

Hunters perceive the player within their notice distance (times the stealth
factor), chase while they remember, wait at borders they cannot cross, and give
up after their memory, leash or give-up distance (`hunter` policy: memory 6 s,
blocked wait 3 s, reacquire 2 s, leash 30 and give-up 12 body lengths). A test
(`tests/tiny-tide-core/avoidance.test.ts`) steps the real hunter and the real
player step: a player that flees at the notice distance must escape.

To pass that test, Task C5 slowed two hunters (`src/tiny-tide/species.ts`):

| Hunter | Speed before | Speed now |
| --- | --- | --- |
| `1:crab` (Peach crab) | 2.2 | 1.3 |
| `2:squid` (Berry squid) | 3.2 | 1.1 |

`3:plane` stays at 2.6. The species speed also sets the wander and flee
speeds, so crabs and squid also wander and flee more slowly. Earlier (Task B7),
the size-2 tuna count went from 10 to 13 (`2:fish`, count 13).

## Diet

The diet is the mouth's diet. It is fixed at each evolution. In a normal edit,
only a mouth with the same diet can replace the mouth ("Diet is set until your
next evolution."); a same-diet swap keeps the mouth's position. In the evolve
editor, any unlocked mouth is allowed. Herbivores eat plants, carnivores eat
meat, omnivores eat both at 70%. Everyone eats `any` food (size 3 landmarks and
planets). A meal earns `round(dna × diet rate × foraging bonus)`, rounded once.

## Part size

The editor's size slider (.4 to 1.8) changes a placed part:

- Stats: `copies × (.75 + .25 × scale)`.
- Cost: `round(cost × copies × (.5 + .5 × scale))`.
- Slots: `copies × (scale > 1.4 ? 2 : 1)`. Complexity counts slots.

A mirrored pair is two copies. The tool shows cost and slots while the slider
moves.

## The ledger

DNA has provenance (`src/tiny-tide/economy.ts`):

- Meals add DNA "at risk". Evolution banks all of it.
- Each installed part has a basis (what it is worth) and a credit (what a
  refund can return). A design change releases credit before it buys parts.
- Unchanged parts cost 0. A smaller part releases
  `floor(credit × (oldBasis − newBasis) / oldBasis)`.
- A faint keeps 70% of each wallet part. Stage and design stay.
- Every commit checks the result. An invalid or unaffordable design changes
  nothing.

## Editor controls

| Input | Result |
| --- | --- |
| Tap a card, then tap the body | Place the part (a pair if the part mirrors). |
| Drag a card onto the body | Place the part. |
| Enter on a focused card | Place the part at its usual spot, or in the nearest region with room. |
| Left drag on a part | Move the part. |
| Right or middle drag; two-finger drag | Turn the model. A second finger cancels and rolls back a part, handle or card drag. |
| Wheel; pinch | Zoom. |
| Delete or Backspace | Remove the selected part. |
| Ctrl/Cmd+Z, Undo | Undo. |
| Escape | Close the pair prompt, then stop placing, then close the editor. |

Region chips (for example `Head 3 / 4`) are always visible. Two rings show the
region borders while you place or drag. Kinds the plan bans are hidden, with a
note. Every problem is listed on desktop; phones show one line. If only one
copy of a pair fits, the editor asks "Place one?". In the evolve editor,
**Undo all** returns to the current design and **Fix for me** reapplies the
automatic adaptation. Done is enabled only for a valid, affordable design with
a start anchor. If the commit fails, the editor stays open with its draft and
undo history.

## Saves

- Version 4 (key `tiny-tide-adventure-v4`). It adds `nextPartSerial`,
  `pendingRespawn`, `mechanics`, `archive`, `notices` and the DNA ledger. Load
  and every commit use the same strict validator.
- **Migration.** A v2 save (`tiny-tide-adventure-v2`), or a v1 save
  (`tiny-tide-adventure-v1`) through the v1 reader, migrates once at load:
  1. The original design is repaired and archived.
  2. Legs and no tail choose the Crawler line; otherwise the Swimmer line.
  3. The best path to the saved size keeps the most part value.
  4. The ledger keeps the original's value; removed parts are refunded, added
     required parts are paid, and a shortfall becomes banked credit.
  5. The result is written to the v4 key.
- **Archive.** The home screen shows "View your original <name>": a preview,
  the paint and "Copy design".
- **Notices.** Changes from a migration show once under "WHILE YOU WERE
  AWAY", until "Got it".
- **Kept saves.** A save this build cannot use (for example, a coast path) is
  kept untouched. A new run then saves to `tiny-tide-adventure-v4-fresh`. If
  both v4 keys are unreadable or kept, the game does not save that session and
  says so.
- **Legacy keys.** The game never writes `-v1` or `-v2`. Legacy keys are read
  only when no v4 key exists.

## Pacing (baseline)

The pacing study (`node e2e/tiny-tide-pacing.mjs`, spec §12) is a diagnostic,
not a gate. It plays each size-2 branch with the journey bot (Snapper at size 1,
Beak at size 2) for seeds 11, 12 and 13, once with no optional purchases
(`none`) and once with a fixed shopping list (`sensible`):

| Line | Size 1 | Size 2 (by branch) | Size 3 |
| --- | --- | --- | --- |
| Swimmer | Side fin pair (middle) | Darter: Fan tail replaces Paddle. Bulk: Shell plate (middle) | Feather wing pair |
| Crawler | Spike (middle) | Shellback: Shell plate (middle). Burrower: Cloak fronds (middle) | Tower |

It runs 24 runs, 4 at a time, then 4 calibration runs one at a time. A
read-only sampler reads `window.__tinyTide` on each frame. It writes
`.codex-drafts/tiny-tide-qa/pacing.json` (every number per run and size: active,
editor and wall time, food mix, travel and feeding time, seconds with
`contactNow`, damage, faints, armor prevention, foraging bonus DNA, vertical
meals, purchases and the DNA of each evolution) and `pacing.md` (the tables).
`--summarize` rebuilds both from the saved runs.

Baseline (commit `57c1e7b`, 2026-10-01). Mean active seconds (game time in
play) per size, `none` / `sensible`, over 3 seeds. All 24 runs finished.

| Branch | Size 0 | Size 1 | Size 2 | Size 3 | Size 4 (Cosmic) | T_none | T_sensible | T_none / T_sensible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Darter | 46 / 47 | 61 / 86 | 99 / 74 | 23 / 33 | 39 / 36 | 267 | 275 | 0.97 |
| Bulk | 43 / 49 | 59 / 99 | 84 / 88 | 26 / 23 | 25 / 24 | 238 | 283 | 0.84 |
| Shellback | 34 / 31 | 23 / 32 | 33 / 32 | 30 / 29 | 27 / 30 | 148 | 155 | 0.96 |
| Burrower | 38 / 39 | 44 / 38 | 28 / 22 | 33 / 29 | 26 / 27 | 170 | 155 | 1.10 |

Watch bands (not gates): first evolution 45–120 s; sizes 1–3 each 60–240 s.
With this bot, Darter sizes 0–2 and Bulk size 2 are inside the bands. Bulk
size 1 is inside with `sensible` and just below with `none` (59 s). Bulk size 0
is 43 s with `none` and 49 s with `sensible`; no purchase happens at size 0, so
that difference is noise. Size 3 is below the band on every branch. The Crawler
line is below the band at every size.

The runs are not deterministic: frame timing changes the simulation, so the
same seed and policy gave 192 s and 249 s of total active time (Darter, seed
11, `none`). The ranges are wide; for example, Bulk size 1 with `sensible` was
40–182 s. With 3 seeds, the T_none / T_sensible ratios (0.84–1.10) are inside
this noise and do not show an effect of the purchases. `pacing.md` gives the
min–max of every mean.

Two columns are derived, not observed. "Vertical meals" counts the meals of a
target for which the bot itself used Rise, Breach or Dive because of the
target's height. "Damage" and "armor prevented" are approximate: each accepted
hit takes the raw damage of the hazard source nearest the player, and
`damageAfterArmor(raw, armor)` gives the damage after armor. A wall-time calibration run is 1.09–1.12 × its active time alone
and 1.16–1.27 × in the parallel batch.

Known limits: the bot eats the nearest food and does not flee, so it is
faster than a new player. A single Spike at size 1 gives no mitigation (armor
1 removes `floor(1 / 2) = 0`). Shellback's Shell plate adds armor that today's
hazards cannot use (every hit already costs the 1-point minimum). The shopping
lists are reference builds, not optimal ones. The study proposes no tuning;
the owner decides.

The baseline above was measured before the seabed slide fix: at that time a
Swimmer stopped on a seabed slope, and the bot rose (or Breached) on every
seabed contact. The bot no longer does this, so a new run can differ.

## Verification

```sh
npx tsc -b
npx tsc -p tsconfig.tests.json
npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-core
npm run build                              # the chunk-size warning is expected
python3 scripts/tiny-tide/blender/check_assets.py   # PASS: 86 self-contained Blender GLBs; fails on a stale part-rig.json
node e2e/tiny-tide.mjs                     # swimmer line; TIDE_LINE=crawler for the crawler line (long: run in the background)
node e2e/tiny-tide-paths.mjs               # 18 checks; pass check ids (for example 3 7b) to run some
node e2e/tiny-tide-mobile.mjs
node e2e/tiny-tide-replay.mjs
node e2e/tiny-tide-pacing.mjs              # the pacing study (a diagnostic, not a gate; long: run in the background)
```

The browser tests need the dev server (`npm run dev`, port 5199). Their save
fixtures come from the development-only page `tests-browser/fixtures.html`,
which builds runs with the game's own modules (`makeFixture(spec)`) and finds
hazard encounters (`pickHazard(spec)`). The tests write a fixture into
`localStorage` before they open the game.

QA-only URL parameters work in development or with `?qa`. The game reads each
one once, at load. None of them changes a running game from outside.

| Parameter | Effect |
| --- | --- |
| `qaStartGrace=0` | No start grace (no invulnerability at the start of a run or load). |
| `forcedSpawn=x,y,z` | The first start of the page load searches from this stage-local point instead of the start anchor. The spawn is still recovered to a legal pose. A pending respawn ignores it. |
| `qaRejectSubmit=1` | The first editor submit returns the failure "QA rejection". |
| `qaHoldStart=1` | After the first start, the simulation and the game clock stay still until the first key or pointer press in play. |
| `qaGrantCatalog=1` | The Pincer gets one synthetic active grant (`src/tiny-tide/qa-catalog.ts`). Saves that bind it load, and the editor shows the abilities a design would lose. |

Read-only diagnostics on `window.__tinyTide` include `editorProjection(target)`
(the screen point of a visible part, by uid, or of a body point `{ t, angle }`
in the open editor) and `poseAgreement()` (rendered socket transforms against
`sampleCombatPose`).

The unit tests cover parts, genomes, stats, diets, DNA, evolution, health,
seeded worlds, creature behavior (hunting, fleeing, provoking, stealth,
regrowth) and v1/v2 saves. The full browser test uses real controls. It edits
the creature (place, undo, paint, body, name), changes the diet at two
evolutions, plays all five sizes, checks in-place transformations, the ending,
a new seeded world, save and resume, and the mobile layout. The mobile test
uses a v1 save fixture and actual Chromium touch events. The replay test
uses a v1 save in space. Read-only diagnostics are available in development
or with `?qa`.

The other games remain at `/mineral-wage.html`, `/royal-yeet.html`, and
`/wildtag.html`. Production builds use the existing `/wildtag/` deployment base.
