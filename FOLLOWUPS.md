# Known fast-follows

Deferred, non-blocking cleanups noted during the whole-branch review. One line each, with file refs.

- Zipline rider-clearance validation: `structures/ziplines.ts` should validate the cable sits ≥ `losClearance + ziplineHang` above ground, not just the current 0.5 m floor — low lines drag the rider along the ground.
- Field Guide is static while open (`ui/guide.ts`): it snapshots on open and never refreshes, so a Link landing while the panel is up isn't reflected until reopen.
- Grounded-grapple jitter guard (`player/controller.ts` / `player/grapple.ts`): auto-zipping into a surface while grounded can jitter the player; add a settle/clamp guard.
- Tracking-ring anchor height on tall species (`ui/hud.ts` / `critters/manager.ts`): the ring anchors low on large models (e.g. Lumen Stag) — anchor to model height.
- Shared per-step critter `list()` snapshot (`critters/manager.ts`): tracker + HUD + darts each call `list()` per frame — take one shared per-step snapshot to cut allocation churn.
- Chunk-manager early-return when the player chunk is unchanged (`world/chunks.ts`): skip the rebuild scan when the player hasn't crossed a chunk boundary.
- Buffered-jump landing float-compare brittleness (`player/controller.ts` `landedDuringStep`): the `next.vel.y === MOVE.jumpVel` exact compare is brittle — use an epsilon or an explicit landing flag.
- e2e single-retry masks transient SwiftShader crashes (`e2e/verify.mjs`): the one automatic retry can hide a genuinely flaky/crashing phase — surface repeated retries.

## Haven Village (phase 2)

Resolved in V7 (recorded for the trail): the V4 barter request now persists concretely so reloads never swap it (save `barter[].request`); pen rendering is capped at 8 models per pen with a `+N` marker (`village/pens.ts`); static farm plot tiles now recolour from live unlocks (`farm/visuals.ts`).

Still open (deferred, non-blocking):

- Released critters are ephemeral (`main.ts` `releaseFromRoster` / `critters/manager.ts`): a critter released from the roster respawns as a fresh wild slot but isn't persisted, so it vanishes on reload while its original slot stays consumed. Persist released critters (or re-open the original slot).
- Nickname RNG is not persisted (`main.ts` `rosterRng`): the bonded-nickname PRNG reseeds from `WORLD_SEED` each boot, so a fresh session can regenerate a name already in use — cosmetic duplicates. Persist the RNG cursor (or the next-name index).
- Prismhorse tri budget (`critters/models.ts`): the 16-legged crystal mount is the heaviest model; if instancing many (pens/farm), consider a lower-poly LOD or shared geometry.
- Wedged NPC requests have no reroll (`village/barter.ts` / `village/dialog.ts`): if a request asks for a species the player can no longer obtain (all bonded/traded), there's no way to skip it — add a reroll or a "trade something else" path.
- `window.__village` aid is ungated (`main.ts`): the screenshot helper (`talk`/`lookAt`) is always exposed, not just under a `?debug`/`?dev` flag. Harmless (no gameplay mutation) but should be gated for a release build.
- NPC name-label overlaps (`village/npcs.ts`): labels can overlap when NPCs cluster on the plaza; no de-collision. Cosmetic.
- Banked-production collect semantics (`farm/farm.ts`): a full hopper banks exactly one finished cycle that ships on the first tick after a collect — documented and intended, but worth revisiting if it reads as a "free" batch.
