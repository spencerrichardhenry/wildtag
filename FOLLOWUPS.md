# Known fast-follows

Deferred, non-blocking cleanups noted during the whole-branch review. The
backlog below has been cleared on `chore/followups`; what remains is a short
"deliberately kept" list of items intentionally left as-is (with reasons), plus
a trail of what was resolved.

## Cursed Castle fast-follows

Deferred minors noted while finishing the Cursed Castle branch (Task 15's
playtest-tuning sweep — a constants sanity review, not an interactive
playtest). None block ship; listed here so they aren't lost.

- **HUD 'Purifiers' label casing** (`ui/hud.ts:212`): reads Title-case
  `Purifiers` next to lowercase siblings `darts`/`charms` (line 208/210) —
  cosmetic inconsistency in the hotbar/HUD counter labels.
- **HP/stamina bars flash visible ~2s at boot** (`ui/hud.ts`): both bars are
  briefly visible before their steady-state fade-in settles; not a functional
  bug, just a visible pop worth smoothing.
- **Purify-flash CSS duration hardcoded** (`ui/hud.ts:1004`, `0.5s`) **vs
  `CRYSTAL.flashS`** (`core/constants.ts:994`, `0.5`): same value today, but
  the two aren't wired together — retuning `CRYSTAL.flashS` alone would
  silently desync the flash's fade timing from the constant that documents it.
- **Pushout clamp (1.5 m) feel unplaytested** (`core/constants.ts:165`,
  `COLLISION.maxPushoutPerStep`): reused as-is from the pre-castle collision
  system for the new castle wall/keep/tower obstacles; the per-step pushout
  cap hasn't been playtested specifically against the castle's tighter
  corridors (gate arch, keep entrance).
- **Gargoyle wing "unfurl on flee" animation punch-up** (`critters/species.ts`
  / `critters/models.ts` gargoyle entry): the flee reaction reuses the generic
  fly-flee animation; a perch-specific wing-unfurl flourish on the
  idle→flee transition was suggested but not built — pure polish.
- **`debug.ts` `grant()` doc comment omits `purifiers`** (`debug.ts:174-178`):
  the JSDoc lists grantable numeric fields as "fiber, resin, shard, spark, rp,
  darts" but `purifiers` (and `charms`) also grant through the same path —
  comment just hasn't been updated to match.

Constants sanity-checked (numbers hold up, no change made):
- `GOBLIN.chaseSpeed` (8.075) vs `MOVE.sprint` (9.5): a sustained sprint pulls
  away at +1.425 m/s (~15%); at `sprintDrain` 10/s a full stamina bar buys 10s
  of sprint — ~14 m of separation, comfortably past `GOBLIN.giveUpR` (40 m)
  combined with an existing gap. Reads as "escapable but scary," as intended.
- `DAYLIGHT.duskS` = 60s — matches the brief's target.
- Purifying Dart cost (`mushroom: 3` per batch of 5) against mushroom supply
  (`CASTLE.approachMushrooms: 10` dedicated clusters + world scatter capped at
  8/chunk, `SCATTER.respawnS` 180s regrow): comfortably affordable, not a
  bottleneck.
- Giant-tree frequency (`PROPS.treeTiers`, cumulative `p: 1.0` after `0.95`) =
  5% — matches the brief's target.

## Inventory + building fast-follows

Deferred minors noted across the Inventory + Building branch's task reviews
(6-slot assignable hotbar, inventory screen, buildable walls/ramps, first-
person hands). None block ship; listed here so they aren't lost.

