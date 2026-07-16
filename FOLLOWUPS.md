# Known fast-follows

Deferred, non-blocking cleanups noted during the whole-branch review. One line each, with file refs.

- Zipline rider-clearance validation: `structures/ziplines.ts` should validate the cable sits ≥ `losClearance + ziplineHang` above ground, not just the current 0.5 m floor — low lines drag the rider along the ground.
- Field Guide is static while open (`ui/guide.ts`): it snapshots on open and never refreshes, so a Link landing while the panel is up isn't reflected until reopen.
- Grounded-grapple jitter guard (`player/controller.ts` / `player/grapple.ts`): reeling into a surface while grounded can jitter the player; add a settle/clamp guard.
- Tracking-ring anchor height on tall species (`ui/hud.ts` / `critters/manager.ts`): the ring anchors low on large models (e.g. Lumen Stag) — anchor to model height.
- Shared per-step critter `list()` snapshot (`critters/manager.ts`): tracker + HUD + darts each call `list()` per frame — take one shared per-step snapshot to cut allocation churn.
- Chunk-manager early-return when the player chunk is unchanged (`world/chunks.ts`): skip the rebuild scan when the player hasn't crossed a chunk boundary.
- Buffered-jump landing float-compare brittleness (`player/controller.ts` `landedDuringStep`): the `next.vel.y === MOVE.jumpVel` exact compare is brittle — use an epsilon or an explicit landing flag.
- e2e single-retry masks transient SwiftShader crashes (`e2e/verify.mjs`): the one automatic retry can hide a genuinely flaky/crashing phase — surface repeated retries.
