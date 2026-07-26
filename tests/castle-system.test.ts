import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CASTLE, GOBLIN } from '../src/core/constants.ts';
import type { DaylightSample } from '../src/core/daylight.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { CastleSystem } from '../src/castle/system.ts';

// ---------------------------------------------------------------------------
// CastleSystem (Cursed Castle Task 11): the three.js presentation/spawning
// layer over the pure goblin FSM. No DOM dependency — `new THREE.Scene()`
// works headlessly here exactly as it does in tests/structures.test.ts for
// ZiplineSystem/DroneSystem.
// ---------------------------------------------------------------------------

const DT = 1 / 60;

const flatGround: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

/** A player position far from the castle so goblins stay in patrol (never
 *  chase/lunge) — these tests are about spawn/despawn bookkeeping only. */
const FAR_PLAYER: Vec3 = { x: 0, y: 0, z: 0 };

function sampleFor(phase: DaylightSample['phase']): DaylightSample {
  return { phase, darkness: phase === 'day' ? 0 : 1, cycleT: 0 };
}

/**
 * Mutable-purified test harness: `purified()` reads back a local flag that
 * `onPurified()` flips true — mirrors main.ts's real `let castlePurified`
 * closure, so `purifyCastle()`'s idempotency (second call is a no-op) is
 * actually exercised the same way it is in production.
 */
function makeSystem(
  purified = false,
  onPlayerHit: (dmg: number, from: Vec3) => void = () => {},
  extra: {
    onPurified?: () => void;
    addElf?: (pos: Vec3) => void;
    flashPurify?: () => void;
  } = {},
) {
  let purifiedFlag = purified;
  return new CastleSystem(new THREE.Scene(), flatGround, {
    onPlayerHit,
    purified: () => purifiedFlag,
    onPurified: () => {
      purifiedFlag = true;
      extra.onPurified?.();
    },
    addElf: extra.addElf ?? (() => {}),
    flashPurify: extra.flashPurify ?? (() => {}),
  });
}

describe('CastleSystem', () => {
  it('spawns GOBLIN.count goblins at dusk and despawns them at day', () => {
    const sys = makeSystem();
    expect(sys.goblinCount()).toBe(0);

    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);

    sys.update(DT, FAR_PLAYER, sampleFor('day'));
    expect(sys.goblinCount()).toBe(0);
  });

  it('spawns on a direct night jump too (presence, not just a dusk edge)', () => {
    const sys = makeSystem();
    sys.update(DT, FAR_PLAYER, sampleFor('night'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);
  });

  it('a debug-spawned goblin survives the automatic day/night despawn cycle', () => {
    const sys = makeSystem();
    // Still day: spawnOne bypasses phase/purified entirely.
    const debugId = sys.spawnOne({ x: 10, y: 0, z: 10 });
    expect(sys.goblinCount()).toBe(1);

    // Another `update()` call while still day must NOT wipe it out (the bug:
    // a headcount-based despawn trigger used to fire here).
    sys.update(DT, FAR_PLAYER, sampleFor('day'));
    expect(sys.goblinCount()).toBe(1);

    // A full night cycle (spawns the real ring, then despawns it at day)
    // must leave the debug goblin standing throughout.
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(1 + GOBLIN.count);
    sys.update(DT, FAR_PLAYER, sampleFor('day'));
    expect(sys.goblinCount()).toBe(1); // only the debug goblin remains

    expect(sys.goblinTargets().some((t) => t.id === debugId)).toBe(true);
  });

  it('purifying every night goblin mid-night does not trigger a mid-night respawn', () => {
    const sys = makeSystem();
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);

    for (const t of sys.goblinTargets()) sys.purifyGoblin(t.id);
    expect(sys.goblinCount()).toBe(0);

    // Still the same night (`want` stays true) — must stay clear, not
    // reinterpret the empty roster as "haven't spawned yet" and respawn 8.
    for (let i = 0; i < 5; i++) sys.update(DT, FAR_PLAYER, sampleFor('night'));
    expect(sys.goblinCount()).toBe(0);

    // Only the presence's OWN falling edge (night → day → next dusk) may
    // spawn again.
    sys.update(DT, FAR_PLAYER, sampleFor('day'));
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);
  });

  it('never spawns while purified', () => {
    const sys = makeSystem(true);
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(0);
    sys.update(DT, FAR_PLAYER, sampleFor('night'));
    expect(sys.goblinCount()).toBe(0);
  });

  it('reports a lunge hit through onPlayerHit with damage + a position', () => {
    const hits: { dmg: number; from: Vec3 }[] = [];
    const sys = makeSystem(false, (dmg, from) => hits.push({ dmg, from }));
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    const targets = sys.goblinTargets();
    expect(targets.length).toBe(GOBLIN.count);

    // Park the player right on top of the first goblin and step until it
    // lunges and connects (patrol → alert → chase → windup → lunge).
    const playerPos = { ...targets[0]!.pos };
    for (let i = 0; i < Math.round(10 / DT) && hits.length === 0; i++) {
      sys.update(DT, playerPos, sampleFor('night'));
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.dmg).toBe(GOBLIN.damage);
  });

  it('goblinTargets stays inside the castle region', () => {
    const sys = makeSystem();
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    for (const t of sys.goblinTargets()) {
      const d = Math.hypot(t.pos.x - CASTLE.center.x, t.pos.z - CASTLE.center.z);
      expect(d).toBeLessThanOrEqual(CASTLE.regionR);
      expect(t.r).toBe(GOBLIN.hitRadius);
    }
  });

  // -------------------------------------------------------------------------
  // Dark crystal + purify sequence (Cursed Castle Task 14).
  // -------------------------------------------------------------------------

  it('crystalTarget().active flips false the moment the castle is purified', () => {
    const sys = makeSystem();
    expect(sys.crystalTarget().active).toBe(true);
    expect(sys.crystalTarget().r).toBe(1.4);
    sys.purifyCastle();
    expect(sys.crystalTarget().active).toBe(false);
  });

  it('purifyCastle turns every live goblin into an elf exactly once (idempotent)', () => {
    const elfSpawns: Vec3[] = [];
    let purifiedCalls = 0;
    let flashCalls = 0;
    const sys = makeSystem(false, () => {}, {
      addElf: (pos) => elfSpawns.push(pos),
      onPurified: () => {
        purifiedCalls++;
      },
      flashPurify: () => {
        flashCalls++;
      },
    });
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);

    sys.purifyCastle();
    expect(elfSpawns.length).toBe(GOBLIN.count);
    expect(sys.goblinCount()).toBe(0);
    expect(purifiedCalls).toBe(1);
    expect(flashCalls).toBe(1);

    // A second call (e.g. a stray dart passing through the now-inactive
    // crystal, or a debug double-call) must be a total no-op.
    sys.purifyCastle();
    expect(elfSpawns.length).toBe(GOBLIN.count);
    expect(purifiedCalls).toBe(1);
    expect(flashCalls).toBe(1);
  });

  it('after purifyCastle, a dusk transition spawns zero goblins', () => {
    const sys = makeSystem();
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(GOBLIN.count);

    sys.purifyCastle();
    expect(sys.goblinCount()).toBe(0);

    sys.update(DT, FAR_PLAYER, sampleFor('day'));
    sys.update(DT, FAR_PLAYER, sampleFor('dusk'));
    expect(sys.goblinCount()).toBe(0);
  });
});
