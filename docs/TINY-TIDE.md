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
with one bone for each spine segment. Parts and the body move with procedural
animation. All parts, food, scenery and planets are original Blender GLBs,
except the far seabed.

**Seabed.** The drawn seabed agrees with the collision ground (`seabedHeight`)
to within .02 L everywhere the player can reach at each stage (L = the starter
body length at growth 1). The Blender reef mesh (`seabed_0`, ±65 physical
units) is drawn in the middle. Around it, `seabed-mesh.ts` builds rings
sampled from `seabedHeight` once at load, in the reef's material: spacing 4 out
to 232, 8 out to 928, 24 out to 3200 and 48 out to 3712 physical units. Each
ring starts on the last loop of the ring inside it, so there are no cracks. A
ring is drawn only at scales where it can be seen (its inside is within the
edge fade). At the Big size (scale above 32) the two fine rings would be
under 1/4 local unit per quad, so they are hidden and one coarse ring
(spacing 24) covers the same area, joined to the reef and to the 24 ring with
the same vertices. Stage 3 draws 178 052 seabed triangles (291 580 before);
the phone check measures .86M, 1.26M, 1.51M and 1.24M triangles per frame at
stages 0 to 3 (stage 3 was 1.35M) and asserts a budget of 1.6M. Measured maximum error: stage 1, .010 L; stage 2, .009 L; stage 3,
.016 L. The old Blender rings (`seabed_1`, `seabed_2`) were off by up to .09 L
at stage 1 and .21 L at stage 2, and did not reach the stage-3 bound. They are
still in the asset library, but the game no longer loads them.

**Reef decoration (owner playtest P4).** `reef.ts` places the reef: a pure,
seeded function `placeReef(layer, seed)` for each of three layers (physical
size 1, 5 and 20, with the biomes of tiers 0, 1 and 2). `world.ts` draws
exactly what it returns. The rules:

- Each try places a plant (coral, kelp or grass) on the seabed at its centre
  (`seabedHeight`). The plant is skipped when its footprint (its widest reach,
  checked against the GLBs) meets the footprint of a solid.
- A rock goes beside the plant, never under or around it. An arch goes on the
  other side, with its opening facing the plant. A rock or an arch is skipped
  when its footprint meets a plant or another solid. So no solid footprints
  overlap.
- An arch stands with both end caps of its feet at or below the seabed.
- Shells and starfish are skipped on a solid's footprint.
- Decoration keeps its old range (7 to 54 layer sizes from the centre); the
  edge does not limit it. Solids past the soft edge only meet a body that the
  current pushes inward, and the contact slides.

Counts per seed (plants / rocks / arches, layers 0, 1, 2; before → after):
99: 46/46/4, 47/47/13, 65/65/14 → 42/43/5, 49/45/11, 54/48/10;
4242: 51/51/9, 60/60/13, 64/64/11 → 40/39/5, 56/51/12, 54/50/10.
Before, every plant stood in its own rock.

**Collision with the reef.** Rocks and arches are solids (`solids.ts`). The
collider is the visible mesh itself (final review I2): the stone and the moss
of each GLB (`reef-colliders.json`, written by
`node scripts/tiny-tide/reef-colliders.mjs`; a unit test fails while it differs
from the GLBs). Each closed piece (the stone, each moss patch) is one triangle
mesh with a grid of its triangles. A sphere test measures the exact distance
to the scaled, turned mesh, and a ray-parity test says whether the centre is
inside it. Each mesh keeps its triangles in clusters, visited nearest first
with their scaled bounds, and a padded grid of distance bounds that ends a test
far from the surface at once; near a rock an admission costs about .04 ms
(.27 ms with the first mesh colliders), with the same exact result.

- Measured with a probe of .1 L against the three largest rocks and two arches
  of every colliding layer and stage (two seeds), the gap between the collider and the
  visible rock is 0 (it was up to .50 L for a layer-1 rock at stage 0, .36 L
  for a layer-2 rock at stage 1 and .18 L at stage 2). The lower half of a
  rock above the seabed is measured too. No stone or moss vertex is outside
  the collider.
- The arch's thin crown coral has no collision, like all coral: its tips stand
  at most .25 L outside the collider (a layer-1 arch at stage 0).
