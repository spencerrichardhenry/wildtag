# Sky Kingdom — implementation review

The resource, Blender fidelity and performance update was published first, in
`166c9d1` with release cleanup `7048e74`. GitHub Pages deployment
[34316895618](https://github.com/spencerrichardhenry/wildtag/actions/runs/34316895618)
passed. A separate Chrome check of the published URL verified Q/E swimming,
the developer FPS counter and camera interpolation.

The Sky Kingdom is the subsequent feature. It adds an elevated, explorable
cloud city, a physical trampoline/grapple ascent, two capturable species, and
renewable resources. This document describes its design and implementation.

## How to reach it

Follow the new lantern trail northeast from Haven's eastern edge. It starts near
`(72, -52)` and ends at the launch site around `(145, -128)`.

1. Craft the existing Grapple Hook: 25 research points to unlock the recipe,
   then 8 fiber, 4 resin and 6 shards. Research points are a gate and are not spent.
2. Jump onto the lower teal trampoline. Its bounce raises you high enough to
   drift northeast onto the drone trampoline.
3. Land on the drone trampoline, then aim upward at the large golden halo.
   Tap RMB near the top of this second bounce to fire the ballistic grapple.
4. Once attached, turn toward the cloud landing. Hold W and tap Space to release.

The pads are permanent world structures, so trying again costs no kits. Both use
Wildtag's existing 37.5 m bounce height. The drone pad sits at 36.22 m; the
kingdom landing is at 143 m and the grapple halo at 149 m. The halo is beyond
an unbounced drone's maximum upward hook reach. The second bounce makes it
reachable. No teleport, scripted lift, unlimited flight or new rocket ability
is involved. Ordinary movement tools remain available for creative traversal.

The arrival rail has an opening facing the halo. The halo's center is visually
open so hanging from it does not bury the camera inside a solid model. The
on-screen instructions change during the ascent and explain the final release.

## Places and the exploration loop

| Place | What is there |
| --- | --- |
| Galehook Landing | Arrival terrace, gold inlay, an uphill ramp and carved arches. |
| Windswept Market | Striped awnings, urns, market wares and the western gallery entrance. |
| Sunwash Court | An open central square with routes to the market, observatory and eagle nests. |
| The Weather Room | A roofed observatory with two doorways, an orrery, books and a bench. |
| Whisper Gallery | A covered passage with three changes of direction, lanterns and sheltered resources. |
| Eaglewatch Aerie | Three nests, territorial eagle circuits and a route up toward the sanctuary. |
| Sanctuary of the Six Wings | A raised, roofed nave, arches, a hanging bell, a Seraphlet and a side balcony. |

A complete walking loop joins these places. The gallery reaches a pair of
switchback ramps to the sanctuary; a second ramp descends toward the eagle
nests and back to the square. The city occupies roughly 110 × 150 m across
several elevations. Roofs, bridges, rooms and the terrain underneath can coexist
at the same horizontal position.

Quiet wind becomes softer and more muffled indoors. Drone rotors spin, trampoline
membranes compress after contact, creatures bank and flap, and awakened chimes
move in the breeze. The cream, teal and brass palette continues the existing
cozy direction.

## Wildlife and rewards

| Species | Behavior and capture | Use back home |
| --- | --- | --- |
| Suncrest Eagle | Three nest-based flight circuits; faster when tagged. Track within 22 m for 14 seconds. 32 RP and 4 sparks on link. | Produces 2 sparks per farm cycle; belongs to the fast-hauler group. |
| Seraphlet | Two gentle hovering creatures with six separately animated wings, feathered tails and halos. Track within 18 m for 12 seconds. 38 RP and 5 sparks on link. | Gives a 30% farm speed aura, matching the existing top flying-companion aura. |

Both use tracker darts, slowing darts, the usual linking system and Bond Charms.
Their tracking progress is patient: losing range pauses progress. Their bounded
circuits keep them in this biome and prevent an endless chase away from the city.
Bonded creatures leave their original wild slots; releasing one restores that
same sky home, including after saving.

Exploration also earns materials:

- Discovering each of seven places grants 5 RP once.
- Each of three wind chimes grants 12 RP and 3 sparks once. Finding all three
  grants an additional 12 shards and 8 sparks.
- Three skyglass deposits grant 3 shards and 1 spark per harvest, then regrow
  over 45 gameplay seconds. Their cooldowns survive saving.

Skyglass feeds the existing shard inventory. This gives the biome a useful
resource loop without creating another material that only works in one recipe.
Chimes are an optional exploration objective; they do not lock doors or prevent
access to the creatures.

## Systems changed

**Layered floors and solid interiors.** `GroundQuery.heightBelow` lets movement
select the highest supporting surface beneath the player's feet. Standing under
a roof therefore does not snap the player onto it. Swept body collision handles
walls, arch supports, ceilings, ramps and fast falls, with sliding along walls.
The mount controller also understands layered floors. The original terrain
height query remains available to terrain and ground-based systems.

**Architecture and projectiles.** Grapple sweeps and tracker darts query the sky
architecture. A hook can attach to its surfaces from above or below. Ropes
release when solid architecture blocks them. The grapple now takes its firing
direction from current mouse input, fixing a stale-aim race when turning and
clicking within one display frame.

**Flock targeting.** Bond interaction now selects linked creatures, so an
unlinked flockmate flying closer to the camera cannot block a valid capture.

**Persistence.** Sky progress is an optional addition to the current v3 save;
older saves default to an undiscovered kingdom. Valid saved city positions keep
their elevation. New wildlife uses stable reserved slot IDs, so it does not
change existing castle or procedural creature identities. Chime rewards cannot
be collected again after loading. Malformed sky progress is sanitized separately.

**Art ownership.** Loaded Blender materials are registered as shared resources,
so releasing a sky creature does not dispose materials still used by other
instances. The new creature tests load the actual shipping GLBs, including their
animation pivots and material ownership.

## Blender assets and performance choices

All 23 new tangible models were authored and exported through the local Blender
MCP: seven city sectors, fourteen props/ascent structures, and two creatures.
The source is [sky-kingdom.blend](../art/wildtag/sky/sky-kingdom.blend); the rebuild
script is [build_kingdom.py](../scripts/wildtag/sky/build_kingdom.py).

The same [layout-data.json](../src/sky/layout-data.json) drives the Blender
architecture and game collision. The manifest stores its SHA-256 fingerprint,
and the asset checker rejects layout edits that have not been rebuilt in Blender.
The authoring script operates in a dedicated scene and restores the previously
active Blender scene when finished.

The new library adds roughly 4.27 MiB and 180,000 unique triangles. Its geometry
uses painted vertex colors and a small material palette. Stationary props are
merged by material; city architecture is split into seven cullable sectors.
The clouds are opaque sculpted geometry, avoiding layers of expensive transparent
cloud effects. Overlapping pavement is cut during export to prevent flicker.
The existing scenery LODs, once-per-frame shadow refresh, half-resolution SSAO
and camera interpolation remain active.

Scenery LOD now measures vertical distance as well as horizontal distance to
the model's bounding center. Ascending straight upward updates detail too. At
Sunwash Court this moves the ground scenery from 204 to 43 near-detail instances
and reduces total submitted triangles from 2.43 to 2.38 million. That is a modest
geometry saving; the measured frame rate remains 60 FPS. Collision and harvest
state are unchanged. A regression test covers ascent and descent.

## Performance and verification

Production build, desktop Chrome with ANGLE Metal on Apple M5, High quality,
1440 × 900 CSS pixels at 2× DPR (2880 × 1800 drawing buffer). Each view was warmed
for 90 frames and measured for 359 intervals. Runs were sequential.

| View | FPS | p95 frame time | Submitted triangles | Evidence |
| --- | ---: | ---: | ---: | --- |
| Haven | 60.0 | 16.7 ms | 3.01 M | [JSON](wildtag/performance-sky-final-haven.json) |
| Sunwash Court | 60.0 | 16.8 ms | 2.38 M | [JSON](wildtag/performance-sky-final-sky-court.json) |
| Whisper Gallery | 60.0 | 16.7 ms | 2.03 M | [JSON](wildtag/performance-sky-final-sky-gallery.json) |
| Sanctuary | 60.0 | 16.7 ms | 1.78 M | [JSON](wildtag/performance-sky-final-sky-sanctuary.json) |
| Eaglewatch Aerie | 60.0 | 16.7 ms | 2.01 M | [JSON](wildtag/performance-sky-final-sky-aerie.json) |

No measured intervals exceeded 50 ms. With Chrome's frame cap disabled, the
[court measured 81.8 FPS](wildtag/performance-sky-uncapped-sky-court.json) and the
[sanctuary 85.6 FPS](wildtag/performance-sky-uncapped-sky-sanctuary.json), over
479 intervals each. These are short local hardware measurements, not guarantees
for every device. Submitted counts include shadow and post-processing passes;
asynchronous GPU timer intervals include driver scheduling and do not add to
CPU time. The existing dev overlay remains the way to measure your own machine.

The [browser gameplay record](wildtag/sky/gameplay-verification.json) verifies:

- Lower trampoline → drone trampoline → real ballistic grapple → released landing.
- The entire city walking loop, all seven discoveries and all three chimes.
- Real tracker darts, timed linking and F bonding for both new species.
- Normal-mode save/reload of altitude, rewards, resource cooldown and ownership.
- Releasing a saved creature restores its original sky home.
- No browser errors during the playthrough.

The final regression run passed **1,072 tests across 63 files**, including the
local performance budgets (run with one worker to avoid timing contention).
The production build and both Wildtag/Tiny Tide asset checkers passed. Q/E
swimming, camera interpolation, teleport reset and the dev-only FPS overlay
also passed in the final local build. See the
[verification summary](wildtag/sky/verification-summary.json).

Automated physics checks cover floor layering, roof landings, ceilings, walls,
doors, ramps, hookable surfaces and the complete walking loop. Asset validation
checks all 143 models and 84 LOD variants, their triangle counts, finite geometry
and the shared layout fingerprint.

### Screenshots

[Kingdom overview](wildtag/sky/overview.png) · [Market](wildtag/sky/market.png) ·
[Gallery](wildtag/sky/gallery.png) · [Observatory](wildtag/sky/observatory.png) ·
[Sanctuary](wildtag/sky/sanctuary.png) · [Eagle](wildtag/sky/eagle.png) ·
[Seraphlet](wildtag/sky/seraphlet.png) · [Actual ascent](wildtag/sky/ascent-grapple.png)

## Reproduction

```sh
npm run build
python3 scripts/wildtag/check_assets.py
npm run preview -- --host 127.0.0.1 --port 5209
# In another terminal:
node e2e/wildtag-sky.mjs
VERIFY_URL=http://127.0.0.1:5209/wildtag/wildtag.html node e2e/wildtag-controls.mjs
```

Rebuild the art with Blender open and the existing Blender MCP bridge connected:

```sh
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/sky/build_kingdom.py
```

The sky playthrough begins with an equipped test player at the lower pad; the
ascent and city loop then use keyboard/mouse input. It also throws real tracker
darts, waits for linking, bonds the creatures, and checks ordinary non-dev saves.
The `?dev=1` session continues to be a temporary test world with saving disabled.
