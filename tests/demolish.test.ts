import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types.ts';
import type { BuildPiece } from '../src/structures/buildmath.ts';
import type { PlacedZipline } from '../src/structures/ziplines.ts';
import { demolishTargetAt, raySphereT } from '../src/structures/demolish.ts';

// ---------------------------------------------------------------------------
// Destruction ("demolish") mode — playtest Task 9. Pure aim-target selection:
// build pieces (AABB, reusing `pieceAtRayHit`) and zipline posts (spheres)
// compared on a common "distance along the ray" footing. Drones are
// deliberately out of scope for this module (proximity-based instead — see
// `structures/demolish.ts`'s file header) and are covered separately in
// `tests/structures.test.ts` (`DroneSystem.recallableIdNear`).
// ---------------------------------------------------------------------------

const ORIGIN: Vec3 = { x: 0, y: 1, z: 0 };
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 }; // looking down -Z

function wall(id: number, x: number, y: number, z: number): BuildPiece {
  return { id, kind: 'wall', x, y, z, yaw: 0 };
}

function zip(id: string, a: Vec3, b: Vec3): PlacedZipline {
  return { id, a, b };
}

describe('raySphereT', () => {
  it('hits a sphere dead ahead at the expected distance', () => {
    const t = raySphereT(ORIGIN, FORWARD, { x: 0, y: 1, z: -10 }, 1, 20);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(9, 6); // near edge of the r=1 sphere at z=-10
  });

  it('misses a sphere well off the ray', () => {
    expect(raySphereT(ORIGIN, FORWARD, { x: 20, y: 1, z: -10 }, 1, 20)).toBeNull();
  });

  it('returns null beyond maxDist', () => {
    expect(raySphereT(ORIGIN, FORWARD, { x: 0, y: 1, z: -10 }, 1, 5)).toBeNull();
  });

  it('firing from inside a sphere hits its far exit boundary, not the near (behind) one', () => {
    // Origin sits inside a r=5 sphere centred 1 m "behind" it in world Z
    // (ray looks -Z, so +Z is behind): the two roots straddle 0 (t=-6 behind,
    // t=4 ahead — the sphere's far boundary along the direction of travel);
    // the near/negative one is discarded in favour of the positive far one.
    const t = raySphereT(ORIGIN, FORWARD, { x: 0, y: 1, z: 1 }, 5, 20);
    expect(t).toBeCloseTo(4, 6);
  });

  it('clamps to t=0 when a sphere is entirely behind the ray (both roots negative)', () => {
    // Sphere sits 5 m behind the origin along +Z with a radius (1) too small
    // to reach the origin — outside it, and both intersections are behind —
    // same "same-tick hit" fallback `AnchorRegistry.raycastAnchors` uses.
    expect(raySphereT(ORIGIN, FORWARD, { x: 0, y: 1, z: 5 }, 1, 20)).toBe(0);
  });

  it('is direction-agnostic to a non-unit dir vector', () => {
    const t1 = raySphereT(ORIGIN, FORWARD, { x: 0, y: 1, z: -10 }, 1, 20);
    const t2 = raySphereT(ORIGIN, { x: 0, y: 0, z: -3 }, { x: 0, y: 1, z: -10 }, 1, 20);
    expect(t2).toBeCloseTo(t1!, 6);
  });
});

describe('demolishTargetAt', () => {
  it('finds a build piece straight ahead', () => {
    const pieces = [wall(1, 0, 1, -5)];
    const hit = demolishTargetAt(ORIGIN, FORWARD, pieces, [], 10, 1.3);
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ system: 'build', id: 1, kind: 'wall', label: 'Wall' });
  });

  it('finds a zipline post straight ahead', () => {
    const lines = [zip('zip0', { x: 0, y: 1, z: -5 }, { x: 40, y: 1, z: -5 })];
    const hit = demolishTargetAt(ORIGIN, FORWARD, [], lines, 10, 1.3);
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ system: 'zipline', id: 'zip0', end: 'a', label: 'Zipline' });
  });

  it('picks the far endpoint when it is the nearer post along the ray', () => {
    // Post B sits closer to the origin along the ray than post A.
    const lines = [zip('zip0', { x: 0, y: 1, z: -20 }, { x: 0, y: 1, z: -3 })];
    const hit = demolishTargetAt(ORIGIN, FORWARD, [], lines, 25, 1.3);
    expect(hit).toMatchObject({ system: 'zipline', id: 'zip0', end: 'b' });
  });

  it('nearest target wins across systems (a closer post beats a farther wall)', () => {
    const pieces = [wall(1, 0, 1, -8)];
    const lines = [zip('zip0', { x: 0, y: 1, z: -3 }, { x: 40, y: 1, z: -3 })];
    const hit = demolishTargetAt(ORIGIN, FORWARD, pieces, lines, 20, 1.3);
    expect(hit).toMatchObject({ system: 'zipline', id: 'zip0', end: 'a' });
  });

  it('nearest target wins the other way (a closer wall beats a farther post)', () => {
    const pieces = [wall(1, 0, 1, -3)];
    const lines = [zip('zip0', { x: 0, y: 1, z: -8 }, { x: 40, y: 1, z: -8 })];
    const hit = demolishTargetAt(ORIGIN, FORWARD, pieces, lines, 20, 1.3);
    expect(hit).toMatchObject({ system: 'build', id: 1 });
  });

  it('returns null when nothing is within maxDist', () => {
    const pieces = [wall(1, 0, 1, -50)];
    const lines = [zip('zip0', { x: 0, y: 1, z: -50 }, { x: 40, y: 1, z: -50 })];
    expect(demolishTargetAt(ORIGIN, FORWARD, pieces, lines, 10, 1.3)).toBeNull();
  });

  it('returns null when aiming away from everything', () => {
    const pieces = [wall(1, 0, 1, -5)];
    const away: Vec3 = { x: 0, y: 0, z: 1 }; // opposite direction
    expect(demolishTargetAt(ORIGIN, away, pieces, [], 10, 1.3)).toBeNull();
  });
});