- Placement still keeps the old footprints apart (the rock's ellipsoid times
  `ROCK_FIT` 1.05, the arch's 15 capsules), so the reef layout did not change.
- Coral, kelp, grass, shells and starfish have no collision.

A layer collides with the bodies of a stage when its rocks are tall enough to
meet them: 4 × the layer size is at least the stage size (final review I3).
Stage 0: layers 0, 1 and 2; stage 1: layers 0, 1 and 2; stage 2: layers 1 and
2; stage 3: layer 2; stage 4 (space): none. The tallest rocks of such a layer
stand .14 to .18 L above the seabed. A layer that does not collide at a stage
is either not drawn there or its tallest rock stands under .05 L (a pebble).
`stageWorldQueries(stage, seed)` (`world-queries.ts`) builds the world queries
from the terrain and these solids. The player, the ecosystem, food access, the
avoidance test and the browser fixtures all use it.

Admission refuses a hull that enters a solid, with the constraint `solid`. This
rule comes after the ground rule. Each sample sphere, grown by its whole
envelope, is tested against the solids in a uniform grid (cell 4 × the stage
size), so the cost does not grow with the number of solids. The deepest contact
gives the point and the normal, which points from the nearest point of the
mesh to the sphere's centre (outward). So the contact skin and the crease
projection of motion slide a body around a rock. The admission also names the
solid (`solidId`).

- Ground plans step over low rocks (owner decision, fix round 2; it replaces
  the M12 ruling "rocks are walls"). A rock whose top stands at most .15 L
  above the seabed at its own foot (`STEP_HEIGHT`; the seabed under the
  contact point) is walkable: the body is lifted by the smallest height that
  the solids admit (`stepLift`, at most .5 L; at most 12 admissions a call, one
  when no rock is under the body). The lift rises at most 1.2 L/s
  (`STEP_CLIMB`): a steeper step holds the horizontal move back to what that
  rise allows, so the body rides up and does not snap. Over a rock the height
  comes down toward the lift at the same rate; off it, it settles like any
  lift off the seabed. A slide along a solid never lifts a ground body more
  than its move asked for, so it does not climb a wall by sliding. Taller
  rocks and every arch stay walls. Each stepped pose goes through the normal
  admission. Swim plans are not affected. A tap-to-walk target is still
  dropped after 1 s with no progress toward it (`TAP_STALL_SECONDS`).
- Against solids, each sample sphere's animation envelope counts like the
  ground rule's: sway horizontally, heave vertically (fix round 3,
  `SolidIndex.sphereEnvelope`). The sample is taken as the ellipsoid of
  semi-axes r + sway (horizontal) and r + heave (vertical), tested exactly by
  stretching space vertically so that it becomes a sphere (a mesh or an
  ellipsoid solid stays one; a capsule keeps the plain sphere). Before, the
  sway counted in every direction, and a .05 L pebble lifted a Shellback
  .32 L. Measured gap between the belly (the hull without its margins) and the
  stone on top of a low mesh rock: Crawler .052–.055 L (on the seabed .058 L),
  Shellback .040–.043 L (.047 L), Colossus .065–.068 L (.068 L), 7-segment
  Colossus .030 L (.039 L). An ellipsoid holds a little less than sphere +
  sway + heave toward the diagonals, so a swinging tail can graze a rock's
  shoulder there.
