import { describe, expect, it } from 'vitest';
import { CASTLE, GOBLIN, MOVE } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { inCastleRegion } from '../src/castle/layout.ts';
import { makeGoblin, stepGoblin, goblinSpawnPoints, type GoblinState } from '../src/castle/goblins.ts';

// ---------------------------------------------------------------------------
// Pure FSM tests (Cursed Castle Task 11). Flat ground + a seeded rand so every
// scenario is deterministic; `stepGoblin` never touches `three`. Every goblin
// is homed near CASTLE.center (goblins are always clamped inside
// CASTLE.regionR of it — see stepGoblin's step 3 — so a home at the world
// origin would just get radially yanked to the region boundary and break
// every position assumption below).
// ---------------------------------------------------------------------------

const flatGround: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

/** Offset an (x, z) delta from the castle centre into a world Vec3. */
function fromCenter(dx: number, dz: number): Vec3 {
  return { x: CASTLE.center.x + dx, y: 0, z: CASTLE.center.z + dz };
}

function seededRand(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;

function run(
  g: GoblinState,
  playerPos: Vec3,
  seconds: number,
  rand: () => number = seededRand(),
): { g: GoblinState; hits: number } {
  let cur = g;
  let hits = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const step = stepGoblin(cur, { playerPos, ground: flatGround, rand }, DT);
    cur = step.g;
    if (step.hitPlayer) hits++;
  }
  return { g: cur, hits };
}

describe('goblins FSM', () => {
  it('chase speed is strictly below player sprint speed', () => {
    expect(GOBLIN.chaseSpeed).toBeGreaterThan(0);
    expect(GOBLIN.chaseSpeed).toBeLessThan(MOVE.sprint);
  });

  it('patrols until player enters noticeR, then alerts and chases', () => {
    const home = fromCenter(0, 0);
    let g = makeGoblin(1, home);

    // Player far away: stays patrol indefinitely.
    const far = fromCenter(500, 500);
    const { g: stillPatrol } = run(g, far, 3);
    expect(stillPatrol.phase).toBe('patrol');

    // Player moves to 15 m (inside noticeR=20): eventually reaches 'chase'.
    const near = fromCenter(15, 0);
    g = stillPatrol;
    let sawAlert = false;
    let reachedChase = false;
    for (let i = 0; i < Math.round(5 / DT); i++) {
      const step = stepGoblin(g, { playerPos: near, ground: flatGround, rand: seededRand() }, DT);
      g = step.g;
      if (g.phase === 'alert') sawAlert = true;
      if (g.phase === 'chase') {
        reachedChase = true;
        break;
      }
    }
    expect(sawAlert).toBe(true);
    expect(reachedChase).toBe(true);
  });

  it('lunges within range and reports a hit exactly once per lunge', () => {
    const home = fromCenter(0, 0);
    const g = makeGoblin(2, home);
    // Park the player 1.0 m away — well inside noticeR/lungeRange/hitRange.
    const playerPos = fromCenter(1.0, 0);

    let cur = g;
    let hits = 0;
    let sawLunge = false;
    for (let i = 0; i < Math.round(6 / DT); i++) {
      const step = stepGoblin(cur, { playerPos, ground: flatGround, rand: seededRand() }, DT);
      cur = step.g;
      if (cur.phase === 'lunge') {
        sawLunge = true;
        if (step.hitPlayer) hits++;
      } else if (sawLunge) {
        // Lunge phase has ended — stop counting (one full lunge observed).
        break;
      }
    }
    expect(sawLunge).toBe(true);
    expect(hits).toBe(1);
  });

  it('gives up beyond giveUpR and returns to patrol', () => {
    const home = fromCenter(0, 0);
    let g = makeGoblin(3, home);
    const near = fromCenter(10, 0);

    // Get it chasing.
    let reachedChase = false;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      const step = stepGoblin(g, { playerPos: near, ground: flatGround, rand: seededRand() }, DT);
      g = step.g;
      if (g.phase === 'chase') {
        reachedChase = true;
        break;
      }
    }
    expect(reachedChase).toBe(true);

    // Player teleports far beyond giveUpR (40 m) — goblin should give up.
    const far = fromCenter(1000, 1000);
    let backToPatrol = false;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      const step = stepGoblin(g, { playerPos: far, ground: flatGround, rand: seededRand() }, DT);
      g = step.g;
      if (g.phase === 'patrol') {
        backToPatrol = true;
        break;
      }
    }
    expect(backToPatrol).toBe(true);
  });

  it('never exits the castle region', () => {
    const home = fromCenter(0, 0);
    let g = makeGoblin(4, home);
    // Bait the goblin with a player planted far outside the castle region.
    const bait = fromCenter(5000, 0);
    const rand = seededRand(7);
    const steps = Math.round(30 / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepGoblin(g, { playerPos: bait, ground: flatGround, rand }, DT);
      g = step.g;
      expect(inCastleRegion(g.pos.x, g.pos.z)).toBe(true);
    }
  });

  it('spawn points are deterministic per night and inside the region', () => {
    expect(goblinSpawnPoints(3, 8)).toEqual(goblinSpawnPoints(3, 8));
    for (const p of goblinSpawnPoints(1, 8)) {
      expect(inCastleRegion(p.x, p.z)).toBe(true);
    }
  });
});
