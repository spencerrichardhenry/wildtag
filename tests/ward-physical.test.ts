import { describe, it, expect } from 'vitest';
import { castleLayout, castleObstacles, spireObstacles } from '../src/castle/layout.ts';
import { wardObstaclesNear, wardLayout, cellToWorld } from '../src/castle/ward.ts';
import { CASTLE } from '../src/core/constants.ts';

// ---------------------------------------------------------------------------
// Physical (collision-level) reachability test — Castle Ward final-review
// Fix 1. The map-symbol BFS in `ward.test.ts` proves the ASCII grid is one
// connected component, but that grid is a design abstraction; it does NOT
// prove a player's actual COLLIDER BODY can walk the corresponding path. Two
// independently-authored collider rims (the keep's own wall obstacles from
// `castleObstacles()` and the ward maze's wall obstacles from
// `wardObstaclesNear`) can each individually look fine on the map yet overlap
// in world space and seal a doorway that the map says is open — exactly what
// happened at the keep entrance (ward map col 20 was solid on both sides of
// the keep-wall collision rim). This test BFS's over the real collision
// circles, at the real player body radius, so a regression here means an
// actual gameplay dead end, not just a map-authoring slip.
//
// Orphaned-pocket follow-up (daze-eject-spires test round): the map-symbol
// BFS treats every K cell as open in every direction, so IT would have missed
// an alcove whose only non-K exit was sealed by a real 3D keep wall (the
// tile-map abstraction has no notion of "this K/non-K crossing has no door").
// This physical BFS doesn't have that blind spot — a real keep wall really is
// `blocked()` here — so it doubles as the regression guard for that class of
// bug: every plaza/hall center, the crystal, AND a representative cell from
// the alcove wardMap.ts's fix (opening (13,10)) reconnected must all still
// show up in the SAME single collision-level reachable set computed below.
//
// Gargoyle-hunting spires (daze-eject-spires design spec §2) add 5 more
// obstacle circles (`spireObstacles()`) into this exact BFS's `blocked()` —
// they're authored on plaza-corner/dead-end-alcove cells specifically so
// they never sit astride a corridor, and this is the honest regression check
// for that claim: the whole reachable set (gate to crystal/plazas/halls/
// pocket) must still hold with every spire obstacle folded in.
// ---------------------------------------------------------------------------

const PLAYER_R = 0.35; // matches INPUT.playerRadius's ballpark; conservative
const STEP = 0.5; // metres per BFS grid cell

describe('ward physical connectivity (collision-circle BFS, Castle Ward Fix 1)', () => {
  it('the keep interior (crystal), every plaza/hall center, and the former orphaned pocket are all reachable on foot from the gate, with the gargoyle-hunting spires obstacles in the set', () => {
    const l = castleLayout();
    const wl = wardLayout();
    // Obstacle sets are each memoised internally (`castleObstacles`,
    // `wardObstaclesNear`'s spatial hash, `spireObstacles`) — fetch the
    // fixed-size sets once here so the BFS's per-cell `blocked()` check only
    // redoes the cheap near-query for the ward's spatial hash.
    const castleObs = castleObstacles();
    const spireObs = spireObstacles();

    function blocked(x: number, z: number): boolean {
      for (const o of castleObs) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + PLAYER_R) return true;
      }
      for (const o of spireObs) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + PLAYER_R) return true;
      }
      for (const o of wardObstaclesNear(x, z)) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + PLAYER_R) return true;
      }
      return false;
    }

    // Grid spans the castle pad with a small margin beyond the curtain wall.
    const half = CASTLE.half + 8;
    const cx = CASTLE.center.x;
    const cz = CASTLE.center.z;
    const N = Math.ceil((half * 2) / STEP);

    const idx = (i: number, j: number): number => i * (N + 1) + j;
    const toIJ = (x: number, z: number): [number, number] => [
      Math.round((x - (cx - half)) / STEP),
      Math.round((z - (cz - half)) / STEP),
    ];
    const toXZ = (i: number, j: number): [number, number] => [cx - half + i * STEP, cz - half + j * STEP];

    // Start just outside the gate (world position from the ward parser).
    const start = wl.gate;
    const [si, sj] = toIJ(start.x, start.z);
    expect(blocked(start.x, start.z)).toBe(false);

    const seen = new Uint8Array((N + 1) * (N + 1));
    const queue: [number, number][] = [[si, sj]];
    seen[idx(si, sj)] = 1;

    while (queue.length > 0) {
      const [i, j] = queue.pop()!;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
        if (seen[idx(ni, nj)]) continue;
        seen[idx(ni, nj)] = 1;
        const [nx, nz] = toXZ(ni, nj);
        if (blocked(nx, nz)) continue;
        queue.push([ni, nj]);
      }
    }

    /** True when a 3×3 block of grid cells around (x, z) was visited by the
     *  BFS above — a small tolerance so a target that lands exactly on a
     *  grid-line rounding boundary still reads as reached. */
    function reached(x: number, z: number): boolean {
      const [ti, tj] = toIJ(x, z);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const ni = ti + di;
          const nj = tj + dj;
          if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
          if (seen[idx(ni, nj)]) return true;
        }
      }
      return false;
    }

    expect(reached(l.crystalPos.x, l.crystalPos.z)).toBe(true);

    for (const p of wl.plazas) {
      expect(reached(p.center.x, p.center.z)).toBe(true);
    }
    for (const h of wl.halls) {
      expect(reached(h.center.x, h.center.z)).toBe(true);
    }

    // Representative cell from the alcove wardMap.ts's fix reconnected
    // (rows 13-17 / cols 11-16 — see WARD_MAP's (13,10) opening comment and
    // the "no phantom keep crossings" / orphaned-pocket tests in
    // ward.test.ts). Physically reachable now that it has a real, non-keep
    // doorway out — this is the guard against the tile-map-only BFS's blind
    // spot (it can't tell a sealed real wall from an open tile-map boundary).
    const pocketCell = cellToWorld(15, 17); // (row 17, col 15)
    expect(reached(pocketCell.x, pocketCell.z)).toBe(true);
  });
});
