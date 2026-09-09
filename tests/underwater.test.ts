import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UNDERWATER } from '../src/core/constants.ts';
import type { GroundQuery, MoveInput } from '../src/core/types.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { CritterManager } from '../src/critters/manager.ts';
import { DartSystem } from '../src/tracking/darts.ts';
import { initialMoveState, stepMovement } from '../src/player/movement.ts';
import { stepSwimDepth } from '../src/player/controller.ts';
import { heightAt } from '../src/world/terrain.ts';
import { basinWeight, clamSpawns, crocSpawns, inDiveZone } from '../src/underwater/layout.ts';
import {
  breathMax,
  createBreath,
  stepBreath,
  tradeForBreath,
} from '../src/underwater/progression.ts';
import {
  sanitizeLinkedCrocIds,
  sanitizePurifiedClamIds,
  UnderwaterSystem,
} from '../src/underwater/system.ts';

const flatSeabed: GroundQuery = {
  heightAt: () => UNDERWATER.floorY,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

describe('Atlantis lagoon layout', () => {
  it('bounds diving to one explicit circle', () => {
    expect(inDiveZone(UNDERWATER.center.x, UNDERWATER.center.z)).toBe(true);
    expect(inDiveZone(UNDERWATER.center.x + UNDERWATER.diveRadius, UNDERWATER.center.z)).toBe(true);
    expect(inDiveZone(UNDERWATER.center.x + UNDERWATER.diveRadius + 0.01, UNDERWATER.center.z)).toBe(false);
  });

  it('raises a playable shelf from the naturally deep offshore seabed', () => {
    expect(basinWeight(UNDERWATER.center.x, UNDERWATER.center.z)).toBe(1);
    expect(
      basinWeight(UNDERWATER.center.x + UNDERWATER.basinBlendRadius + 1, UNDERWATER.center.z),
    ).toBe(0);
    expect(heightAt(UNDERWATER.center.x, UNDERWATER.center.z)).toBeGreaterThan(
      UNDERWATER.floorY - UNDERWATER.floorNoise - 0.1,
    );
    expect(heightAt(UNDERWATER.center.x, UNDERWATER.center.z)).toBeLessThan(
      UNDERWATER.floorY + UNDERWATER.floorNoise + 0.1,
    );
  });

  it('uses stable, non-overlapping ids for saved clam transformations', () => {
    const clams = clamSpawns();
    const crocs = crocSpawns();
    expect(clams).toHaveLength(UNDERWATER.clamCount);
    expect(crocs).toHaveLength(UNDERWATER.crocCount);
    expect(new Set([...clams, ...crocs].map((s) => s.id)).size).toBe(clams.length + crocs.length);
    expect(sanitizePurifiedClamIds([2003, 2003, 9999, 2000])).toEqual([2000, 2003]);
  });
});

describe('underwater movement and breath', () => {
  const input: MoveInput = {
    forward: 1,
    strafe: 0,
    yaw: 0,
    sprint: false,
    jump: false,
    jumpHeld: false,
    dash: false,
    rocket: false,
  };

  it('Currentboard multiplier increases only swim target speed', () => {
    const swim = { ...initialMoveState({ x: 0, y: 0, z: 0 }), mode: 'swim' as const };
    const normal = stepMovement(swim, input, 1, flatSeabed);
    const boosted = stepMovement(
      swim,
      { ...input, swimBoost: UNDERWATER.currentboardMultiplier },
      1,
      flatSeabed,
    );
    expect(Math.abs(boosted.vel.z)).toBeGreaterThan(Math.abs(normal.vel.z));
    expect(Math.abs(boosted.vel.z) / Math.abs(normal.vel.z)).toBeCloseTo(
      UNDERWATER.currentboardMultiplier,
      5,
    );
  });

  it('descending clamps to the seabed and leaving the zone auto-surfaces', () => {
    const down = stepSwimDepth(0, UNDERWATER.floorY, true, -1, 1);
    expect(down.y).toBe(-UNDERWATER.verticalSpeed);
    expect(down.vy).toBe(-UNDERWATER.verticalSpeed);

    const floor = stepSwimDepth(
      UNDERWATER.floorY + UNDERWATER.floorClearance + 0.1,
      UNDERWATER.floorY,
      true,
      -1,
      1,
    );
    expect(floor.y).toBe(UNDERWATER.floorY + UNDERWATER.floorClearance);
    expect(floor.vy).toBe(0);

    const buoyed = stepSwimDepth(-10, UNDERWATER.floorY, false, 0, 0.5);
    expect(buoyed.y).toBe(-10 + UNDERWATER.autoSurfaceSpeed * 0.5);
    expect(buoyed.vy).toBe(UNDERWATER.autoSurfaceSpeed);
  });

  it('drains, refills, and counts only time actually spent at zero air', () => {
    let breath = createBreath(0);
    const drained = stepBreath(breath, true, UNDERWATER.breathBaseS, 0);
    expect(drained.state.remaining).toBe(0);
    expect(drained.drownHits).toBe(0);
    const drowning = stepBreath(
      drained.state,
      true,
      UNDERWATER.drownHitEveryS * 2 + 0.1,
      0,
    );
    expect(drowning.drownHits).toBe(2);
    breath = stepBreath(drowning.state, false, 100, 0).state;
    expect(breath).toEqual(createBreath(0));
  });

  it('two freed-elf trades extend max air without mutating the input inventory', () => {
    const inv = createInventory();
    inv.mushroom = 3;
    inv.shard = 6;
    inv.spark = 6;
    expect(tradeForBreath(inv, 0, false)).toMatchObject({ ok: false, reason: 'castle' });

    const first = tradeForBreath(inv, 0, true);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first trade');
    expect(inv.mushroom).toBe(3);
    expect(first.inventory.mushroom).toBe(0);

    const second = tradeForBreath(first.inventory, first.level, true);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected second trade');
    expect(breathMax(second.level)).toBe(
      UNDERWATER.breathBaseS + 2 * UNDERWATER.breathPerUpgradeS,
    );
    expect(tradeForBreath(second.inventory, second.level, true)).toMatchObject({
      ok: false,
      reason: 'complete',
    });
  });
});

describe('underwater characters: purify clams, track crocs', () => {
  it('sanitizes linked croc ids against the real croc roster', () => {
    const crocIds = crocSpawns().map((c) => c.id);
    expect(sanitizeLinkedCrocIds([crocIds[0]!, -1, 999999, crocIds[0]!])).toEqual([crocIds[0]!]);
  });

  it('spends Tide ammo and resolves an underwater hostile before wildlife', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1, 0);
    camera.lookAt(0, 1, -1);
    camera.updateMatrixWorld(true);
    const inventory = createInventory();
    inventory.tideDarts = 1;
    const hits: { id: number; kind: string }[] = [];
    const darts = new DartSystem(
      scene,
      camera,
      new CritterManager(scene),
      inventory,
      { heightAt: () => -100, normalAt: () => ({ x: 0, y: 1, z: 0 }) },
      {
        hostileTargets: () => [{ id: 3000, pos: { x: 0, y: 1, z: -2 }, size: 0.6 }],
        onHostileHit: (id, kind) => hits.push({ id, kind }),
      },
    );
    expect(darts.tryThrow('tide')).toBe(true);
    expect(inventory.tideDarts).toBe(0);
    darts.update(0.1);
    expect(hits).toEqual([{ id: 3000, kind: 'tide' }]);
    darts.dispose();
  });

  it('clams shrug off darts and only purification transforms them (dropping shells)', () => {
    const scene = new THREE.Scene();
    const drops: { kind: 'shell' | 'scale'; amount: number }[] = [];
    const system = new UnderwaterSystem(scene, flatSeabed, {
      onDrop: (kind, amount) => drops.push({ kind, amount }),
      onPlayerHit: () => undefined,
    });

    const clam = system.purifierTargets()[0]!;
    // Darts never damage or remove a clam — it stays alive and purifiable.
    expect(system.hitEnemy(clam.id, 'tide')).toBe(true);
    expect(system.hitEnemy(clam.id, 'tracker')).toBe(true);
    expect(drops).toEqual([]);
    expect(system.purifierTargets().some((t) => t.id === clam.id)).toBe(true);

    expect(system.purifyClam(clam.id)).toBe(true);
    expect(system.purifiedClamIds()).toContain(clam.id);
    expect(system.purifierTargets().some((t) => t.id === clam.id)).toBe(false);
    expect(scene.getObjectByName('purifiedTurtle')?.userData.clamId).toBe(clam.id);
    expect(drops).toEqual([{ kind: 'shell', amount: UNDERWATER.shellDrop }]);
    system.dispose();
  });

  it('darts tag a croc; staying close links it, drops hide, and it sheds more over time', () => {
    const scene = new THREE.Scene();
    const drops: { kind: 'shell' | 'scale'; amount: number }[] = [];
    let taggedId: number | undefined;
    let linkedId: number | undefined;
    const system = new UnderwaterSystem(scene, flatSeabed, {
      onDrop: (kind, amount) => drops.push({ kind, amount }),
      onPlayerHit: () => undefined,
      onCrocTagged: (id) => (taggedId = id),
      onCrocLinked: (id) => (linkedId = id),
    });

    const croc = system.dartTargets().find((t) => t.id >= 3000)!;
    expect(system.hitEnemy(croc.id, 'tide')).toBe(true);
    expect(taggedId).toBe(croc.id);
    expect(drops).toEqual([]);

    // Track by staying inside crocTrackRadius (the croc's live position is at
    // its target pos while we hover right on top of it).
    const near = { x: croc.pos.x, y: croc.pos.y, z: croc.pos.z };
    for (let i = 0; i < Math.ceil(UNDERWATER.crocTrackTime / 0.5) + 2; i++) {
      system.update(0.5, near, true);
    }
    expect(linkedId).toBe(croc.id);
    expect(system.linkedCrocIds()).toContain(croc.id);
    expect(drops).toContainEqual({ kind: 'scale', amount: UNDERWATER.scaleDrop });

    // Linked crocs periodically shed one more hide while the player is near.
    const before = drops.length;
    const crocNow = system.dartTargets().find((t) => t.id === croc.id);
    const shedNear = crocNow ? { ...crocNow.pos } : near;
    for (let i = 0; i < Math.ceil(UNDERWATER.crocShedS / 1) + 2; i++) {
      system.update(1, shedNear, true);
    }
    expect(drops.length).toBeGreaterThan(before);
    expect(drops[drops.length - 1]).toEqual({ kind: 'scale', amount: 1 });
    system.dispose();
  });

  it('restores linked crocs from the save so they stay friendly forever', () => {
    const scene = new THREE.Scene();
    const crocId = crocSpawns()[0]!.id;
    let bitten = false;
    const system = new UnderwaterSystem(scene, flatSeabed, {
      onDrop: () => undefined,
      onPlayerHit: () => (bitten = true),
      linkedCrocs: [crocId],
    });
    expect(system.linkedCrocIds()).toEqual([crocId]);
    // Park the player on top of the linked croc: it must never chase or bite.
    const spawn = crocSpawns()[0]!;
    const pos = {
      x: spawn.x,
      y: UNDERWATER.floorY + spawn.lift,
      z: spawn.z,
    };
    for (let i = 0; i < 40; i++) system.update(0.25, pos, true);
    expect(bitten).toBe(false);
    // A dart against a linked croc is a friendly no-op (never re-tags).
    system.hitEnemy(crocId, 'tide');
    system.hitEnemy(crocId, 'tracker');
    expect(system.linkedCrocIds()).toEqual([crocId]);
    system.dispose();
  });
});
