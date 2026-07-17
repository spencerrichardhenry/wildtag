# Known fast-follows

Deferred, non-blocking cleanups noted during the whole-branch review. The
backlog below has been cleared on `chore/followups`; what remains is a short
"deliberately kept" list of items intentionally left as-is (with reasons), plus
a trail of what was resolved.

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
