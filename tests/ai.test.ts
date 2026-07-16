import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { stepAI, type AIContext } from '../src/critters/ai.ts';
import { CritterManager, spawnSlotsForCell } from '../src/critters/manager.ts';
import { speciesById } from '../src/critters/species.ts';
import type { Biome, CritterState, GroundQuery, SpeciesDef, Vec3 } from '../src/core/types.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { AI } from '../src/core/constants.ts';

// ---------------------------------------------------------------------------
// Test scaffolding: flat ground, simple biome fields, and a critter factory.
// ---------------------------------------------------------------------------

const flatGround: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

const allMeadow = (): Biome => 'meadow';
/** Water everywhere east of x=0, meadow to the west. */
const waterEast = (x: number): Biome => (x > 0 ? 'water' : 'meadow');

function sp(id: string): SpeciesDef {
  const s = speciesById(id);
  if (!s) throw new Error(`no species ${id}`);
  return s;
}

function makeCritter(species: string, overrides: Partial<CritterState> = {}): CritterState {
  return {
    id: 1,
    species,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    state: 'idle',
    stateTime: 0,
    targetYaw: 0,
    tagged: false,
    linked: false,
    trackProgress: 0,
    home: { x: 0, y: 0, z: 0 },
    flightHeight: 12,
    stateDur: 3,
    farTime: 0,
    ...overrides,
  };
}

function ctx(
  species: string,
  playerPos: Vec3,
  biomeAt: (x: number, z: number) => Biome = allMeadow,
  rand: () => number = mulberry32(42),
): AIContext {
  return { playerPos, species: sp(species), ground: flatGround, biomeAt, rand };
}

/** Step a critter `n` times of `dt` seconds through a fresh ctx each call. */
function run(
  c: CritterState,
  species: string,
  playerPos: Vec3,
  dt: number,
  n: number,
  biomeAt?: (x: number, z: number) => Biome,
  rand: () => number = mulberry32(7),
): CritterState {
  let cur = c;
  for (let i = 0; i < n; i++) cur = stepAI(cur, ctx(species, playerPos, biomeAt, rand), dt);
  return cur;
}

const horiz = (v: Vec3) => Math.hypot(v.x, v.z);

// ---------------------------------------------------------------------------
// Alert triggering
// ---------------------------------------------------------------------------

describe('alert threshold', () => {
  it('alerts exactly at the species awareness radius', () => {
    const s = sp('skitterling'); // awareness 14, flees
    const at = makeCritter('skitterling', { state: 'idle' });
    const stepped = stepAI(at, ctx('skitterling', { x: s.awareness, y: 0, z: 0 }), 0.1);
    expect(stepped.state).toBe('alert');
  });

  it('does not alert just beyond awareness', () => {
    const s = sp('skitterling');
    const c = makeCritter('skitterling', { state: 'idle' });
    const stepped = stepAI(c, ctx('skitterling', { x: s.awareness + 0.5, y: 0, z: 0 }), 0.1);
    expect(stepped.state).not.toBe('alert');
  });

  it('never alerts a fleeStyle:none species (puffle) even point-blank', () => {
    const c = makeCritter('puffle', { state: 'wander' });
    const out = run(c, 'puffle', { x: 1, y: 0, z: 0 }, 0.1, 30);
    expect(out.state).not.toBe('alert');
    expect(out.state).not.toBe('flee');
  });

  it('never alerts a linked critter within awareness', () => {
    const c = makeCritter('skitterling', { state: 'wander', linked: true });
    const out = run(c, 'skitterling', { x: 1, y: 0, z: 0 }, 0.1, 30);
    expect(out.state).not.toBe('alert');
    expect(out.state).not.toBe('flee');
  });
});

// ---------------------------------------------------------------------------
// Alert -> flee timing
// ---------------------------------------------------------------------------

describe('alert to flee', () => {
  it('flees after AI.alertTime seconds facing the player', () => {
    const c = makeCritter('skitterling', { state: 'alert', stateTime: 0 });
    const player = { x: 10, y: 0, z: 0 };
    const before = run(c, 'skitterling', player, 0.1, Math.floor((AI.alertTime - 0.2) / 0.1));
    expect(before.state).toBe('alert');
    const after = run(c, 'skitterling', player, 0.1, Math.ceil((AI.alertTime + 0.2) / 0.1));
    expect(after.state).toBe('flee');
  });
});

