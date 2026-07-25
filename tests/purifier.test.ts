import { describe, expect, it } from 'vitest';
import { dartHitTarget } from '../src/castle/purifier.ts';
import type { DartState } from '../src/tracking/darts.ts';
import type { Vec3 } from '../src/core/types.ts';

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
