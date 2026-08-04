import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILD, INPUT } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { BuildSystem } from '../src/structures/build.ts';
import { resolveCollision } from '../src/player/collision.ts';

// ---------------------------------------------------------------------------
// BuildSystem (Inventory+Building Task 5): headless THREE.Scene pattern, same
// convention as tests/structures.test.ts (ZiplineSystem/DroneSystem) and
// tests/castle-system.test.ts — `new THREE.Scene()` works headlessly with no
// DOM/canvas. `update`/`beginPickup`/`tickPickup` all take plain aim points,
// so no camera mock is needed either (see build.ts's file-header doc).
// ---------------------------------------------------------------------------

const DT = 1 / 60;

function flatGround(): GroundQuery {
  return { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
}

function makeSystem(walls = 10, ramps = 10) {
  const inv = createInventory();
  inv.walls = walls;
  inv.ramps = ramps;
  const sys = new BuildSystem(new THREE.Scene(), flatGround(), inv);
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
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0); // must not throw
    expect(sys.pieces()).toHaveLength(0);
  });
});

describe('BuildSystem — place/confirm', () => {
  it('a valid freeform placement decrements inventory and registers the piece', () => {
    const { sys, inv } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(2);
    expect(sys.pieces()).toHaveLength(1);
    expect(sys.pieces()[0]).toMatchObject({ kind: 'wall', x: 0, y: 0, z: 0 });
  });

  it('stacking a second wall via the top snap reaches 2×wall.h and stays standable', () => {
    const { sys } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(true);

    // Aim near the first piece's top (within BUILD.snapR) — resolveSnap
    // should snap flush on top rather than reading this as freeform.
    sys.update(DT, { x: 0.1, y: BUILD.wall.h + 0.05, z: 0.1 }, 0);
    expect(sys.confirm()).toBe(true);

    expect(sys.pieces()).toHaveLength(2);
    expect(sys.topAt(0, 0)).toBeCloseTo(2 * BUILD.wall.h, 9);
  });

  it('ramp-to-wall: aiming a ramp at a placed wall face rampfoot-snaps and CONFIRMS (adjacent, not overlapping)', () => {
    const { sys, inv } = makeSystem(1, 1);
    // Place the wall first.
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(0);

    // Now aim a ramp at the wall's front face (yaw=0 -> face at z=+wall.t/2).
    sys.enter('ramp');
    expect(sys.active).toBe(true);
    sys.update(DT, { x: 0, y: 0, z: BUILD.wall.t / 2 + 0.1 }, 0);
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
      sys.update(DT, aim, 0);
      expect(sys.confirm()).toBe(true);
      aim = { x: 0, y: (i + 1) * BUILD.wall.h + 0.05, z: 0 };
    }
    expect(sys.pieces()).toHaveLength(4);
    expect(inv.walls).toBe(6);

    // A 5th stacked wall would put its top at 10 m — over the 8 m cap.
    sys.update(DT, aim, 0);
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(4);
    expect(inv.walls).toBe(6);
  });

  it('refuses an overlapping freeform placement at the same spot', () => {
    const { sys, inv } = makeSystem(3, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(2);

    // Re-select (confirm() spent the ghost's `pending`, but the ghost is
    // still active — batch-consumable placement keeps going) and aim at the
    // exact same freeform spot again (far enough from any snap candidate
    // that it reads as freeform, not a stack).
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(1);
    expect(inv.walls).toBe(2); // unchanged — nothing spent on the refusal
  });

  it('auto-exits the ghost the instant stock hits zero, so a further confirm is a clean no-op', () => {
    const { sys, inv } = makeSystem(1, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    expect(sys.confirm()).toBe(true);
    expect(inv.walls).toBe(0);
    // Otherwise the ghost would linger active-but-permanently-red until the
    // player noticed and backed out themselves.
    expect(sys.active).toBe(false);

    sys.update(DT, { x: 10, y: 0, z: 10 }, 0); // fresh freeform spot, no overlap
    expect(sys.confirm()).toBe(false); // no ghost active — nothing to confirm
    expect(sys.pieces()).toHaveLength(1);
  });

  it("reads as invalid ('stock') rather than auto-exiting when stock runs out from OUTSIDE the active ghost (e.g. spent elsewhere)", () => {
    const { sys, inv } = makeSystem(1, 0);
    sys.enter('wall');
    sys.update(DT, { x: 0, y: 0, z: 0 }, 0);
    // Stock drained by something else entirely (not this system's own
    // confirm) while the ghost is still active and tracking a fresh spot.
    inv.walls = 0;
    sys.update(DT, { x: 10, y: 0, z: 10 }, 0);
    expect(sys.active).toBe(true); // still active — only confirm()'s own
    // successful placement auto-exits; an external drain doesn't reach in.
    expect(sys.confirm()).toBe(false);
    expect(sys.pieces()).toHaveLength(0);
  });

  it('hides the ghost and clears validity when the aim ray misses entirely', () => {
    const { sys } = makeSystem();
    sys.enter('wall');
    sys.update(DT, null, 0);
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
