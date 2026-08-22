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
  sanitizePurifiedClamIds,
  UnderwaterSystem,
  underwaterDartDamage,
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

  it('Ctrl-style descend clamps to the seabed and leaving the zone auto-surfaces', () => {
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

describe('underwater enemies and permanent turtles', () => {
  it('Tide Darts deal double damage', () => {
    expect(underwaterDartDamage('tracker')).toBe(1);
    expect(underwaterDartDamage('slowing')).toBe(1);
    expect(underwaterDartDamage('tide')).toBe(2);
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

  it('drops renewable materials and replaces a purified clam with a turtle', () => {
    const scene = new THREE.Scene();
    const drops: { kind: 'shell' | 'scale'; amount: number }[] = [];
    const system = new UnderwaterSystem(scene, flatSeabed, {
      onDrop: (kind, amount) => drops.push({ kind, amount }),
      onPlayerHit: () => undefined,
    });

    const firstClam = system.purifierTargets()[0]!;
    expect(system.purifyClam(firstClam.id)).toBe(true);
    expect(system.purifiedClamIds()).toContain(firstClam.id);
    expect(system.purifierTargets().some((t) => t.id === firstClam.id)).toBe(false);
    expect(scene.getObjectByName('purifiedTurtle')?.userData.clamId).toBe(firstClam.id);

    const secondClam = system.purifierTargets()[0]!;
    expect(system.hitEnemy(secondClam.id, 'tide')).toBe(true);
    expect(system.hitEnemy(secondClam.id, 'tracker')).toBe(true);
    expect(drops).toContainEqual({ kind: 'shell', amount: UNDERWATER.shellDrop });

    const croc = system.dartTargets().find((t) => t.id >= 3000)!;
    expect(system.hitEnemy(croc.id, 'tide')).toBe(true);
    expect(system.hitEnemy(croc.id, 'tide')).toBe(true);
    expect(drops).toContainEqual({ kind: 'scale', amount: UNDERWATER.scaleDrop });
    expect(drops).toContainEqual({ kind: 'shell', amount: UNDERWATER.crocShellDrop });
    system.update(
      UNDERWATER.enemyRespawnS + 0.1,
      { x: UNDERWATER.center.x, y: UNDERWATER.floorY + 8, z: UNDERWATER.center.z },
      false,
    );
    expect(system.dartTargets().some((t) => t.id === secondClam.id)).toBe(true);
    expect(system.dartTargets().some((t) => t.id === croc.id)).toBe(true);
    system.dispose();
  });
});