- A body that is really wedged never freezes. A turn that a solid cuts short
  is tried again where the move ends. A trap is when the player pushes one way,
  the body gains under .05 L along the push for .75 s, and on at least 60 % of
  those frames it is wedged. Wedged means contacts that oppose the push from
  both sides of it, with two different solids or with two faces of one solid
  that face each other (an arch's legs), or a refused turn toward the
  push (refused by any rule) while a solid is touched. A head-on push into
  one rock is not a trap (tested: 0 rescues in 101 such pushes). The game then
  searches for the nearest admitted pose within 1.5 L that faces the push
  (`UnstickSearch`), from which the push is free for .5 L (`RESCUE_FREE`).
  The free run is checked as the walking body makes it (fix round 4): facing
  the push, at the walking height over the seabed (support + .01 L), lifted
  onto a low rock as `stepLift` does, and ended by a wall. Before, the check
  kept the candidate's height over a seabed that fell away, passed over a tall
  rock that the walking body met, and a held push into such a pocket got a
  rescue about every 2 s. The run goes the free distance past the trap point's
  line across the push, so a candidate behind the trap is checked over the
  trap too, and a run that passes back over the trap point (within .25 L) is
  not a rescue. A trap within 1 L of the last rescue's start in the
  last 10 s (the player pushes into the same pocket again) needs a free run of
  2 L (`RESCUE_FREE_REPEAT`): the next rescue gets the body past the pocket, or
  there is none. A search that finds nothing is not repeated at that spot for
  that push.
  A candidate is used only when the whole hull is admitted at every step of
  the straight path to it, with position and yaw together (steps of at most
  .1 L and .2 rad). The body then glides along that path over at least .15 s
  (9 frames), and each step is admitted again for the current body. So the
  body never passes through a solid and never snaps. When no such pose is near,
  there is no rescue: the body stays, admitted, against the walls, and the
  player can back out. Every other install (respawn, recovery, evolution, an
  edit, a growth step, a new run) cancels a pending rescue (`cancelRescue`).
  The search runs in slices with a hard budget: a played frame spends at
  most 60 admissions on the player's step and the search together
  (`FRAME_ADMISSIONS`); the search gets what the step left (`rescueBudget`)
  and goes on next frame where it stopped, inside a candidate too.
  A body held still against walls is cheap: a leg that starts at a contact is
  first tested at the bisection's finest step (1/256 of a slot); refused
  there, the eight bisections would end at the same point with the same
  refusal, so they are skipped. A blocked frame at rest went from 43 to 12–15
  admissions.
  The QA diagnostics count rescues (`trapRescues`, `rescueLog`). Measured after fix round 3: 0 in four
  swimmer journeys; 0–3 in twelve crawler journeys and 17 in one (seed
  763919134). Before the repeat rule, one crawler journey had 126.
- A growth lift stops at the first step that a different rule or a different
  solid refuses, so it never carries a body through a thin solid. In a crease
  (for example the seabed and a rock base) the two refusal normals are across
  each other; the lift is then tried once more along their sum (final review
  M6), so a bite at the foot of a rock keeps the motion.
- Spawns never use a solid. A spawn point inside a solid (grown by the body
  radius) is rejected. The opening population replaces such a point with its
  own RNG, so the other spawns of the seed do not move. Every entity is then
  installed on an admitted pose, so food, homes and creatures are never inside
  a solid.

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

**Hull fit.** The ground and crawler plans keep the conservative hull: it holds
every animated pose with a margin. The swim plans (Swimmer, Darter, Bulk) use a
tight hull, so that they stop close to the sand. This is the owner's "tighter
fit" decision after the playtest (P3). It overrides the conservative margin of
the design spec for the swim envelope only. The tight hull:

- uses a sphere on each end bone for the tips, and splits each spine segment
  into three tapered pieces that follow the body's loft;
- keeps half of the swim wave's sway of the hull's centre line
  (`TIGHT_SWAY` = .5), so the tail can clip a little into the seabed at the
  end of its sway (measured: never in the tests; allowed: .1 L);
- adds a bite heave only for the part of a bite's dip (the body behind the head
  drops by about .027 L) that the hull's room under the belly does not cover.