// ---------------------------------------------------------------------------
// Flee direction + styles
// ---------------------------------------------------------------------------

describe('flee direction', () => {
  it('moves away from the player (velocity dot toward-player < 0)', () => {
    const player = { x: 10, y: 0, z: 0 };
    const awayYaw = Math.atan2(-player.x, -player.z);
    const c = makeCritter('skitterling', { state: 'flee', stateTime: 0, yaw: awayYaw });
    const out = stepAI(c, ctx('skitterling', player), 0.2);
    const toPlayer = { x: player.x - out.pos.x, z: player.z - out.pos.z };
    expect(out.vel.x * toPlayer.x + out.vel.z * toPlayer.z).toBeLessThan(0);
  });
});

describe('zigzag flee', () => {
  it('changes heading across a swerve period', () => {
    const player = { x: 20, y: 0, z: 0 };
    const awayYaw = Math.atan2(-player.x, -player.z);
    let c = makeCritter('emberpup', { state: 'flee', stateTime: 0, yaw: awayYaw });
    // sample yaw within the first swerve leg and within the second
    for (let i = 0; i < 3; i++) c = stepAI(c, ctx('emberpup', player), 0.1);
    const yawA = c.yaw;
    for (let i = 0; i < 8; i++) c = stepAI(c, ctx('emberpup', player), 0.1);
    const yawB = c.yaw;
    expect(Math.abs(yawA - yawB)).toBeGreaterThan(0.2);
  });
});

describe('sprint flee', () => {
  it('has a burst/pause cadence (moves, then briefly stops)', () => {
    const player = { x: 10, y: 0, z: 0 };
    const awayYaw = Math.atan2(-player.x, -player.z);
    let c = makeCritter('skitterling', { state: 'flee', stateTime: 0, yaw: awayYaw });
    const dt = 0.1;
    let burstSpeed = 0;
    let pauseSpeed = Infinity;
    for (let i = 0; i < 20; i++) {
      c = stepAI(c, ctx('skitterling', player), dt);
      const t = c.stateTime;
      if (t > 0.3 && t < AI.sprintBurst) burstSpeed = Math.max(burstSpeed, horiz(c.vel));
      if (t > AI.sprintBurst + 0.05 && t < AI.sprintBurst + AI.sprintPause) {
        pauseSpeed = Math.min(pauseSpeed, horiz(c.vel));
      }
    }
    expect(burstSpeed).toBeGreaterThan(3);
    expect(pauseSpeed).toBeLessThan(0.5);
  });
});

describe('fly flee', () => {
  it('rises toward its flight height when fleeing', () => {
    const player = { x: 15, y: 0, z: 0 };
    const c = makeCritter('zephyrfinch', {
      state: 'flee',
      stateTime: 0,
      flightHeight: 12,
      pos: { x: 0, y: 0, z: 0 },
    });
    const out = run(c, 'zephyrfinch', player, 0.1, 60); // 6 s
    expect(out.pos.y).toBeGreaterThan(6);
    expect(out.pos.y).toBeLessThanOrEqual(12 + 0.5);
  });
});

describe('swim flee', () => {
  it('stays in water even when fleeing would cross onto land', () => {
    // Water east (x>0); player also east so away-from-player points at land.
    const player = { x: 6, y: 0, z: 0 };
    let c = makeCritter('mirefin', {
      state: 'flee',
      stateTime: 0,
      pos: { x: 2, y: 0, z: 0 },
      home: { x: 2, y: 0, z: 0 },
    });
    const dt = 0.1;
    for (let i = 0; i < 40; i++) {
      c = stepAI(c, ctx('mirefin', player, waterEast), dt);
      expect(waterEast(c.pos.x, c.pos.z)).toBe('water');
    }
  });
});

