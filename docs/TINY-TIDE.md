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

Parts cost DNA. Removing a part refunds its full cost. Each size has a
complexity limit and a body-length limit. The creature must have one mouth.

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

Progress saves locally when browser storage is available. Saves use version 2;
a version 1 save from the fixed-form game migrates and keeps its size, planets
and time. A fresh adventure replaces the save and makes a new world.

## Verification

```sh
npm run build
npm test -- --run tests/tiny-tide.test.ts
python3 scripts/tiny-tide/blender/check_assets.py
node e2e/tiny-tide.mjs                     # swimmer line; TIDE_LINE=crawler for the crawler line
node e2e/tiny-tide-paths.mjs               # 18 checks; pass check ids (for example 3 7b) to run some
node e2e/tiny-tide-mobile.mjs
node e2e/tiny-tide-replay.mjs
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