Admission tests the tight hull with sample spheres that cover the tapered
pieces exactly. The ground grid has a spacing of r'/6 (`TIGHT_GRID`), with a
second-order margin from the terrain's curvature bound
(`SEABED_CURVATURE_BOUND` = .026). Measured at rest on a flat seabed, the
visible gap between the belly and the sand is .03 L. It was .13 L before.
When sliding along slopes it is at most .058 L. It was .21 to .30 L before.
These numbers are for the starter bodies. On 13 edited bodies (final review
M15: flat, tall and strongly lifted spines) the sliding gap reaches .19 L,
because a round hull piece holds the larger of a segment's radius and height;
the body still never goes below the seabed. A tighter fit for such bodies needs
non-round hull pieces (not done).
The ecosystem uses the same admission hull for its contact hazards (the touch
test, hazard events and the hunter's remembered target), so for the swim plans
that is the tight hull. Only combat poses (`sampleCombatPose`) build the
conservative hull.

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
from the centre (the bubbles too). Space (the stars and the sun) does not
change. The fog changes smoothly, also after a jump (respawn, recovery,
evolution). New food and creatures are placed inside 40 units (`SPAWN_HALF`),
and a tap-to-walk target is clamped there too. Food and creatures roam, flee
and hunt inside 44 units (`WORLD_HALF` = `EDGE_REACH` × the bound), and food
past 44 units is not approachable. Every creature can bite at 44 units: the
slowest possible creature settles at about 42 units, and the smallest bite
reaches 2.2 units further.

**Hints.** When a move is really blocked, a toast says why (final review I1):
the move is `blocked` and less than 25 % of it is done (`BLOCK_HINT_PROGRESS`),
frame after frame for .3 s (`BLOCK_HINT_SECONDS`). A slide along a border, the
seabed or a rock is not a block and shows no hint. One hint shows per block,
at most one each 6 s, and only when no other toast is on screen, so a one-shot
message ("Ready to evolve!", "New part found") is never replaced; the hint
waits until that toast is gone. The world-edge hint also shows once each time
the creature enters the edge's push zone, with the same rule:

| Border | Hint |
| --- | --- |
| World edge | "That's the edge of the world for now." |
| Sky limit | "That's as high as you can go for now." |
| Ground | "Something solid is in the way." |
| Rock or arch | "A rock is in the way." |
| Water surface | "<Plan>s can't leave the water." |
| Air | "<Plan>s can't fly." |
| Land | "<Plan>s can't go on land." |
| Floor gap | "<Plan>s stay on the seabed." |
| Depth | "<Plan>s stay in shallow water." |

**Movement.** Ground plans (Speck, Crawler, Shellback, Burrower, Colossus) stay
on their support height. Swim, fly and space plans move in three dimensions:
hold Rise / E or Dive / Q, and forward follows the camera pitch. Each movement
profile sets speed, acceleration, braking and turn rates.

**Breach.** Darter and Bulk (size 2, free water) Breach: tap Rise / E within
2 body lengths under the surface (`BREACH_REACH`, measured from the body's
origin; owner ruling M9). Deeper, a tap or a hold of Rise is a normal Rise, so
a tap on the seabed never starts an uncontrolled arc. A tap during the
cooldown is a Rise too. A Breach is a 1.8 s arc (`BREACH_SECONDS`) that rises 3.8 × the
size scale above the surface (`BREACH_RISE × size`). It ends 1.3 × the size
scale under the surface (`BREACH_END_DEPTH × size`), or deeper when the
body needs it: the arc's end height (`breachEndY`, fixed when the arc starts)
keeps the hull's top at least .02 L (`BREACH_CLEARANCE`) under the surface at
every pitch the body can turn to during the arc. So a grown body lands in the
water with no recovery and keeps its horizontal speed. A landing that is
admitted in the water ends the air permit at once. Otherwise the permit lasts
1.9 s, and when it ends the game checks the landing and recovers the pose if
needed. The cooldown is 2.3 s (`BREACH_COOLDOWN`).

**Recovery.** When a pose stops being legal (for example, after a design
change, a transformation, or a step that ends a permit in the air), the game
looks for the nearest legal pose: the current orientation, then level, then
the start anchor. Recovery installs the pose with no permit or arc and zero
velocities. If all fail, the game enters a stuck state and tries again each
second; while stuck it keeps the last installed pose with the orientation,
permit and arc it was admitted with (final review M10). It never installs an
unchecked pose. Two cases keep the motion and do not use recovery: a growth
step first tries the smallest lift of the grown body (up to .5 L, along the
refusal's normal, or along two normals in a crease) with both velocities
kept, and only when no lift is admitted does it recover; the end of a Breach
lands in the water by its end height (`breachEndY`) with no recovery.

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
player step: a player that flees at the notice distance must escape. An
encounter starts with the whole hull inside the soft edge (owner playtest P4:
the reef moves some starts, and a start already in the edge current is not an
open-water escape), with the orientation its start pose was admitted with.

Hunters and the edge (owner ruling M11): hunters (species that hunt or fight
back) roam inside 42 tier-local units (`SPAWN_HALF` + `HUNTER_MARGIN`), and they
do not chase into the player's push zone. A hunter whose target is past the
soft start (40 units of the player's stage) gives up and goes home, and it does
not acquire a target there. So the edge current, which holds a fleeing player
at about 43 units, never holds it for a hunter. The avoidance test also runs
edge encounters: the player starts at x = 38, the hunter .95 of its notice
distance further in, and the player flees outward into the current. A Speck
against the Peach crab was caught at 1.9 s before this rule; every edge
encounter now ends with the hunter giving up (.5 to 1.1 s).

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
TIDE_SLOW=1 npx vitest run tests/tiny-tide-core/solids.test.ts   # the slow tier: before a merge (long)
npm run build                              # the chunk-size warning is expected
python3 scripts/tiny-tide/blender/check_assets.py   # PASS: 86 self-contained Blender GLBs; fails on a stale part-rig.json
node e2e/tiny-tide.mjs                     # swimmer line; TIDE_LINE=crawler for the crawler line (long: run in the background)
node e2e/tiny-tide-paths.mjs               # 18 checks with 5b, 5c, 5d, 7b, 7c and 12b; pass check ids (for example 3 5c) to run some
node e2e/tiny-tide-mobile.mjs              # also the phone triangle budget (1.6M per frame) at stages 0–3
node e2e/tiny-tide-replay.mjs
node e2e/tiny-tide-pacing.mjs              # the pacing study (a diagnostic, not a gate; long: run in the background)
```

The default run keeps a smoke version of each long movement property test in
`solids.test.ts` (one seed, the starter body, fewer solids). `TIDE_SLOW=1`
runs them in full: the escape from every nearby solid (3 seeds, 3 bodies,
up to 24 solids), the head-on pushes (2 seeds, starter and 7-segment bodies),
the Colossus walks (3 and 7 segments, 5 foods) and the pocket holds (every
pocket of two solids near the start, 3 seeds, starter and 7-segment bodies).
Run the slow tier before a merge.

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
| `qaEncounter=<species key>` | For example `qaEncounter=1:crab`. At the first start of the page load, the nearest live instance of that species (of a tier next to the stage) moves 3 player body lengths in front of the player, in calm. Its pose is recovered like any install (within 4 of its body lengths). Diagnostics: `combat.encounter` (id, key, physical position, body length, mode, eaten), or null when no instance or no legal pose was found. |
| `qaAlphaHealth=<0..1>` | At the first start of the page load, every live alpha starts with that fraction of its HP (at least 1 HP). Diagnostics: `combat.alphas`. |

First-time hints (spec §12.3, D30) use the toast: one per move kind in a
slot, one for the first wind-up at the player and one for the first red
(unblockable) wind-up. Each shows once per browser profile; the shown ids are
in `localStorage` key `tiny-tide-hints-v1` (never in the run save). A hint
waits for a free toast and keeps 6 s from the last hint. In a fight only the
telegraph hints show; a move hint waits until the fight ends. The first
wind-up hint is the exception to the 6 s gap: it shows at the first wind-up at
the player and may replace a non-critical toast (another hint, or the stage
text), never a message such as a found part or "Ready to evolve!". On a phone
a move hint names the button ("Tap Dash") and shows the move's slot icon after
the name. To see the hints again, remove the key. Diagnostics: `combat.hints`
(the shown ids).

Toast placement: on a phone (portrait or landscape), and in a fight on any
layout, a toast sits in the objective pill's slot, clear of the controls and
the creature. While it is there (up to 4.5 s) the objective pill is hidden, and
the wide toast also covers the depth label ("THE SEAFLOOR") at the left edge.
When the Evolve button shows, a phone toast stays above the button (never below
it); a desktop toast in a fight goes 8 px below it. A phone toast also rises
(never over the stage and growth cards) so that it ends 4 px above the
creature's screen box (its world hull, projected; QA `creatureBox()`).

Read-only diagnostics on `window.__tinyTide` include `editorProjection(target)`
(the screen point of a visible part, by uid, or of a body point `{ t, angle }`
in the open editor), `screenOf(physicalPoint)` (the CSS-pixel screen point of a
physical point, for pointer-aim checks) and `poseAgreement()` (rendered socket transforms against
`sampleCombatPose`)), `lastContactSolid` (the solid of the last 'solid' contact),
`solidsNear` (the nearest reef solids of the stage, in local units),
`solidOverlap` (the reef solid the player's hull overlaps, from the admission's
solid rule alone, or null) and `admission` (per stage: played frames, the
admission time and calls per frame in total and per caller — player, ecosystem
and food guide — the player's worst calls in one frame (`player.worstCalls`),
the worst rescue slice (`rescueWorstCalls`) and the player's contacts per
frame; the journey prints it).
The admission clock counts only calls made inside a played frame: it resets
when a frame starts, so the editor's anchor checks and a start's admissions
are not counted (final review M8).

QA note (combat, T16b): the telegraph edge arrow is in practice a phone feature
in crab fights. On a desktop view the close camera keeps a nearby crab and its
telegraph on screen, so no arrow appears. The live look caught one only at
390 × 844 with the camera turned (`.codex-drafts/tiny-tide-qa/combat-live-edge-arrow.png`).

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