describe('land water avoidance', () => {
  it('a land critter never steps into a water biome', () => {
    // Water east (x>0); player west so away-from-player points at the water.
    const player = { x: -8, y: 0, z: 0 };
    let c = makeCritter('skitterling', {
      state: 'flee',
      stateTime: 0,
      pos: { x: -1, y: 0, z: 0 },
      home: { x: -1, y: 0, z: 0 },
    });
    const dt = 0.1;
    for (let i = 0; i < 60; i++) {
      c = stepAI(c, ctx('skitterling', player, waterEast), dt);
      expect(waterEast(c.pos.x, c.pos.z)).not.toBe('water');
    }
  });
});

// ---------------------------------------------------------------------------
// Flee -> calm -> wander
// ---------------------------------------------------------------------------

describe('flee to calm to wander', () => {
  it('calms once the player is far, then returns to wander', () => {
    const player = { x: 200, y: 0, z: 0 }; // well beyond awareness*1.6
    let c = makeCritter('skitterling', { state: 'flee', stateTime: 0, farTime: 0 });
    const dt = 0.1;
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < Math.ceil((AI.calmTriggerTime + AI.calmTime + 1) / dt); i++) {
      c = stepAI(c, ctx('skitterling', player, allMeadow, mulberry32(3)), dt);
      seen[c.state] = true;
      if (i === Math.floor((AI.calmTriggerTime + 0.5) / dt)) expect(c.state).toBe('calm');
    }
    expect(seen.calm).toBe(true);
    expect(c.state).toBe('wander');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same inputs (incl. rand seed) produce identical output', () => {
    const player = { x: 5, y: 0, z: 0 };
    const a = run(makeCritter('puffle', { state: 'wander' }), 'puffle', player, 1 / 60, 600, allMeadow, mulberry32(99));
    const b = run(makeCritter('puffle', { state: 'wander' }), 'puffle', player, 1 / 60, 600, allMeadow, mulberry32(99));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Spawn tables (pure)
// ---------------------------------------------------------------------------

describe('spawn table determinism', () => {
  it('produces identical slots for the same cell twice', () => {
    expect(spawnSlotsForCell(0, 0)).toEqual(spawnSlotsForCell(0, 0));
    expect(spawnSlotsForCell(-3, 5)).toEqual(spawnSlotsForCell(-3, 5));
  });

  it('gives distinct cells distinct slot ids', () => {
    const a = spawnSlotsForCell(0, 0).map((s) => s.id);
    const b = spawnSlotsForCell(1, 0).map((s) => s.id);
    for (const id of a) expect(b).not.toContain(id);
  });
});

describe('lumen stag scarcity', () => {
  it('never spawns a lumen stag in cells near the origin', () => {
    const cells = Math.ceil(AI.lumenMinDist / AI.cellSize) + 1;
    for (let cx = -cells; cx <= cells; cx++) {
      for (let cz = -cells; cz <= cells; cz++) {
        const centerDist = Math.hypot((cx + 0.5) * AI.cellSize, (cz + 0.5) * AI.cellSize);
        if (centerDist > AI.lumenMinDist) continue;
        for (const slot of spawnSlotsForCell(cx, cz)) {
          expect(slot.species).not.toBe('lumenstag');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Manager streaming (three.js scene)
// ---------------------------------------------------------------------------

describe('CritterManager streaming', () => {
  it('activates critters near the player and exposes them via list()', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    mgr.update(1 / 60, { x: 0, y: 0, z: 0 });
    const list = mgr.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(AI.maxActive);
  });

  it('persists tagged/linked state across deactivate + reactivate', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    mgr.update(1 / 60, { x: 0, y: 0, z: 0 });
    const first = mgr.list()[0]!;
    mgr.setTagged(first.id);
    mgr.setLinked(first.id);
    // Move far away so the slot deactivates, then back.
    mgr.update(1 / 60, { x: 5000, y: 0, z: 5000 });
    expect(mgr.byId(first.id)).toBeUndefined();
    mgr.update(1 / 60, { x: 0, y: 0, z: 0 });
    const again = mgr.byId(first.id);
    expect(again).toBeDefined();
    expect(again!.tagged).toBe(true);
    expect(again!.linked).toBe(true);
  });
});