- **Ramp-onto-wall-top dead-straight climb catches short** (`structures/
  build.ts` `obstaclesNear`, `core/constants.ts` `BUILD.standClearance`): a
  wall's own side-collision circles (radius `wall.t*1.5` = 0.6 m) extend
  ~0.4 m past the wall's own thickness into an adjacent ramp's landing zone,
  and `standClearance` only releases the height gate once the climber's y is
  within 0.1 m of the true top — so a perfectly dead-center approach up a
  ramp onto an adjacent wall's flat top can nudge sideways a fraction of a
  metre short of fully cresting (observed 8.48-8.98 of an expected 9.06 in
  task-5's testing). A kid nudging their mouse or sidestepping slightly
  completes the climb fine in practice; not fixed since it's a separate,
  more subtle nuance from the overlap bug that WAS fixed (which made ramps
  unplaceable/unclimbable at all).
- **Wild critters ignore build pieces** (`critters/manager.ts` /
  `structures/build.ts`): only the player (`main.ts`'s composed `ground` +
  `build.obstaclesNear`/`grappleNear`) and castle goblins/elves (explicitly
  wired `buildObstacles`) resolve against placed walls/ramps. Ordinary wild
  critters (`CritterManager`'s own ground/collision) walk straight through a
  player-built fort — both the ground extension (a critter won't stand on a
  wall top) and the side collision (a critter won't be pushed off a wall's
  face). Matches the design brief's explicit call-out for wild critters
  (raw-terrain AI is intentional, not an oversight) but worth flagging
  together with the ward-wall equivalent already listed above, since both
  are the same shape of gap against two different geometry sources.
- **Hands viewmodel on the `low` quality preset unmeasured**: Task 6's visual
  verification (12 screenshots) and this task's e2e (`checkHands`) both ran
  on the SwiftShader auto-detected `low` preset by default, but neither
  explicitly forced `?quality=low` vs `?quality=high` side-by-side for the
  hands viewmodel specifically — no quality-gated feature branches in
  `hands.ts` today (it's always-on, unlike shadow cascades/near-LOD), so
  regression risk is low, but it hasn't been eyeballed at `high` either.
- **Sway/bob feel unplaytested** (`core/constants.ts` `HANDS.swayAmp`/
  `bobAmp`/`bobFreq`, `player/hands.ts`): tuned by inspection of static
  screenshots during Task 6, not by watching continuous motion in a live
  session; bob timing is tied to a fixed frequency constant, not to actual
  footstep cadence. A real playtest could still want a pass on feel.
- **Grapple hook viewmodel reads slightly spiky** (`player/hands.ts`
  resting-hook mesh): the 3-prong fan reads more "spiky claw" than
  "grappling hook" at a glance; acceptable per the "chunky > sharp" visual
  guidance but a future pass could round the prong tips further.
- **Daze-eject gate teleport stays on raw terrain** (`main.ts`, the castle
  blackout-drag's gate-exit `heightAt(out.x, out.z) + 0.5`): not migrated to
  the composed `ground.heightAt` like every other consumer (Task 5's ground-
  consumer audit) — an extremely narrow edge case (a piece would have to sit
  exactly at the castle gate's fixed eject point), documented rather than
  risked touching unrelated Cursed-Castle code for it.
- **Wall 2-circle obstacle coverage is a fixed-layout caveat, not a
  parametric guarantee** (`structures/buildmath.ts` `pieceObstacles`): valid
  for the current `BUILD.wall` dimensions only; a future resize of the wall
  panel would need this re-derived rather than just re-tuning a constant.
- **`screens.ts` item-tint color literals duplicate `ui/hud.ts`'s own**
  (`ITEM_COLOR` in `screens.ts` vs the hotbar strip's inline colors in
  `hud.ts`, and again in `HANDS.itemColor` in `core/constants.ts`): the same
  per-item color is defined in three places by convention (kept in sync by
  hand across Tasks 3 and 6) rather than one shared constant table.
- **`fireSelectedItem`'s kit/wall/ramp "not active" shake branch is normally
  unreachable** (`main.ts`, the `'kit:zipline'`/`'kit:drone'`/`'wall'`/`'ramp'`
  cases' `else hudUi.shake()`): `syncHotbarPlacement` already auto-enters the
  matching ghost the instant that slot is selected, so the else-branch only
  fires in the narrow race where stock hits zero between selection and the
  LMB press — correct, just worth knowing it's a race guard rather than a
  commonly-hit path if it's ever touched again.
- **Hotbar-slot shake reads a frame-stale selected slot** (`ui/hud.ts`
  `shake()` / `main.ts` `fireSelectedItem`): the shake targets
  `hotbar.selected` at the moment LMB fires, one sim step ahead of the next
  HUD repaint — imperceptible at frame rate, not worth a synchronization fix.
- **`HOTBAR_SLOT_COUNT` duplicated** (`core/save.ts` vs `craft/hotbar.ts`'s
  `NUM_SLOTS`): both are `6` today, defined independently rather than one
  importing the other's constant.
- **3 older species still lack `FLAVOR` guide text** (`critters/species.ts`):
  predates this branch; noted again since Task 1 added flavor text for
  timberchomp/pebbleshrew but didn't backfill the pre-existing gap.
- **`HandsView.dispose()` implemented but never called** (`player/hands.ts`):
  matches `GrappleVisuals`'s existing precedent (no app-wide teardown path
  exists anywhere in `main.ts`) — kept for hygiene/future reload paths, not a
  gap specific to this feature.

## Playtest Task 8 fast-follows

Deferred minors noted while fixing the height-cap bug, adding ghost rotation
+ the cube piece, and making snapping explicit (Ctrl-hold). None block ship;
listed here so they aren't lost.

- **Climbing a ramp toward a cube gets a brief sideways push near the top**
  (`structures/buildmath.ts` `pieceCircles`'s cube branch, r=1.2):
  discovered while writing the ramp→cube→ramp staircase compositional test —
  for roughly the last 0.5 m of horizontal approach before reaching a cube's
  face, a climbing player's height is still below the cube's `yTop` (so the
  glide-over skip hasn't kicked in yet) while already inside the cube's
  r=1.2 + playerRadius=0.4 push-out radius, so `resolveCollision` nudges them
  sideways for a few steps. Not a Task 8/cube regression — the identical
  geometry already exists for a ramp rampfoot-snapped into a WALL's face (a
  climbing player is similarly still below half the wall's height while
  within the wall's own r+playerRadius reach); no prior test exercised a full
  incremental walk to notice it either way. Doesn't block climbing (the push
  is XZ-only; the ground-resolve Y snap is unaffected) — just a bit of wobble.
  Candidate fixes: shrink the cube's obstacle radius closer to its true
  half-width (1.0), or split it into multiple smaller circles like the wall
  does, or apply `standClearance`-style softening earlier in the approach.
- **`resolveBuildAim`'s piece-vs-terrain distance compare doesn't account for
  the ghost's own footprint** (`structures/buildmath.ts`): it compares the
  raw ray distances to the piece's AABB-entry point vs. the terrain-march
  hit, which is the right call for "which surface is the crosshair actually
  looking at," but doesn't reason about where the CANDIDATE piece would end
  up after `resolveSnap`/`freeformSnap` runs on that aim point — in principle
  a piece hit could still resolve to an invalid/overlapping placement right
  at the same spot; `placementValid` catches that downstream as it always
  has, so this is a documentation note, not a gap.

## Playtest Task 9 fast-follows

Deferred minors/design notes from adding destruction ("demolish") mode. None
block ship; listed here so they aren't lost.

- **No aim-highlight mesh tint on the targeted build piece** (design decision,
  not a bug): `build.ts`'s wall/ramp/cube meshes all share ONE module-level
  material per kind (`wallMat`/`rampMat`/`cubeGeo`+`wallMat`) — bumping the
  aimed piece's emissive would tint EVERY piece of that kind, not just the
  aimed one. Per the brief's own explicit escape hatch ("skip highlight if
  invasive"), feedback is the prompt line only (`Reclaim: {label}` under the
  crosshair, plus the distinct red-X crosshair glyph while the mode is
  active) — giving every build piece its own material clone just for this
  cosmetic would be a real (if small) perf/complexity cost for a mode most
  players toggle rarely. Revisit if a future task already needs per-instance
  materials for another reason.
- **Drones reclaim by proximity, not by aim** (`structures/demolish.ts`'s file
  header has the full reasoning): a drone station-keeps at
  `STRUCTURES.droneHover` (25 m) above ground, far past `DEMOLISH.range` (10 m)
  — so aiming a ray at one from the ground is essentially impossible. Demolish
  mode reuses the exact same "stand beneath it" test the pre-existing hold-F
  recall already used (`DroneSystem.recallableIdNear`, `droneRecallRange` =
  8 m horizontal), just triggered by LMB instead of a timed hold. This means a
  player standing under a recallable drone reclaims it with ANY aim direction
  — a deliberate simplification, not an oversight, but worth knowing if a
  later task wants drones to be aim-targetable from farther away (e.g. via a
  grapple-latch-style long-range hook instead of a short ray).

## Castle ward fast-follows

Deferred minors noted while building the Castle Ward maze (Tasks 1-7). None
block ship; listed here so they aren't lost.

- **Near-query Set-dedup allocation churn** (`castle/ward.ts` `queryNear`):
  every `wardObstaclesNear`/`wardGrappleNear` call allocates a fresh `Set` +
  output array to dedupe circles that live in multiple hash buckets (a circle
  whose disc spans a bucket boundary is inserted into every bucket it
  overlaps). A single-bucket-per-circle scheme (bucket by center only, widen
  the 3x3 scan by the max circle radius instead) would avoid both the
  per-call `Set` and the duplicate insertion, at the cost of a slightly wider
  scan radius.
- **Junction stride-cap inline constant** (`castle/ward.ts` `parseWard`,
  `const stride = junctionCount < 40 ? 1 : 2;`): the `40` threshold and the
  resulting `1`/`2` stride are inline magic numbers rather than named
  `WARD`/local constants — harmless today (the real 36x36 map's junction
  count is comfortably on one side of the threshold), but worth naming if the
  map is ever resized or re-authored.
- **Goblin patrol overlap at adjacent junctions** (`castle/goblins.ts`
  zone-homing, `GOBLIN.patrolR` = 8): two goblins homed to adjacent
  corridor-junction zones can have overlapping patrol circles where junctions
  sit close together in the hand-authored map, so their patrol loops can
  visibly cross. Not a bug (goblins don't collide with each other), just a
  minor "personal space" nit a future pass could stagger.
- **One-frame lag on hall entry** (carried over from Task 5, still present):
  `state().inHall` — and the `movementCeiling`/grapple-suppression gate it
  drives — is computed once per sim step from the player's position that
  step, so crossing a hall doorway boundary takes effect on the frame after
  the crossing rather than instantaneously. Imperceptible at frame rate; not
  worth the complexity of a sub-step boundary check.
- **Roof grapple clip-throughs** (`castle/layout.ts` / `castle/ward.ts` /
  `player/grapple.ts`): a fired hook can latch through a hall's collider-less
  roof and settle on the floor or the far wall inside, since nothing in the
  grapple's raycast/latch path treats the roof plane as solid — cosmetic (the
  rope renders through the roof mesh), not a movement exploit on its own.
  Candidate fixes: a roof-specific grapple blocker cylinder/plane over each
  hall footprint, or an `inHall(anchor)` check in the latch-validation path
  that rejects an anchor whose line back to the player crosses a roof.
- **Ward ring-exclusion leaks for runs that END on the ring** (`castle/ward.ts`
  `isRingRun`): a wall run is excluded from ward-collision emission only when
  EVERY cell of the run lies on the outer ring; a run that starts inside the
  maze and ends ON the ring line (rather than lying flush along it) still
  emits its own circles there, doubling up with the curtain wall's existing
  collision on that shared line. Harmless in practice — a doubled collider
  just makes an already-solid line more solid — but worth tightening if the
  hand-authored map is ever re-edited near the boundary.
- **Plaza banner poles have no collision** (`castle/builders.ts` plaza
  dressing): the decorative banner poles placed around each plaza are visual
  only — a player, goblin, or elf walks straight through one. Minor, since
  they're thin and off to the side of the open plaza cells, but noted in case
  a future pass wants every placed prop to carry at least a thin collider.
- **Wild critters don't collide with ward walls** (`critters/manager.ts` /
  `castle/ward.ts`): only goblins (`castle/goblins.ts`) and elves
  (`castle/elves.ts`) run their step positions through
  `castleObstacles()`/`wardObstaclesNear()`; ordinary wild critters that wander
  into the ward's footprint (e.g. during a chase or just by roaming) can
  ghost through maze walls. Not currently reachable in normal play (critters
  don't spawn inside the walled ward), so deferred rather than fixed blind.

## Deliberately kept

- **Prismhorse tri budget / LOD** (`critters/models.ts`): the 16-legged crystal
  mount is the heaviest model, but there is only ever one active mount actor and
  pens are capped at 8 rendered models per pen, so instancing many prismhorses
  never happens today — a lower-poly LOD or shared geometry is moot until that
  changes.
- **Banked-production collect semantics** (`farm/farm.ts`): a full hopper banks
  exactly one finished cycle that ships on the first tick after a collect. This
  is documented and intended; noted here only so a future reader doesn't "fix" a
  batch that reads as slightly free.

## Resolved

- Elf/goblin wander now respects castle wall colliders — every `stepGoblin`
  step (chase, patrol, and the lunge hop alike) and every `ElfSystem.update`
  wander step runs the resulting (x, z) through `resolveCollision` against
  `castleObstacles()` (own body radius `GOBLIN.bodyR`/`ELF.bodyR`), so a
  chasing goblin or a wandering elf is pushed out at the curtain wall/keep/
  tower rim instead of ghosting through — the gate/keep-entrance gaps stay
  legitimately open. (`castle/goblins.ts` / `castle/elves.ts` / `castle/system.ts`)
- Elf count growth capped — `ELF.maxCount` (28); `ElfSystem.addAt`/`setCount`
  both clamp to it, so an unbroken run of purified goblins can no longer grow
  the resident count past what the spiral home layout comfortably seats.
  (`castle/elves.ts` / `core/constants.ts`)
- Spec §5 gap closed — a purifying dart landing on an ordinary critter (e.g. a
  perched gargoyle) is now a harmless sparkle: `PurifierSystem` gained a
  `critterTargets` hit-test tier (priority: goblins, then critters, then the
  crystal), so a dart no longer flies through critters silently, and a critter
  in front of a goblin/crystal legitimately shields it without being tagged,
  tracked, or transformed itself. (`castle/purifier.ts` / `main.ts`)
- Spec §4 gap closed — the HP bar now surfaces within the castle region at
  night even at full HP (`HudFrame.dangerZone`, computed in `main.ts` from
  `inCastleRegion` + darkness + `!castlePurified`), not only after damage
  lands; it still lingers `HEALTH.barLingerS` after leaving before hiding, and
  a purified castle shows no bar (no danger). (`ui/hud.ts` / `ui/hud-math.ts` /
  `main.ts`)
- Zipline rider-clearance — `validateZipline` now requires the cable clear
  `losClearance + ziplineHang` along the span; added a `'low'` reason (rider
  would drag) distinct from `'los'` + placement toast copy. (`structures/ziplines.ts`)
- Field Guide live refresh — a Link now calls `screens.refresh()` so an open
  guide rebuilds from `linkedSpecies()` immediately. (`main.ts`)
- Grounded-grapple jitter — `stepSettle` stall detector: while grounded and
  zipping, the pull must close on the anchor by ≥ `settleMinProgress` (0.05 m)
  per `settleStallWindow` (0.5 s) or the hook auto-releases; a converging zip is
  never eaten, at any distance. (`player/grapple.ts` / `player/controller.ts`)
- Tracking-ring anchor height — optional per-species `ringHeight` (defaults to
  `size * ringHeadFactor`); stag/bellowbuck/prismhorse anchor taller. (`core/types.ts` / `critters/species.ts` / `ui/hud-math.ts`)
- Shared per-step critter snapshot — `CritterManager.list()` caches its array per
  sim step (busted by `update()` + every population/flag change). (`critters/manager.ts`)
- Chunk-manager early-return — `update()` skips the ring scan when the player
  hasn't crossed a chunk boundary and the field is fully built. (`world/chunks.ts`)
- Buffered-jump landing compare — `landedDuringStep` uses an epsilon on the
  buffered-jump `vy` signature instead of exact float equality. (`player/controller.ts`)
- e2e retry surfacing — `verify.mjs` counts + prints per-check retries; the
  RESULT line reports the total, and `VERIFY_STRICT=1` fails on any retry. (`e2e/verify.mjs`)
- Released critters persist — release re-opens the ORIGINAL wild slot
  (`CritterManager.releaseSlot` un-consumes the registry entry, kept Linked), so
  it survives reload and returns at its home; debug-bonded negative-id critters
  keep the ephemeral spawn. (`main.ts` / `critters/manager.ts`)
- Nickname RNG persisted — nicknames come from a persisted monotonic cursor
  (`save.nameCursor`, absent→0) into a seeded shuffle of the name pool; dupes only
  after pool exhaustion. (`critters/roster.ts` / `core/save.ts` / `main.ts`)
- Wedged-request reroll — pure `barter.reroll` (seq+1, no reward/cost) behind an
  "Ask for something else" dialog link. (`village/barter.ts` / `main.ts`)
- `window.__village` gated behind a dev session (`?fresh`/`?dev`/`?debug`/
  `?screen=roster`); `__game` stays exposed. (`main.ts`)
- NPC label declutter — labels cull beyond 40 m and de-collide (single upward
  offset pass). (`village/npcs.ts`)
- Farmer Odd anchor — moved beside the plot grid so talk-F no longer competes
  with plot collect-F. (`village/npcs.ts`)
- Save-apply catch fallback now clears pens (`pens.load([])`). (`main.ts`)
- Mount range check now uses the full 3D distance (includes vertical delta). (`main.ts`)

### Resolved earlier (Haven V7)

- V4 barter request persists concretely so reloads never swap it (`save.barter[].request`).
- Pen rendering capped at 8 models per pen with a `+N` marker (`village/pens.ts`).
- Static farm plot tiles recolour from live unlocks (`farm/visuals.ts`).
- Spires: the 26 m NE spire visually near-ties the corner tower's decorative roof apex (~26.4 m); gargoyle-perch clearance (18 m) is what matters and holds. Bump to ~28 m if the silhouette should unambiguously win.
