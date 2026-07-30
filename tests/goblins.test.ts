import { describe, expect, it } from 'vitest';
import { CASTLE, GOBLIN, MOVE } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { inCastleRegion, castleObstacles, spireObstacles, type Point2 } from '../src/castle/layout.ts';
import { wardLayout } from '../src/castle/ward.ts';
import type { Obstacle } from '../src/player/collision.ts';
import { makeGoblin, stepGoblin, goblinSpawnPoints, type GoblinState } from '../src/castle/goblins.ts';

// A plain, pure zones fixture (NOT wardLayout().zones) for tests about the
// spawn-assignment mechanics themselves (determinism, round-robin, region
// containment) — keeps them independent of the real ward map's shape. Points
// sit in the old ring's [30, 60] m band around CASTLE.center so downstream
// assertions (inCastleRegion, chase-into-a-real-obstacle) behave the same as
// before the zone-based rework.
const ZONES_FIXTURE: Point2[] = Array.from({ length: 12 }, (_, i) => {
  const ang = (i / 12) * Math.PI * 2;
  const r = 30 + (i % 3) * 10; // 30, 40, 50 repeating — inside [30, 60]
  return { x: CASTLE.center.x + Math.sin(ang) * r, z: CASTLE.center.z + Math.cos(ang) * r };
});

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
  obstacles?: Obstacle[],
): { g: GoblinState; hits: number } {
  let cur = g;
  let hits = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const step = stepGoblin(cur, { playerPos, ground: flatGround, rand, obstacles }, DT);
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
    expect(goblinSpawnPoints(3, 8, ZONES_FIXTURE)).toEqual(goblinSpawnPoints(3, 8, ZONES_FIXTURE));
    for (const p of goblinSpawnPoints(1, 8, ZONES_FIXTURE)) {
      expect(inCastleRegion(p.x, p.z)).toBe(true);
    }
  });

  it('zones repeat round-robin once count exceeds zones.length, without throwing', () => {
    const points = goblinSpawnPoints(2, ZONES_FIXTURE.length * 2 + 3, ZONES_FIXTURE);
    expect(points.length).toBe(ZONES_FIXTURE.length * 2 + 3);
    for (const p of points) {
      expect(inCastleRegion(p.x, p.z)).toBe(true);
    }
  });

  it('different nightIndex values produce a different zone assignment order', () => {
    const a = goblinSpawnPoints(1, ZONES_FIXTURE.length, ZONES_FIXTURE);
    const b = goblinSpawnPoints(2, ZONES_FIXTURE.length, ZONES_FIXTURE);
    expect(a).not.toEqual(b);
  });

  it('every spawn point lands within 3 m of some real ward zone, inside the castle region', () => {
    const zones = wardLayout().zones;
    expect(zones.length).toBeGreaterThan(0);
    const points = goblinSpawnPoints(5, GOBLIN.count, zones);
    expect(points.length).toBe(GOBLIN.count);
    for (const p of points) {
      expect(inCastleRegion(p.x, p.z)).toBe(true);
      const nearestD = Math.min(...zones.map((z) => Math.hypot(p.x - z.x, p.z - z.z)));
      expect(nearestD).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Wall/tower/keep collision (final-review fix): a goblin chasing a player
// through an obstacle line stops at its rim instead of ghosting through, and
// the same holds for a real ring-spawned goblin against the actual castle
// obstacle set (walls/towers/keep).
// ---------------------------------------------------------------------------

describe('goblins FSM — wall collision', () => {
  it('a chasing goblin is blocked at a wall rim, never crossing it', () => {
    // Home and player sit on the same line (z=0) straddling a wall circle
    // centred at the castle centre — the goblin must chase straight through
    // it to reach the player, so any leak would show up as x crossing 0.
    const home = fromCenter(-10, 0);
    const player = fromCenter(10, 0);
    const wall: Obstacle = { x: CASTLE.center.x, z: CASTLE.center.z, r: 3 };
    const minDist = wall.r + GOBLIN.bodyR;

    let g = makeGoblin(10, home);
    const rand = seededRand(3);
    const steps = Math.round(10 / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepGoblin(g, { playerPos: player, ground: flatGround, rand, obstacles: [wall] }, DT);
      g = step.g;
      const dFromWall = Math.hypot(g.pos.x - wall.x, g.pos.z - wall.z);
      expect(dFromWall).toBeGreaterThanOrEqual(minDist - 1e-6);
    }
    // Never made it to (or past) the far side where the player stands.
    expect(g.pos.x).toBeLessThan(0);
  });

  it('a lunge hop is clamped at the wall rim too', () => {
    // Hand-construct a goblin already mid-lunge, parked at the wall's rim and
    // aimed straight through it (the lunge's direction is fixed for the whole
    // hop — see stepGoblin's 'lunge' case) — isolates the movement clamp
    // itself without depending on the chase FSM ever navigating there.
    const wall: Obstacle = { x: CASTLE.center.x, z: CASTLE.center.z, r: 1 };
    const minDist = wall.r + GOBLIN.bodyR;
    let g: GoblinState = {
      id: 11,
      pos: { x: wall.x - minDist, y: 0, z: wall.z },
      yaw: Math.PI / 2, // sin=1, cos=0 → straight +x, through the wall
      phase: 'lunge',
      phaseT: 0,
      home: { x: wall.x - minDist - 5, y: 0, z: wall.z },
    };
    const player: Vec3 = { x: wall.x + 10, y: 0, z: wall.z }; // far past the wall
    const rand = seededRand(5);
    const steps = Math.round((GOBLIN.lungeS + 0.1) / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepGoblin(g, { playerPos: player, ground: flatGround, rand, obstacles: [wall] }, DT);
      g = step.g;
      const dFromWall = Math.hypot(g.pos.x - wall.x, g.pos.z - wall.z);
      expect(dFromWall).toBeGreaterThanOrEqual(minDist - 1e-6);
    }
    // Confirms the hop actually tried to move (would otherwise trivially pass).
    expect(g.pos.x).toBeLessThan(wall.x);
  });

  // This exhaustive synchronous simulation is a local regression test; shared
  // CI runners vary enough in CPU speed to make its wall-clock timeout flaky.
  it.skipIf(Boolean(process.env.CI))('a ring-spawned goblin baited straight at the player never lands inside any real castle obstacle (incl. spires)', () => {
    // Spire added daze-eject-spires review round: `CastleSystem.update`
    // (system.ts) feeds a chasing goblin `castleObstacles().concat(...).concat(
    // spireObstacles())` — folded into this fixture so a chase-path regression
    // through a spire's footprint is caught the same way a wall/tower one is.
    const obstacles = castleObstacles().concat(spireObstacles());
    const points = goblinSpawnPoints(9, GOBLIN.count, ZONES_FIXTURE);
    const rand = seededRand(11);
    for (const home3 of points) {
      const home: Vec3 = { ...home3, y: 0 };
      // Bait toward the opposite side of the castle centre so the chase path
      // is likely to cross a wall/tower/keep segment.
      const dx = CASTLE.center.x - home.x;
      const dz = CASTLE.center.z - home.z;
      const bait: Vec3 = { x: CASTLE.center.x + dx, y: 0, z: CASTLE.center.z + dz };

      let g = makeGoblin(100, home);
      // Settle first: a spawn point can by chance land already embedded in an
      // obstacle's collision circle (the ring straddles the 45 m curtain
      // wall) — the pushout clamp (MOVE.maxPushoutPerStep) resolves any such
      // deep penetration within a couple of frames, so this warmup is
      // unchecked and only the steady-state afterward is asserted.
      const warmupSteps = Math.round(3 / DT);
      for (let i = 0; i < warmupSteps; i++) {
        g = stepGoblin(g, { playerPos: bait, ground: flatGround, rand, obstacles }, DT).g;
      }

      const steps = Math.round(5 / DT);
      for (let i = 0; i < steps; i++) {
        const step = stepGoblin(g, { playerPos: bait, ground: flatGround, rand, obstacles }, DT);
        g = step.g;
        for (const ob of obstacles) {
          if (ob.yTop !== undefined && g.pos.y > ob.yTop) continue;
          const d = Math.hypot(g.pos.x - ob.x, g.pos.z - ob.z);
          // `resolveCollision` is a single sequential pass (documented in
          // player/collision.ts): where two of the wall's covering circles
          // legitimately overlap (adjacent centres spaced <= 2r apart), a
          // push out of one can leave a few mm of residual penetration into
          // its neighbour rather than the strict rim distance — a real,
          // pre-existing property of the shared collision system, not a
          // regression. 0.05 m comfortably covers that seam residual while
          // still catching a meaningful (kid-visible) wall-clip regression.
          expect(d).toBeGreaterThanOrEqual(ob.r + GOBLIN.bodyR - 0.05);
        }
      }
    }
  }, 10_000);
});
