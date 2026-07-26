import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { dartHitTarget, PurifierSystem } from '../src/castle/purifier.ts';
import type { DartState } from '../src/tracking/darts.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { createInventory } from '../src/craft/inventory.ts';

// ---------------------------------------------------------------------------
// dartHitTarget (Cursed Castle Task 13): mirrors tests/tracking.test.ts's
// dartHitCritter coverage exactly, but against the goblin/crystal target
// shape ({ id, pos, r }) that CastleSystem.goblinTargets()/the crystal
// callback hand the PurifierSystem.
// ---------------------------------------------------------------------------

describe('dartHitTarget', () => {
  function dartAt(pos: Vec3, prev: Vec3 = pos): DartState {
    return {
      pos: { ...pos },
      prev: { ...prev },
      vel: { x: 0, y: 0, z: 0 },
      age: 0,
      dead: false,
    };
  }
  const stationary = dartAt({ x: 0, y: 0, z: 0 });

  it('registers a swept hit against a target whose radius the segment crosses', () => {
    // One 60 Hz step at DART.speed covers ~0.47 m. The dart crosses from
    // x=-0.3 to x=+0.3 straight through a goblin at the origin whose 0.2 m
    // hit radius contains neither endpoint — only the swept segment hits.
    const d = dartAt({ x: 0.3, y: 0, z: 0 }, { x: -0.3, y: 0, z: 0 });
    const targets = [{ id: 9, pos: { x: 0, y: 0, z: 0 }, r: 0.2 }];
    expect(dartHitTarget(d, targets)).toBe(9);
    // Point-sample check (prev == pos at the endpoint) indeed misses.
    expect(dartHitTarget(dartAt({ x: 0.3, y: 0, z: 0 }), targets)).toBeNull();
  });

  it('misses when the dart path stays outside every target radius', () => {
    const targets = [{ id: 7, pos: { x: 2, y: 0, z: 0 }, r: 0.5 }];
    expect(dartHitTarget(stationary, targets)).toBeNull();
  });

  it('misses a target the segment passes wide of', () => {
    const d = dartAt({ x: 0.3, y: 0, z: 0 }, { x: -0.3, y: 0, z: 0 });
    const targets = [{ id: 9, pos: { x: 0, y: 0.5, z: 0 }, r: 0.2 }];
    expect(dartHitTarget(d, targets)).toBeNull();
  });

  it('returns the nearest-to-current-position of two overlapping targets', () => {
    const targets = [
      { id: 1, pos: { x: 0.9, y: 0, z: 0 }, r: 1.0 },
      { id: 2, pos: { x: 0.2, y: 0, z: 0 }, r: 1.0 },
    ];
    expect(dartHitTarget(stationary, targets)).toBe(2);
  });

  it('returns null against an empty target list', () => {
    expect(dartHitTarget(stationary, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PurifierSystem hit priority (spec §5 + final-review fix): goblins first,
// then critters (a harmless sparkle — never tagged/tracked/transformed), then
// the crystal. `new THREE.Scene()`/`new THREE.PerspectiveCamera()` work
// headlessly here exactly as they do in tests/castle-system.test.ts and
// tests/elves.test.ts.
// ---------------------------------------------------------------------------

const flatGround: GroundQuery = {
  heightAt: () => -1000, // keep every dart well above "ground" for the one step under test
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

/** A camera at the origin looking straight down +x, with matrixWorld resolved
 *  so `getWorldDirection` reads back a real direction (not the default -z). */
function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(1, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/** A target sitting squarely on the dart's straight +x flight path. */
function onPathTarget(id: number, r = 1): { id: number; pos: Vec3; r: number } {
  return { id, pos: { x: 2, y: 0, z: 0 }, r };
}

describe('PurifierSystem hit priority', () => {
  it('a goblin overlapping a critter at the same spot is purified — the critter is untouched', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const inventory = createInventory();
    inventory.purifiers = 1;
    const purifiedGoblinIds: number[] = [];
    let crystalHits = 0;

    const sys = new PurifierSystem(scene, camera, inventory, flatGround, {
      goblinTargets: () => [onPathTarget(1)],
      onPurifyGoblin: (id) => purifiedGoblinIds.push(id),
      critterTargets: () => [onPathTarget(2)],
      crystalTarget: () => ({ pos: { x: 2, y: 0, z: 0 }, r: 1, active: true }),
      onPurifyCrystal: () => {
        crystalHits++;
      },
    });

    expect(sys.tryThrow()).toBe(true);
    sys.update(0.1); // one big step: crosses the shared (2,0,0) spot in a single sweep

    expect(purifiedGoblinIds).toEqual([1]);
    expect(crystalHits).toBe(0);
  });

  it('a critter-only hit is a harmless sparkle: no goblin purify, no crystal purify', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const inventory = createInventory();
    inventory.purifiers = 1;
    let goblinHits = 0;
    let crystalHits = 0;
    const pointsBefore = scene.children.filter((c) => c instanceof THREE.Points).length;

    const sys = new PurifierSystem(scene, camera, inventory, flatGround, {
      goblinTargets: () => [],
      onPurifyGoblin: () => {
        goblinHits++;
      },
      critterTargets: () => [onPathTarget(9)],
      crystalTarget: () => ({ pos: { x: 2, y: 0, z: 0 }, r: 1, active: true }),
      onPurifyCrystal: () => {
        crystalHits++;
      },
    });

    expect(sys.tryThrow()).toBe(true);
    sys.update(0.1);

    expect(goblinHits).toBe(0);
    expect(crystalHits).toBe(0);
    // The sparkle burst (a THREE.Points shell) was still spawned at the hit point.
    const pointsAfter = scene.children.filter((c) => c instanceof THREE.Points).length;
    expect(pointsAfter).toBe(pointsBefore + 1);
  });

  it('a critter shields the crystal exactly like a goblin does', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const inventory = createInventory();
    inventory.purifiers = 1;
    let crystalHits = 0;

    const sys = new PurifierSystem(scene, camera, inventory, flatGround, {
      goblinTargets: () => [],
      onPurifyGoblin: () => {},
      critterTargets: () => [onPathTarget(4)],
      crystalTarget: () => ({ pos: { x: 2, y: 0, z: 0 }, r: 1, active: true }),
      onPurifyCrystal: () => {
        crystalHits++;
      },
    });

    expect(sys.tryThrow()).toBe(true);
    sys.update(0.1);
    expect(crystalHits).toBe(0);
  });
});
