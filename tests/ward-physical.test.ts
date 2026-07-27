import { describe, it, expect } from 'vitest';
import { castleLayout, castleObstacles } from '../src/castle/layout.ts';
import { wardObstaclesNear, wardLayout } from '../src/castle/ward.ts';
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
// ---------------------------------------------------------------------------

const PLAYER_R = 0.35; // matches INPUT.playerRadius's ballpark; conservative
const STEP = 0.5; // metres per BFS grid cell

describe('ward physical connectivity (collision-circle BFS, Castle Ward Fix 1)', () => {
  it('the keep interior (crystal position) is reachable on foot from the gate', () => {
    const l = castleLayout();
    // Obstacle sets are each memoised internally (`castleObstacles`,
    // `wardObstaclesNear`'s spatial hash) — fetch the castle set once here so
    // the BFS's per-cell `blocked()` check only redoes the cheap near-query.
    const castleObs = castleObstacles();

    function blocked(x: number, z: number): boolean {
      for (const o of castleObs) {
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
    const start = wardLayout().gate;
    const [si, sj] = toIJ(start.x, start.z);
    expect(blocked(start.x, start.z)).toBe(false);

    const seen = new Uint8Array((N + 1) * (N + 1));
    const queue: [number, number][] = [[si, sj]];
    seen[idx(si, sj)] = 1;

    const [ci, cj] = toIJ(l.crystalPos.x, l.crystalPos.z);
    let reachedCrystal = false;

    while (queue.length > 0) {
      const [i, j] = queue.pop()!;
      if (Math.abs(i - ci) <= 1 && Math.abs(j - cj) <= 1) reachedCrystal = true;
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

    expect(reachedCrystal).toBe(true);
  });
});
