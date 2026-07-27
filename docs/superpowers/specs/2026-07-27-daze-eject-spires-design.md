# Daze Ejection + Hunting Spires — Design Spec

**Date:** 2026-07-27 · **Branch:** feat/daze-eject-spires (off build/fidelity-2)
**From Spencer's playtest:** (1) "when you lose your health it isn't properly
ejecting you from the castle and dazing you — it just kinda blips you back";
(2) "we need some spires in the castle area tall enough to hunt the gargoyles."

## 1. Maze-aware daze ejection (bug fix + redesign)

Root cause of (1): the dazed retreat walks radially away from CASTLE.center
(built for the pre-ward open courtyard); ward walls + post-step pushout cancel
the motion, so the player jitters in place for the daze window.

New behavior on knockout:
- Compute a corridor path player-cell → gate over the ward map's open cells
  (BFS, pure, in ward.ts: `retreatPath(x, z): Point2[]` — world-coord
  waypoints, [] if already outside the walls).
- Stumble follows waypoints at `HEALTH.stumbleSpeed` (7 m/s): steer toward the
  next waypoint, advance within 1 m. Input stays suppressed (existing mask).
- Daze window `HEALTH.dazedS` 3 → 4 s. If the player is still inside the
  walled footprint when it ends: the daze veil deepens to full black over
  ~0.4 s, the player is placed just outside the gate (gate + ~8 m outward,
  ground-snapped), veil lifts, HP refills ("the goblins dragged you out").
  If already outside (walked out or knocked out outside): no blackout, daze
  ends in place as today.
- Knockouts far from the castle (not inCastleRegion): keep the old radial
  stumble (no maze there) with no blackout.
- Regression test: simulated knockout at a deep-maze cell ends with the
  player outside the curtain walls with full HP.

## 2. Gargoyle-hunting spires

- 5 slender stone pinnacles (tapered, crag-spire silhouette, castle stone
  palettes, cursed + purified dressings), authored positions in a
  `SPIRES` constant block: one per plaza (at a corner cell of each) + 2 in
  open cells near the NE and SW corner towers.
- Heights 22–26 m (above tower perches 18 m and keep 20 m). Base r ≈ 2 m.
- Grapple colliders full height (yBase padHeight → yTop padHeight + h);
  obstacle circle r ≈ 1.6 so they block walking but never a corridor
  (positions are on plaza/open cells with clearance — test-enforced).
- Tests: each spire on an open non-corridor-blocking cell; grapple yTop
  values; physical gate→crystal BFS still passes with spire obstacles added.
- e2e: refresh castle vantage screenshot; assert a spire grapple collider
  exists via debug state if cheap, else visual only.

## Invariants
Free flight unchanged (spires are static grapple anchors like towers);
heightAt only ground truth; constants in constants.ts; pure modules pure;
save format unchanged.

## Out of scope
Goblin/gargoyle awareness of spires; spire interiors; more than 5 spires.
