import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILD, INPUT } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { BuildSystem } from '../src/structures/build.ts';
import { resolveCollision } from '../src/player/collision.ts';
import { raycastTerrain } from '../src/player/grapple.ts';

// ---------------------------------------------------------------------------
// BuildSystem (Inventory+Building Task 5): headless THREE.Scene pattern, same
// convention as tests/structures.test.ts (ZiplineSystem/DroneSystem) and
// tests/castle-system.test.ts — `new THREE.Scene()` works headlessly with no
// DOM/canvas. `update`/`beginPickup`/`tickPickup` all take plain aim points,
// so no camera mock is needed either (see build.ts's file-header doc).
//
// `update`'s 4th arg (playtest Task 8, explicit Ctrl-snap): every call below
// passes `true` to preserve this suite's original "snapping is always on"
// assumption from before that gate existed — snap-candidate behavior
// (top/edge/rampfoot) is exercised elsewhere in this file exactly as
// before. Dedicated `snapHeld` on/off coverage lives in its own describe
// block further down.
// ---------------------------------------------------------------------------

const DT = 1 / 60;

function flatGround(): GroundQuery {
  return { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
}

/** A gentle constant-slope terrain (height rises 0.3 m per metre of +x) —
 *  used by the playtest Task 8 height-cap regression, which needs a REAL
 *  (non-flat) analytic ground to sample against. */
function slopedGround(): GroundQuery {
  return { heightAt: (x: number) => 5 + 0.3 * x, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
}

function makeSystem(walls = 10, ramps = 10, cubes = 10) {
  const inv = createInventory();
  inv.walls = walls;
  inv.ramps = ramps;
  inv.cubes = cubes;
  const sys = new BuildSystem(new THREE.Scene(), flatGround(), inv);
  return { sys, inv };
}

/** Same as `makeSystem`, but on caller-supplied terrain (used by the sloped/
 *  flat height-cap regression pair, which needs the REAL `GroundQuery`
 *  `BuildSystem` samples `terrainY` from, not the always-flat default). */
function makeSystemOn(ground: GroundQuery, walls = 10, ramps = 10, cubes = 10) {
  const inv = createInventory();
  inv.walls = walls;
  inv.ramps = ramps;
  inv.cubes = cubes;
  const sys = new BuildSystem(new THREE.Scene(), ground, inv);
  return { sys, inv };
}

describe('BuildSystem — enter/cancel', () => {
  it('enters a ghost when stock is available', () => {
    const { sys } = makeSystem();
    expect(sys.active).toBe(false);
    sys.enter('wall');
    expect(sys.active).toBe(true);
  });

  it('refuses to enter (stays inactive) with zero stock', () => {
    const { sys } = makeSystem(0, 0);
    sys.enter('wall');
    expect(sys.active).toBe(false);
    sys.enter('ramp');
    expect(sys.active).toBe(false);
  });

  it('cancel() exits an active ghost', () => {
    const { sys } = makeSystem();
    sys.enter('wall');
    sys.cancel();
    expect(sys.active).toBe(false);
  });

  it('confirm()/update() are no-ops when no ghost is active', () => {
    const { sys } = makeSystem();
    expect(sys.confirm()).toBe(false);
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true); // must not throw
    expect(sys.pieces()).toHaveLength(0);
  });
});

describe('BuildSystem — place/confirm', () => {
  it('a valid freeform placement decrements inventory and registers the piece', () => {
    const { sys, inv } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(2);
    expect(sys.pieces()).toHaveLength(1);
    expect(sys.pieces()[0]).toMatchObject({ kind: 'wall', x: 0, y: 0, z: 0 });
  });

  it('stacking a second wall via the top snap reaches 2×wall.h and stays standable', () => {
    const { sys } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);

    // Aim near the first piece's top (within BUILD.snapR) — resolveSnap
    // should snap flush on top rather than reading this as freeform.
    sys.update(DT, { x: 0.1, y: BUILD.wall.h + 0.05, z: 0.1 }, 0, true);
    expect(sys.confirm()).toBe(true);

    expect(sys.pieces()).toHaveLength(2);
    expect(sys.topAt(0, 0)).toBeCloseTo(2 * BUILD.wall.h, 9);
  });

  it('ramp-to-wall: aiming a ramp at a placed wall face rampfoot-snaps and CONFIRMS (adjacent, not overlapping)', () => {
    const { sys, inv } = makeSystem(1, 1);
    // Place the wall first.
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(0);

    // Now aim a ramp at the wall's front face (yaw=0 -> face at z=+wall.t/2).
    sys.enter('ramp');
    expect(sys.active).toBe(true);
    sys.update(DT, { x: 0, y: 0, z: BUILD.wall.t / 2 + 0.1 }, 0, true);
    expect(sys.confirm()).toBe(true); // was refused ('overlap') before the rampfoot fix
    expect(inv.ramps).toBe(0);

    expect(sys.pieces()).toHaveLength(2);
    // The ramp's high end is flush with the wall's face/top, not driven
    // through it: the wall's own top is untouched by the ramp...
    expect(sys.topAt(0, 0)).toBeCloseTo(BUILD.wall.h, 9);
    // ...the ramp's own midpoint (halfway along its run, outward from the
    // face) sits at half the rise — a monotonic slope, not buried in the wall...
    const midZ = BUILD.wall.t / 2 + BUILD.ramp.run / 2;
    expect(sys.topAt(0, midZ)).toBeCloseTo(BUILD.ramp.rise / 2, 6);
    // ...and right at the face, the ramp's surface reaches the full rise
    // (=== wall.h), flush with the wall top — approach from just outside the
    // exact boundary (topAt's footprint gate is inclusive, but floating point
    // at the exact edge can land either side).
    const nearFaceZ = BUILD.wall.t / 2 + 0.02;
    expect(sys.topAt(0, nearFaceZ)).toBeGreaterThan(BUILD.ramp.rise * 0.9);
  });

  it('refuses (no decrement/registration) once the 8 m / 4-piece height cap is exceeded', () => {
    const { sys, inv } = makeSystem(10, 0);
    sys.enter('wall');
    let aim: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 4; i++) {
      sys.update(DT, aim, 0, true);
      expect(sys.confirm()).toBe(true);
      aim = { x: 0, y: (i + 1) * BUILD.wall.h + 0.05, z: 0 };
    }
    expect(sys.pieces()).toHaveLength(4);
    expect(inv.walls).toBe(6);

    // A 5th stacked wall would put its top at 10 m — over the 8 m cap.
    sys.update(DT, aim, 0, true);
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(4);
    expect(inv.walls).toBe(6);
  });

  it('refuses an overlapping freeform placement at the same spot', () => {
    const { sys, inv } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(2);

    // Re-select (confirm() spent the ghost's `pending`, but the ghost is
    // still active — batch-consumable placement keeps going) and aim at the
    // exact same freeform spot again (far enough from any snap candidate
    // that it reads as freeform, not a stack).
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(1);
    expect(inv.walls).toBe(2); // unchanged — nothing spent on the refusal
  });

  it('auto-exits the ghost the instant stock hits zero, so a further confirm is a clean no-op', () => {
    const { sys, inv } = makeSystem(1, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(0);
    // Otherwise the ghost would linger active-but-permanently-red until the
    // player noticed and backed out themselves.
    expect(sys.active).toBe(false);

    sys.update(DT, { x: 10, y: 0, z: 10 }, 0, true); // fresh freeform spot, no overlap
    expect(sys.confirm()).toBe(false); // no ghost active — nothing to confirm
    expect(sys.pieces()).toHaveLength(1);
  });

  it("reads as invalid ('stock') rather than auto-exiting when stock runs out from OUTSIDE the active ghost (e.g. spent elsewhere)", () => {
    const { sys, inv } = makeSystem(1, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    // Stock drained by something else entirely (not this system's own
    // confirm) while the ghost is still active and tracking a fresh spot.
    inv.walls = 0;
    sys.update(DT, { x: 10, y: 0, z: 10 }, 0, true);
    expect(sys.active).toBe(true); // still active — only confirm()'s own
    // successful placement auto-exits; an external drain doesn't reach in.
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(0);
  });

  it('hides the ghost and clears validity when the aim ray misses entirely', () => {
    const { sys } = makeSystem();
    sys.enter('wall');
    sys.update(DT, null, 0, true);
    expect(sys.confirm()).toBe(false);
  });

  it('enforces the maxPieces cap on debugPlace too', () => {
    const { sys } = makeSystem();
    for (let i = 0; i < BUILD.maxPieces; i++) {
      expect(sys.debugPlace('wall', i * 5, 0, 0, 0)).toBe(true);
    }
    expect(sys.pieces()).toHaveLength(BUILD.maxPieces);
    expect(sys.debugPlace('wall', BUILD.maxPieces * 5, 0, 0, 0)).toBe(false);
    expect(sys.pieces()).toHaveLength(BUILD.maxPieces);
  });
});

// ---------------------------------------------------------------------------
// Height-cap regression via the REAL raycastTerrain -> resolveSnap ->
// placementValid path (playtest Task 8, "can only stack 3 high, not 4").
//
// ROOT CAUSE (full account in buildmath.ts's HEIGHT_EPS doc): a FREEFORM
// (unsnapped) piece's stored `y` is `aim.y`, and `aim` in real play comes
// from `raycastTerrain`'s bisection-refined march — accurate to only
// ~marchStep/2^(marchRefine+1) ≈ 0.023 m, NOT machine precision.
// `placementValid`'s own `terrainY` is always an EXACT fresh `heightAt`
// sample, so the very first (freeform) piece of a stack can carry up to
// ~0.02 m of slop that every top-snapped piece above it inherits verbatim.
// The old `HEIGHT_EPS` (1e-6) couldn't absorb that, so a stack sitting
// EXACTLY at the nominal cap (4 walls × 2 m = 8 m) got spuriously rejected
// on its 4th piece. These two tests drive the exact same aim pipeline
// main.ts does (`raycastTerrain` feeding `resolveSnap` feeding
// `placementValid`) — not hand-placed y values — on both sloped and flat
// terrain, with a player height chosen (empirically, matching the values in
// the fix's own doc) to reproduce a realistic ~0.022 m march overshoot.
// ---------------------------------------------------------------------------
describe('BuildSystem — height-cap regression via the real terrain-march aim path', () => {
  /** Drives one placement exactly the way main.ts's per-frame build-ghost
   *  tick does: raycast straight down against the COMPOSED ground (raw
   *  terrain vs. the pile's own topAt, whichever is higher), feed the hit
   *  into `update`, then `confirm`. Returns confirm's result. */
  function placeViaRealAimPath(sys: BuildSystem, ground: GroundQuery, x: number, y: number, z: number): boolean {
    const composedHeightAt = (qx: number, qz: number): number => {
      const raw = ground.heightAt(qx, qz);
      const top = sys.topAt(qx, qz);
      return top > raw ? top : raw;
    };
    const aim = raycastTerrain({ x, y, z }, { x: 0, y: -1, z: 0 }, composedHeightAt, BUILD.placeRange);
    expect(aim).not.toBeNull(); // sanity: the march must actually find ground
    sys.update(DT, aim, 0, true);
    return sys.confirm();
  }

  it('stacks exactly 4 walls to the nominal cap on SLOPED terrain (not 3)', () => {
    const ground = slopedGround();
    const { sys } = makeSystemOn(ground, 10, 0, 0);
    sys.enter('wall'); // one ghost session for the whole stack
    const X0 = 5;
    const Z0 = -2;
    // +6.233 m of player height reproduces a ~0.022 m march overshoot at
    // this exact geometry (empirically found scanning player heights against
    // this fixed marchStep/marchRefine — see the describe-block doc above).
    const playerY = ground.heightAt(X0, Z0) + 6.233;

    for (let i = 0; i < 4; i++) {
      expect(placeViaRealAimPath(sys, ground, X0, playerY, Z0)).toBe(true);
    }
    expect(sys.pieces()).toHaveLength(4);
    expect(sys.pieces().every((p) => p.kind === 'wall')).toBe(true);

    // A 5th would genuinely exceed the cap — still correctly rejected (the
    // fix widens the boundary tolerance, it doesn't remove the cap).
    expect(placeViaRealAimPath(sys, ground, X0, playerY, Z0)).toBe(false);
    expect(sys.pieces()).toHaveLength(4);
  });

  it('stacks exactly 4 walls to the nominal cap on FLAT terrain too (the march-precision floor is not slope-specific)', () => {
    const ground: GroundQuery = { heightAt: () => 6.5, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
    const { sys } = makeSystemOn(ground, 10, 0, 0);
    sys.enter('wall');
    const X0 = 5;
    const Z0 = -2;
    const playerY = ground.heightAt(X0, Z0) + 6.233;

    for (let i = 0; i < 4; i++) {
      expect(placeViaRealAimPath(sys, ground, X0, playerY, Z0)).toBe(true);
    }
    expect(sys.pieces()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Ghost rotation (KeyR, playtest Task 8): +90°-accumulating, additive on top
// of whatever yaw resolveSnap/freeformSnap resolved.
// ---------------------------------------------------------------------------
describe('BuildSystem — ghost rotation (rotateGhost)', () => {
  it('is a no-op with no ghost active', () => {
    const { sys } = makeSystem();
    expect(() => sys.rotateGhost()).not.toThrow();
    expect(sys.active).toBe(false);
  });

  it('rotates a freeform placement +90° per call, accumulating', () => {
    const { sys } = makeSystem(3, 0, 0);
    sys.enter('wall');
    sys.rotateGhost(); // offset = 90°
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true); // freeform, camYaw=0 -> base yaw 0
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[0]!.yaw).toBeCloseTo(Math.PI / 2, 9);

    // ghostYawOffset persists across placements within the SAME ghost
    // session (only enter()/exit() reset it) — two MORE +90° calls land the
    // accumulated offset at 90+180 = 270° for this next placement. Rotating
    // BEFORE calling update() matters: `pending` (what confirm() places) is
    // only recomputed inside update(), so a rotate AFTER update() would miss
    // this placement entirely and land on the NEXT one instead.
    sys.rotateGhost();
    sys.rotateGhost();
    sys.update(DT, { x: 10, y: 0, z: 10 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[1]!.yaw).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('applies additively on top of a snap candidate\'s inherited yaw', () => {
    const { sys } = makeSystem(3, 0, 0);
    const baseYaw = 30 * (Math.PI / 180);
    expect(sys.debugPlace('wall', 5, 0, -3, baseYaw)).toBe(true);

    sys.enter('wall');
    sys.rotateGhost(); // +90°
    // Aim near the placed wall's top -> 'top' snap inherits its yaw (30°).
    sys.update(DT, { x: 5.1, y: BUILD.wall.h + 0.05, z: -3.05 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[1]!.yaw).toBeCloseTo(baseYaw + Math.PI / 2, 9);
  });

  it('resets to zero when the ghost exits (cancel) and a fresh one enters', () => {
    const { sys } = makeSystem(3, 0, 0);
    sys.enter('wall');
    sys.rotateGhost();
    sys.rotateGhost();
    sys.cancel();

    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[0]!.yaw).toBeCloseTo(0, 9); // no leftover rotation
  });

  it('resets to zero after a successful placement auto-exits the ghost (stock hits zero)', () => {
    const { sys } = makeSystem(1, 1, 0);
    sys.enter('wall');
    sys.rotateGhost();
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true); // last wall -> auto-exit
    expect(sys.active).toBe(false);

    sys.enter('ramp');
    sys.update(DT, { x: 10, y: 0, z: 10 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[1]!.yaw).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------
// Explicit Ctrl-to-snap (playtest Task 8): resolveSnap's candidates are only
// consulted when `update`'s `snapHeld` argument is true — gated in
// BuildSystem (per its own `update` doc) so buildmath.ts stays unconditional.
// ---------------------------------------------------------------------------
describe('BuildSystem — explicit Ctrl-to-snap (snapHeld gating)', () => {
  it('snapHeld=true snaps flush to an existing top even when aim.y overshoots it', () => {
    const { sys } = makeSystem(5, 0, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true); // base wall, top = wall.h

    const nearTopAim = { x: 0.1, y: BUILD.wall.h + 0.07, z: 0.1 }; // within snapR
    sys.update(DT, nearTopAim, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[1]!.y).toBeCloseTo(BUILD.wall.h, 9); // snapped, not aim.y verbatim
  });

  it('snapHeld=false ignores that same candidate entirely — freeform, aim.y verbatim', () => {
    const { sys } = makeSystem(5, 0, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);

    const nearTopAim = { x: 0.1, y: BUILD.wall.h + 0.07, z: 0.1 }; // same aim as above
    sys.update(DT, nearTopAim, 0, false);
    expect(sys.confirm()).toBe(true); // floats just above the first wall's top — no overlap
    expect(sys.pieces()[1]!.y).toBeCloseTo(BUILD.wall.h + 0.07, 9); // NOT snapped
  });

  it('snapHeld=false still applies camera-yaw stepping (freeform yaw isn\'t "no yaw logic at all")', () => {
    const { sys } = makeSystem(3, 0, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 22, false); // camYawDeg=22 -> nearest 15-step is 15
    expect(sys.confirm()).toBe(true);
    expect(sys.pieces()[0]!.yaw).toBeCloseTo(15 * (Math.PI / 180), 9);
  });
});

// ---------------------------------------------------------------------------
// Cube piece (playtest Task 8): the full pipeline — stock, placement,
// pickup, serialize/deserialize — mirroring the existing wall/ramp coverage.
// ---------------------------------------------------------------------------
describe('BuildSystem — cube piece', () => {
  it('enters/places/confirms a cube ghost against inv.cubes, same as wall/ramp', () => {
    const { sys, inv } = makeSystem(0, 0, 3);
    sys.enter('cube');
    expect(sys.active).toBe(true);
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.cubes).toBe(2);
    expect(sys.pieces()[0]).toMatchObject({ kind: 'cube', x: 0, y: 0, z: 0 });
  });

  it('refuses to enter with zero cube stock', () => {
    const { sys } = makeSystem(0, 0, 0);
    sys.enter('cube');
    expect(sys.active).toBe(false);
  });

  it('a cube top-snaps onto another cube, reaching 2×cube.h', () => {
    const { sys } = makeSystem(0, 0, 5);
    sys.enter('cube');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    sys.update(DT, { x: 0.1, y: BUILD.cube.h + 0.05, z: 0.1 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(sys.topAt(0, 0)).toBeCloseTo(2 * BUILD.cube.h, 9);
  });

  it('a ramp rampfoot-snaps against a cube face and confirms (adjacent, not overlapping)', () => {
    const { sys, inv } = makeSystem(0, 1, 1);
    sys.enter('cube');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.cubes).toBe(0);

    sys.enter('ramp');
    sys.update(DT, { x: 0, y: 0, z: BUILD.cube.d / 2 + 0.1 }, 0, true);
    expect(sys.confirm()).toBe(true);
    expect(inv.ramps).toBe(0);
    expect(sys.pieces()).toHaveLength(2);
    expect(sys.topAt(0, 0)).toBeCloseTo(BUILD.cube.h, 9); // the cube's own top, untouched
  });

  it('debugPlace + pickup + obstaclesNear all recognize "cube" the same as wall/ramp', () => {
    const { sys, inv } = makeSystem(0, 0, 0);
    expect(sys.debugPlace('cube', 0, 1, 0, 0)).toBe(true);
    expect(sys.obstaclesNear(0, 0).length).toBeGreaterThan(0);

    const origin: Vec3 = { x: 0, y: 2, z: -5 };
    const look: Vec3 = { x: 0, y: 0, z: 1 };
    expect(sys.aimedPiece(origin, look)?.kind).toBe('cube');
    sys.beginPickup(origin, look);
    expect(sys.tickPickup(BUILD.pickupHoldS + 0.01)).toBe(true);
    expect(inv.cubes).toBe(1);
  });

  it('serialize/deserialize round-trips a cube via k: "c"', () => {
    const { sys } = makeSystem(0, 0, 0);
    sys.debugPlace('cube', 3, 0, -1, 0.4);
    expect(sys.serialize()).toEqual([{ k: 'c', x: 3, y: 0, z: -1, yaw: 0.4 }]);

    const { sys: fresh } = makeSystem(0, 0, 0);
    fresh.deserialize([{ k: 'c', x: 3, y: 0, z: -1, yaw: 0.4 }]);
    expect(fresh.pieces()[0]).toMatchObject({ kind: 'cube', x: 3, y: 0, z: -1, yaw: 0.4 });
  });
});

describe('BuildSystem — ground extension / physics near-queries', () => {
  it('topAt fast-misses to -Infinity far from any piece', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    expect(sys.topAt(500, 500)).toBe(-Infinity);
  });

  it('obstaclesNear/grappleNear return circles for a nearby piece, empty far away', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    const obs = sys.obstaclesNear(0, 0);
    expect(obs.length).toBeGreaterThan(0);
    // yTop is lowered by BUILD.standClearance (see obstaclesNear's doc) so a
    // player standing exactly on the wall's top isn't shoved off it.
    expect(obs[0]!.yTop).toBeCloseTo(BUILD.wall.h - BUILD.standClearance, 9);
    expect(sys.grappleNear(0, 0).length).toBeGreaterThan(0);
    // Grapple colliders are NOT lowered — a different mechanic, unaffected by
    // the standing-on-top collision problem.
    expect(sys.grappleNear(0, 0)[0]!.yTop).toBeCloseTo(BUILD.wall.h, 9);

    expect(sys.obstaclesNear(500, 500)).toEqual([]);
    expect(sys.grappleNear(500, 500)).toEqual([]);
  });

  it('ramps contribute no player-collision obstacle (they are the walkable path), but still grapple', () => {
    const { sys } = makeSystem();
    sys.debugPlace('ramp', 0, 0, 0, 0);
    expect(sys.obstaclesNear(0, 0)).toEqual([]);
    expect(sys.grappleNear(0, 0).length).toBeGreaterThan(0);
    // The ground extension (topAt) still works for ramps — only the
    // XZ-collision obstacle is excluded.
    expect(sys.topAt(0, 0)).toBeGreaterThan(-Infinity);
  });
});

describe('BuildSystem — pickup (hold-F reclaim)', () => {
  it('aimedPiece finds a piece along a ray within pickupRange', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 1, 0, 0); // base y=1 so the box spans y in [1,3]
    const origin: Vec3 = { x: 0, y: 2, z: -5 };
    const look: Vec3 = { x: 0, y: 0, z: 1 };
    expect(sys.aimedPiece(origin, look)?.kind).toBe('wall');
  });

  it('beginPickup + tickPickup over BUILD.pickupHoldS reclaims the piece', () => {
    const { sys, inv } = makeSystem(0, 0);
    sys.debugPlace('wall', 0, 1, 0, 0);
    const origin: Vec3 = { x: 0, y: 2, z: -5 };
    const look: Vec3 = { x: 0, y: 0, z: 1 };

    sys.beginPickup(origin, look);
    expect(sys.tickPickup(BUILD.pickupHoldS - 0.05)).toBe(false); // in progress
    expect(sys.pickupProgress()).toBeGreaterThan(0);
    expect(sys.pickupProgress()).toBeLessThan(1);
    expect(sys.pieces()).toHaveLength(1); // not yet reclaimed

    expect(sys.tickPickup(0.1)).toBe(true); // crosses the hold threshold
    expect(sys.pieces()).toHaveLength(0);
    expect(inv.walls).toBe(1); // returned to inventory
  });

  it('releasing F early (cancelPickup) resets progress — no partial credit', () => {
    const { sys, inv } = makeSystem(0, 0);
    sys.debugPlace('wall', 0, 1, 0, 0);
    const origin: Vec3 = { x: 0, y: 2, z: -5 };
    const look: Vec3 = { x: 0, y: 0, z: 1 };

    sys.beginPickup(origin, look);
    sys.tickPickup(BUILD.pickupHoldS - 0.05);
    sys.cancelPickup();
    expect(sys.pickupProgress()).toBe(0);
    // Ticking again with no fresh beginPickup does nothing (no locked target).
    expect(sys.tickPickup(1)).toBe(false);
    expect(sys.pieces()).toHaveLength(1);
    expect(inv.walls).toBe(0);
  });

  it('beginPickup with nothing aimed at is a safe no-op', () => {
    const { sys } = makeSystem();
    sys.beginPickup({ x: 500, y: 0, z: 500 }, { x: 0, y: 0, z: 1 });
    expect(sys.tickPickup(10)).toBe(false);
  });

  it('the hash invalidates on pickup — near-queries drop the reclaimed piece', () => {
    const { sys } = makeSystem(0, 0);
    sys.debugPlace('wall', 0, 1, 0, 0);
    expect(sys.obstaclesNear(0, 0).length).toBeGreaterThan(0);
    expect(sys.topAt(0, 0)).toBeGreaterThan(-Infinity);

    const origin: Vec3 = { x: 0, y: 2, z: -5 };
    const look: Vec3 = { x: 0, y: 0, z: 1 };
    sys.beginPickup(origin, look);
    sys.tickPickup(BUILD.pickupHoldS + 0.01);

    expect(sys.obstaclesNear(0, 0)).toEqual([]);
    expect(sys.grappleNear(0, 0)).toEqual([]);
    expect(sys.topAt(0, 0)).toBe(-Infinity);
  });

  it('ramp pickup credits the ramps counter, not walls', () => {
    const { sys, inv } = makeSystem(0, 0);
    sys.debugPlace('ramp', 0, 0, 0, 0);
    sys.beginPickup({ x: 0, y: 0.5, z: -5 }, { x: 0, y: 0, z: 1 });
    sys.tickPickup(BUILD.pickupHoldS + 0.01);
    expect(inv.ramps).toBe(1);
    expect(inv.walls).toBe(0);
  });
});

describe('BuildSystem — demolishReclaim (playtest Task 9, instant/no-hold reclaim)', () => {
  it('reclaims a piece by id instantly — no hold, same refund as completePickup', () => {
    const { sys, inv } = makeSystem(0, 0);
    sys.debugPlace('wall', 0, 1, 0, 0);
    const piece = sys.pieces()[0]!;
    expect(sys.demolishReclaim(piece.id)).toBe(true);
    expect(sys.pieces()).toHaveLength(0);
    expect(inv.walls).toBe(1); // no-penalty refund, identical to hold-F pickup
  });

  it('credits the ramps counter for a ramp, not walls', () => {
    const { sys, inv } = makeSystem(0, 0);
    sys.debugPlace('ramp', 0, 0, 0, 0);
    const piece = sys.pieces()[0]!;
    expect(sys.demolishReclaim(piece.id)).toBe(true);
    expect(inv.ramps).toBe(1);
    expect(inv.walls).toBe(0);
  });

  it('invalidates the hash immediately — no lingering obstacle/topAt', () => {
    const { sys } = makeSystem(0, 0);
    sys.debugPlace('wall', 0, 1, 0, 0);
    const id = sys.pieces()[0]!.id;
    sys.demolishReclaim(id);
    expect(sys.obstaclesNear(0, 0)).toEqual([]);
    expect(sys.topAt(0, 0)).toBe(-Infinity);
  });

  it('returns false (safe no-op) for an id that is not a live piece', () => {
    const { sys, inv } = makeSystem(0, 0);
    expect(sys.demolishReclaim(999)).toBe(false);
    expect(inv.walls).toBe(0);
    expect(inv.ramps).toBe(0);
  });

  it('does not require an active ghost or hold state', () => {
    const { sys, inv } = makeSystem(0, 0, 0);
    sys.debugPlace('cube', 0, 0, 0, 0);
    expect(sys.active).toBe(false); // no ghost entered at all
    const id = sys.pieces()[0]!.id;
    expect(sys.demolishReclaim(id)).toBe(true);
    expect(inv.cubes).toBe(1);
  });
});

describe('BuildSystem — serialize/deserialize', () => {
  it('round-trips placed pieces through a fresh instance', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    sys.debugPlace('ramp', 10, 0, 0, 1.2);
    const saved = sys.serialize();
    expect(saved).toEqual([
      { k: 'w', x: 0, y: 0, z: 0, yaw: 0 },
      { k: 'r', x: 10, y: 0, z: 0, yaw: 1.2 },
    ]);

    const { sys: fresh } = makeSystem(0, 0);
    fresh.deserialize(saved);
    const pieces = fresh.pieces().map((p) => ({ kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw }));
    expect(pieces).toEqual([
      { kind: 'wall', x: 0, y: 0, z: 0, yaw: 0 },
      { kind: 'ramp', x: 10, y: 0, z: 0, yaw: 1.2 },
    ]);
    // Physics near-queries work immediately after deserialize (hash rebuilt).
    expect(fresh.topAt(0, 0)).toBeCloseTo(BUILD.wall.h, 9);
  });

  it('deserialize truncates to BUILD.maxPieces on an over-long save, and SIGNALS the truncation', () => {
    const entries = Array.from({ length: BUILD.maxPieces + 10 }, (_, i) => ({
      k: 'w' as const,
      x: i * 5,
      y: 0,
      z: 0,
      yaw: 0,
    }));
    const { sys } = makeSystem(0, 0);
    const truncated = sys.deserialize(entries);
    expect(sys.pieces()).toHaveLength(BUILD.maxPieces);
    // Silent truncation would be invisible to the player (their fort just has
    // fewer pieces than they left it with) — deserialize must report it.
    expect(truncated).toBe(true);
  });

  it('deserialize reports no truncation when the save is within maxPieces', () => {
    const { sys } = makeSystem(0, 0);
    const truncated = sys.deserialize([{ k: 'w', x: 0, y: 0, z: 0, yaw: 0 }]);
    expect(truncated).toBe(false);
    expect(sys.pieces()).toHaveLength(1);
  });

  it('deserialize replaces (not appends to) any prior state', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    sys.deserialize([{ k: 'r', x: 20, y: 0, z: 0, yaw: 0 }]);
    expect(sys.pieces()).toHaveLength(1);
    expect(sys.pieces()[0]).toMatchObject({ kind: 'ramp', x: 20 });
  });
});

// ---------------------------------------------------------------------------
// Composed regression: the REAL resolveCollision (player/collision.ts) fed
// obstaclesNear's output at realistic standing/climbing positions. These
// lock in the standClearance/ramp-exclusion fix (see obstaclesNear's doc in
// build.ts) against any future change to resolveCollision's own gate — a
// unit test on obstaclesNear's raw circles alone wouldn't catch a
// resolveCollision change that broke the composition.
// ---------------------------------------------------------------------------
describe('BuildSystem — composed collision regression (real resolveCollision)', () => {
  it('a player standing exactly on a wall top is NOT displaced in XZ', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    // Ground-resolve semantics (movement.ts): a standing player's feet sit at
    // EXACTLY the composed ground height — here, the wall's own top.
    const feetY = sys.topAt(0, 0);
    expect(feetY).toBeCloseTo(BUILD.wall.h, 9);
    const pos: Vec3 = { x: 0, y: feetY, z: 0 };
    const resolved = resolveCollision(pos, INPUT.playerRadius, sys.obstaclesNear(0, 0));
    expect(resolved.x).toBeCloseTo(0, 9);
    expect(resolved.z).toBeCloseTo(0, 9);
  });

  it('a player standing at the wall BASE (ground level) is still pushed off the side', () => {
    // Sanity check the fix didn't disable side-collision entirely — only the
    // TOP-standing case should glide over.
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    const pos: Vec3 = { x: 0, y: 0, z: 0 }; // ground level, dead centre of the wall
    const resolved = resolveCollision(pos, INPUT.playerRadius, sys.obstaclesNear(0, 0));
    const moved = Math.hypot(resolved.x - pos.x, resolved.z - pos.z);
    expect(moved).toBeGreaterThan(0.01);
  });

  it('a player mid-climb on a ramp (composed ground height) is NOT shoved off', () => {
    const { sys } = makeSystem();
    sys.debugPlace('ramp', 0, 0, 0, 0); // yaw 0: low end z=-1, high end z=+1
    // Composed ground height at the ramp's own centre (t=0.5 -> rise/2).
    const feetY = sys.topAt(0, 0);
    expect(feetY).toBeCloseTo(BUILD.ramp.rise / 2, 6);
    const pos: Vec3 = { x: 0, y: feetY, z: 0 };
    const resolved = resolveCollision(pos, INPUT.playerRadius, sys.obstaclesNear(0, 0));
    expect(resolved.x).toBeCloseTo(0, 9);
    expect(resolved.z).toBeCloseTo(0, 9);
  });

  it('a player standing on a 2-stack (top piece) is NOT displaced in XZ', () => {
    const { sys } = makeSystem();
    sys.debugPlace('wall', 0, 0, 0, 0);
    sys.debugPlace('wall', 0, BUILD.wall.h, 0, 0);
    const feetY = sys.topAt(0, 0);
    expect(feetY).toBeCloseTo(2 * BUILD.wall.h, 9);
    const pos: Vec3 = { x: 0, y: feetY, z: 0 };
    const resolved = resolveCollision(pos, INPUT.playerRadius, sys.obstaclesNear(0, 0));
    expect(resolved.x).toBeCloseTo(0, 9);
    expect(resolved.z).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------
// Compositional ramp -> cube -> ramp staircase (playtest Task 8, item 3): a
// ramp source offers no edge/rampfoot candidate at all (see resolveSnap's
// doc — those anchor off flat-topped WALL/CUBE sources only), and a ramp's
// own 'top' candidate re-anchors at the RAMP's OWN base centre, not its high
// edge — so "ramp -> ramp" can never continue climbing FORWARD through
// snapping alone. A cube fixes that: placed on the flat ground immediately
// past the first ramp's high edge (freeform — its own top, y = cube.h,
// lands exactly flush with the ramp's high end purely because
// `cube.h === ramp.rise` by construction, constants.ts), it gives the
// SECOND ramp a wall/cube-shaped 'top' target sitting at the RIGHT world
// position to keep climbing onward.
// ---------------------------------------------------------------------------
describe('BuildSystem — compositional ramp->cube->ramp staircase', () => {
  it('ground ramp + adjacent cube + a REAL top-snapped ramp compose into a monotonically climbing, walkable staircase to 4 m', () => {
    const { sys } = makeSystem(0, 10, 10);

    // 1. Ground ramp: climbs 0 -> rise over local z in [-run/2, run/2] = [-1, 1].
    expect(sys.debugPlace('ramp', 0, 0, 0, 0)).toBe(true);

    // 2. Cube on the flat ground immediately past the ramp's high edge
    // (z = run/2 = 1) — freeform, NOT snapped to the ramp (there is no
    // candidate for that, see the doc above). Its footprint (z: [1, 3])
    // touches but does not overlap the ramp's (z: [-1, 1]).
    const cubeZ = BUILD.ramp.run / 2 + BUILD.cube.d / 2; // 1 + 1 = 2
    expect(sys.debugPlace('cube', 0, 0, cubeZ, 0)).toBe(true);

    // 3. Second ramp, placed through the REAL ghost pipeline, 'top'-snapped
    // onto the cube — proving resolveSnap's generic "any existing piece, any
    // placed kind" top candidate actually composes against a cube.
    sys.enter('ramp');
    const cubeTopTrigger: Vec3 = { x: 0, y: BUILD.cube.h, z: cubeZ };
    sys.update(DT, cubeTopTrigger, 0, true);
    expect(sys.confirm()).toBe(true);

    expect(sys.pieces()).toHaveLength(3);
    const ramp2 = sys.pieces()[2]!;
    expect(ramp2.kind).toBe('ramp');
    expect(ramp2.x).toBeCloseTo(0, 9);
    expect(ramp2.z).toBeCloseTo(cubeZ, 9);
    expect(ramp2.y).toBeCloseTo(BUILD.cube.h, 9); // flush with the cube's top

    // Composed ground is monotonically increasing along the whole staircase,
    // seamlessly across the ramp1/cube boundary at z=1 and the cube/ramp2
    // shared footprint (z: [1, 3], where ramp2's rising slope always
    // dominates the cube's flat top in buildTopAt's max).
    const zs = [-0.99, -0.5, 0, 0.5, 0.99, 1.01, 1.5, 2, 2.5, 2.99];
    let prevTop = -Infinity;
    for (const z of zs) {
      const top = sys.topAt(0, z);
      expect(top).toBeGreaterThan(-Infinity);
      expect(top).toBeGreaterThanOrEqual(prevTop - 1e-9); // monotonic, non-decreasing
      prevTop = top;
    }
    expect(prevTop).toBeCloseTo(2 * BUILD.ramp.rise, 1); // ~4 m at the very top

    // Now WALK a representative subset with the REAL resolveCollision
    // against obstaclesNear (same convention as this file's other "composed
    // collision regression" tests): standing exactly on the composed
    // surface is never shoved sideways, and the climb never regresses.
    //
    // Excludes z in (~0.4, ~0.9): approaching the cube's LARGE r=1.2 obstacle
    // circle from ramp1's own climbing surface, before the ramp has lifted
    // the player above the cube's yTop (1.9), DOES get a legitimate sideways
    // push there — same as walking toward any solid block's side. This is
    // not a Task-8/cube regression: the identical geometry already exists
    // for a ramp rampfoot-snapped INTO a wall's face (verified by hand: at
    // ~1 m before the wall a climbing player is only at half the wall's
    // height, still well inside the wall's own r+playerRadius reach) — no
    // prior test ever exercised a full incremental walk to notice it. Out of
    // scope here; only the composed HEIGHT FIELD's monotonicity (asserted
    // above, unaffected by any XZ push) is this test's contract.
    const walkZs = [-0.99, -0.5, 0, 0.99, 1.01, 1.5, 2, 2.5, 2.99];
    let lastY = -Infinity;
    for (const z of walkZs) {
      const feetY = sys.topAt(0, z);
      const pos: Vec3 = { x: 0, y: feetY, z };
      const resolved = resolveCollision(pos, INPUT.playerRadius, sys.obstaclesNear(0, z));
      expect(resolved.x).toBeCloseTo(0, 6);
      expect(resolved.z).toBeCloseTo(z, 6);
      expect(feetY).toBeGreaterThanOrEqual(lastY - 1e-9);
      lastY = feetY;
    }
    expect(lastY).toBeCloseTo(4, 1);
  });
});
