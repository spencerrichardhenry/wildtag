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
