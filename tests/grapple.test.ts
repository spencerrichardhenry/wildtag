import { describe, expect, it } from 'vitest';
import { GRAPPLE, MOVE } from '../src/core/constants.ts';
import type { MoveState, Vec3 } from '../src/core/types.ts';
import { initialMoveState } from '../src/player/movement.ts';
import {
  applyRopeConstraint,
  fireHook,
  hangPin,
  latchedHook,
  raycastTerrain,
  stepAttached,
  stepHook,
  type GrappleCollider,
  type HookQueries,
  type HookState,
} from '../src/player/grapple.ts';
import { AnchorRegistry } from '../src/structures/anchors.ts';

const DT = 1 / 60;

function state(pos: Vec3, vel: Vec3): MoveState {
  return { ...initialMoveState(pos), vel: { ...vel } };
}

function speed(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Query set with no obstacles at all (terrain far below, no props/drones). */
function emptyQueries(over: Partial<HookQueries> = {}): HookQueries {
  return {
    heightAt: () => -1000,
    getGrappleColliders: () => [],
    ...over,
  };
}

// A rope anchored above the origin. Player hangs below it.
const ANCHOR: Vec3 = { x: 0, y: 10, z: 0 };

// ---------------------------------------------------------------------------
// Projectile flight
// ---------------------------------------------------------------------------

describe('fireHook', () => {
  it('launches at hookSpeed along the (normalized) look dir, flying', () => {
    const h = fireHook({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 2 });
    expect(h.phase).toBe('flying');
    expect(speed(h.vel)).toBeCloseTo(GRAPPLE.hookSpeed, 6);
    expect(h.vel.z).toBeCloseTo(GRAPPLE.hookSpeed, 6); // unit-normalized +z
    expect(h.anchor).toBeNull();
    expect(h.flightTime).toBe(0);
  });
});

describe('stepHook — flight ballistics', () => {
  it('integrates gravity: a level fire arcs downward and lands ~60-75m out', () => {
    // Muzzle at y=7 (a plausible hand height on a rise); level fire, flat ground
    // at y=0. Range scales with hookSpeed (playtest-doubled): drop time from 7m
    // is √(2·7/10) ≈ 1.18s → ≈ 57 · 1.18 ≈ 67m before the terrain latch.
    let h = fireHook({ x: 0, y: 7, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries({ heightAt: () => 0 });
    let apex = h.pos.y;
    let steps = 0;
    while (h.phase === 'flying' && steps < 1000) {
      h = stepHook(h, { x: 0, y: 0, z: 0 }, q, DT);
      apex = Math.max(apex, h.pos.y);
      steps++;
    }
    // The arc never rises above the muzzle (fired level, gravity only pulls down).
    expect(apex).toBeCloseTo(7, 5);
    // Landed on terrain (a latch), within a sane level-fire range.
    expect(h.phase).toBe('latched');
    expect(h.pos.x).toBeGreaterThan(60);
    expect(h.pos.x).toBeLessThan(75);
  });

  it('times out to phase done after hookMaxFlight with no contact', () => {
    let h = fireHook({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries(); // nothing to ever hit
    let t = 0;
    while (h.phase === 'flying' && t < 5) {
      h = stepHook(h, { x: 0, y: 100, z: 0 }, q, DT);
      t += DT;
    }
    expect(h.phase).toBe('done');
    expect(h.flightTime).toBeGreaterThanOrEqual(GRAPPLE.hookMaxFlight);
  });
});

describe('stepHook — terrain latch', () => {
  it('latches at the surface (+ anchorLift) when the hook drops below ground', () => {
    let h = fireHook({ x: 0, y: 5, z: 0 }, { x: 1, y: -1, z: 0 });
    const q = emptyQueries({ heightAt: () => 0 });
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 5, z: 0 }, q, DT);
    expect(h.phase).toBe('latched');
    expect(h.anchor!.y).toBeCloseTo(GRAPPLE.anchorLift, 4);
    // Length is the fire-time player→anchor distance.
    const d = Math.hypot(h.anchor!.x, h.anchor!.y - 5, h.anchor!.z);
    expect(h.length).toBeCloseTo(d, 6);
  });
});

describe('stepHook — prop-cylinder latch', () => {
  const tree: GrappleCollider = { x: 5, z: 0, r: 0.5, yBase: 0, yTop: 4.5 };

  it('latches onto a tree the hook flies into (anchor pushed just outside)', () => {
    let h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries({ getGrappleColliders: () => [tree] });
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 2, z: 0 }, q, DT);
    expect(h.phase).toBe('latched');
    // Anchor sits on the trunk surface (r + 0.15) on the approach side (−x).
    const dxz = Math.hypot(h.anchor!.x - tree.x, h.anchor!.z - tree.z);
    expect(dxz).toBeCloseTo(tree.r + 0.15, 3);
    expect(h.anchor!.x).toBeLessThan(tree.x); // hit the near face
    expect(h.anchorDrone).toBeNull();
  });

  it('passes OVER a short rock (hook y above the collider top → no latch)', () => {
    // Rock top at y=1.6; fire level at y=3 so the hook clears it.
    const rock: GrappleCollider = { x: 5, z: 0, r: 0.9, yBase: 0, yTop: 1.6 };
    let h = fireHook({ x: 0, y: 3, z: 0 }, { x: 1, y: 0, z: 0 });
    // Ground below the rock so the hook eventually lands on terrain past it.
    const q = emptyQueries({ heightAt: () => 0, getGrappleColliders: () => [rock] });
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 3, z: 0 }, q, DT);
    expect(h.phase).toBe('latched');
    // It did NOT catch the rock — it flew past to land well beyond it on terrain.
    expect(h.pos.x).toBeGreaterThan(rock.x + 5);
  });

  it('misses a tree offset beside the flight path', () => {
    const beside: GrappleCollider = { x: 5, z: 6, r: 0.5, yBase: 0, yTop: 4.5 };
    let h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries({ getGrappleColliders: () => [beside] }); // no terrain
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 2, z: 0 }, q, DT);
    expect(h.phase).toBe('done'); // never caught the offset tree, timed out
  });

  it('does not tunnel a fast hook through a thin collider (swept test)', () => {
    // A thin post the hook would jump over in a single 60Hz step if sampled at
    // endpoints only (hookSpeed·dt ≈ 0.67m per step vs r 0.05).
    const thin: GrappleCollider = { x: 0.5, z: 0, r: 0.05, yBase: 0, yTop: 4 };
    let h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries({ getGrappleColliders: () => [thin] });
    h = stepHook(h, { x: 0, y: 2, z: 0 }, q, DT); // one step spans 0 → ~0.67
    expect(h.phase).toBe('latched');
    expect(Math.hypot(h.anchor!.x - thin.x, h.anchor!.z - thin.z)).toBeCloseTo(thin.r + 0.15, 3);
  });

  it('latches on the FIRST collider along the path (canopy before far tree)', () => {
    const near: GrappleCollider = { x: 4, z: 0, r: 0.5, yBase: 0, yTop: 5 };
    const far: GrappleCollider = { x: 20, z: 0, r: 0.5, yBase: 0, yTop: 5 };
    let h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    const q = emptyQueries({ getGrappleColliders: () => [far, near] });
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 2, z: 0 }, q, DT);
    expect(h.phase).toBe('latched');
    expect(h.anchor!.x).toBeLessThan(near.x + 1); // caught the near one
  });
});

describe('stepHook — drone sphere latch', () => {
  it('latches to a drone anchor and records its id for live tracking', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('drone-1', () => ({ x: 6, y: 2, z: 0 }), 1.2);
    const q = emptyQueries({
      raycastDrones: (a, b) => {
        const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const len = Math.hypot(dir.x, dir.y, dir.z);
        const hit = reg.raycastAnchors(a, dir, len);
        return hit ? { point: hit.point, anchorId: hit.anchorId } : null;
      },
    });
    let h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    while (h.phase === 'flying') h = stepHook(h, { x: 0, y: 2, z: 0 }, q, DT);
    expect(h.phase).toBe('latched');
    expect(h.anchorDrone).toBe('drone-1');
  });
});

// ---------------------------------------------------------------------------
// Latched: auto-zip + hang
// ---------------------------------------------------------------------------

function latched(anchor: Vec3, length: number, over: Partial<HookState> = {}): HookState {
  return {
    phase: 'latched',
    pos: { ...anchor },
    vel: { x: 0, y: 0, z: 0 },
    anchor: { ...anchor },
    anchorDrone: null,
    length,
    hang: false,
    flightTime: 0,
    ...over,
  };
}

describe('stepAttached — constant-acceleration zip', () => {
  it('accelerates the player toward the anchor by zipAccel·dt (no stamina)', () => {
    const h = latched(ANCHOR, 8);
    const s = state({ x: 8, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }); // anchor is -x
    const res = stepAttached(h, s, DT);
    expect(res.vel.x).toBeCloseTo(-GRAPPLE.zipAccel * DT, 6);
    expect(res.vel.y).toBeCloseTo(0, 6);
    expect(res.h.hang).toBe(false);
    expect(res.pin).toBeNull();
    // length tracks the live distance for the rope visual.
    expect(res.h.length).toBeCloseTo(8, 6);
  });

  it('caps total speed at zipMaxSpeed while attached', () => {
    const h = latched(ANCHOR, 20);
    const s = state({ x: 20, y: 10, z: 0 }, { x: -GRAPPLE.zipMaxSpeed - 5, y: 0, z: 0 });
    const res = stepAttached(h, s, DT);
    const speed = Math.hypot(res.vel.x, res.vel.y, res.vel.z);
    expect(speed).toBeLessThanOrEqual(GRAPPLE.zipMaxSpeed + 1e-9);
  });

  it('damps the perpendicular velocity so the flight converges on the anchor', () => {
    const h = latched(ANCHOR, 10);
    const s = state({ x: 10, y: 10, z: 0 }, { x: 0, y: 0, z: 6 }); // pure sideways
    const res = stepAttached(h, s, DT);
    // Perpendicular (z) shrinks; toward-anchor (−x) grows.
    expect(Math.abs(res.vel.z)).toBeLessThan(6);
    expect(res.vel.x).toBeLessThan(0);
  });

  it('enters hang within hangLength of the anchor: pins the player, zeroes velocity', () => {
    const h = latched(ANCHOR, 2);
    // Player physically inside hangLength of the anchor.
    const s = state({ x: 0, y: 10 - GRAPPLE.hangLength * 0.9, z: 0 }, { x: 2, y: -3, z: 1 });
    const res = stepAttached(h, s, DT);
    expect(res.h.hang).toBe(true);
    expect(res.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(res.pin).not.toBeNull();
    // Pinned at (or approaching) hangLength from the anchor.
    const d = Math.hypot(
      res.pin!.x - ANCHOR.x,
      res.pin!.y - ANCHOR.y,
      res.pin!.z - ANCHOR.z,
    );
    expect(d).toBeCloseTo(GRAPPLE.hangLength, 6);
  });

  it('while hanging, stays pinned with zero velocity every step', () => {
    const h = latched(ANCHOR, GRAPPLE.hangLength, { hang: true });
    const s = state({ x: 0, y: 10 - GRAPPLE.hangLength, z: 0 }, { x: 5, y: -5, z: 0 });
    const res = stepAttached(h, s, DT);
    expect(res.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(res.pin).toEqual(hangPin(ANCHOR, s.pos));
    expect(res.h.hang).toBe(true);
  });
});

describe('hangPin', () => {
  it('pins hangLength below the anchor when the radial is degenerate', () => {
    const pin = hangPin(ANCHOR, { ...ANCHOR });
    expect(pin).toEqual({ x: 0, y: 10 - GRAPPLE.hangLength, z: 0 });
  });
});

describe('stepAttached — hang-pin approach & ground clamp', () => {
  it('closes half the radial gap per step instead of teleporting when hang starts far out', () => {
    // Player is 6m from the anchor when the zip crosses hangLength (fast swing
    // lag). The pin must approach (d*0.5 = 3m), not snap straight to 1.2m.
    const h = latched(ANCHOR, GRAPPLE.hangLength, { hang: true });
    const s = state({ x: 6, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    const res = stepAttached(h, s, DT);
    const d = Math.hypot(res.pin!.x - ANCHOR.x, res.pin!.y - ANCHOR.y, res.pin!.z - ANCHOR.z);
    expect(d).toBeCloseTo(3, 6);
    // Converges: repeating from the pin halves again until the hangLength floor.
    const res2 = stepAttached(res.h, { ...s, pos: res.pin! }, DT);
    const d2 = Math.hypot(res2.pin!.x - ANCHOR.x, res2.pin!.y - ANCHOR.y, res2.pin!.z - ANCHOR.z);
    expect(d2).toBeCloseTo(1.5, 6);
  });

  it('clamps the pinned position above the terrain surface when heightAt is supplied', () => {
    // Terrain anchor approached from below: without the clamp the pin would
    // land hangLength below an anchor that sits only anchorLift above ground.
    const h = latched(ANCHOR, GRAPPLE.hangLength, { hang: true });
    const s = state({ x: 0, y: 10 - GRAPPLE.hangLength, z: 0 }, { x: 0, y: 0, z: 0 });
    const groundY = 9.5; // surface just below the anchor at y=10
    const res = stepAttached(h, s, DT, () => groundY);
    expect(res.pin!.y).toBeGreaterThanOrEqual(groundY + 0.1 - 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Rope constraint physics (constant-length pendulum, exercised directly)
// ---------------------------------------------------------------------------

describe('applyRopeConstraint — taut rope', () => {
  it('kills outward radial velocity but preserves tangential speed', () => {
    const vTangential = 6; // along -z
    const vOutward = 4; // along +x (radial, outward)
    const pos: Vec3 = { x: 5, y: 10, z: 0 };
    const vel = applyRopeConstraint(ANCHOR, 4.9, pos, { x: vOutward, y: 0, z: -vTangential }, DT);
    expect(vel.x).toBeLessThanOrEqual(0);
    expect(vel.x).toBeGreaterThan(-0.1);
    expect(vel.z).toBeCloseTo(-vTangential, 10);
    expect(Math.hypot(vel.y, vel.z)).toBeCloseTo(vTangential, 10);
  });

  it('does not add energy: outbound speed never grows when taut', () => {
    const before = speed({ x: 4, y: 0, z: -6 });
    const vel = applyRopeConstraint(ANCHOR, 5, { x: 5, y: 10, z: 0 }, { x: 4, y: 0, z: -6 }, DT);
    expect(speed(vel)).toBeLessThanOrEqual(before + 1e-9);
  });

  it('spring pulls inward when overstretched at rest', () => {
    const vel = applyRopeConstraint(ANCHOR, 5, { x: 7, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, DT);
    expect(vel.x).toBeLessThan(0);
    expect(vel.y).toBeCloseTo(0, 6);
    expect(vel.z).toBeCloseTo(0, 6);
    const expected = Math.min(GRAPPLE.stiffness * (7 - 5), GRAPPLE.springAccelMax) * DT;
    expect(-vel.x).toBeCloseTo(expected, 6);
  });

  it('leaves velocity unchanged inside the rope reach (slack)', () => {
    const v = { x: 4, y: -2, z: 1 };
    const vel = applyRopeConstraint(ANCHOR, 8, { x: 3, y: 10, z: 0 }, v, DT);
    expect(vel).toEqual(v);
  });
});

describe('applyRopeConstraint — pendulum energy conservation', () => {
  it('conserves mechanical energy over a 2s swing within 10%', () => {
    const anchor: Vec3 = { x: 0, y: 20, z: 0 };
    const length = 12;
    let pos: Vec3 = { x: length, y: 20, z: 0 };
    let vel: Vec3 = { x: 0, y: 0, z: 0 };

    const gAbs = -MOVE.gravity;
    const energy = (p: Vec3, v: Vec3): number =>
      0.5 * (v.x ** 2 + v.y ** 2 + v.z ** 2) + gAbs * p.y;

    const e0 = energy(pos, vel);
    let maxDist = 0;
    for (let i = 0; i < 120; i++) {
      const vy = vel.y + MOVE.gravity * DT;
      pos = { x: pos.x + vel.x * DT, y: pos.y + vy * DT, z: pos.z + vel.z * DT };
      vel = applyRopeConstraint(anchor, length, pos, { x: vel.x, y: vy, z: vel.z }, DT);
      maxDist = Math.max(maxDist, Math.hypot(pos.x - anchor.x, pos.y - anchor.y, pos.z - anchor.z));
    }

    const drift = Math.abs(energy(pos, vel) - e0) / e0;
    expect(drift).toBeLessThan(0.1);
    expect(maxDist).toBeLessThan(length + 1);
  });
});

// ---------------------------------------------------------------------------
// Invariant: no free flight from missed hooks
// ---------------------------------------------------------------------------

describe('no free flight — RMB spam with always-missing hooks', () => {
  it('altitude strictly falls while firing hooks that never latch', () => {
    // Player free-falls under gravity. Every step we (re)fire a hook that can
    // never hit anything (terrain far below, no props/drones). A missed hook
    // must grant zero impulse — so the player's altitude strictly decreases.
    const q = emptyQueries(); // heightAt -1000, no colliders, no drones
    let pos: Vec3 = { x: 0, y: 200, z: 0 };
    let vy = 0;
    let hook: HookState | null = null;
    let prevY = pos.y;

    for (let i = 0; i < 300; i++) {
      // Spam RMB: fire whenever idle/done.
      if (!hook || hook.phase === 'done') hook = fireHook(pos, { x: 0, y: 1, z: 0 });
      // Player integrates gravity only — the hook applies no force while flying.
      vy += MOVE.gravity * DT;
      pos = { x: pos.x, y: pos.y + vy * DT, z: pos.z };
      // Advance the (missing) hook.
      hook = stepHook(hook, pos, q, DT);
      // A flying/done hook never latches → never affects the player.
      expect(hook.phase).not.toBe('latched');
      expect(pos.y).toBeLessThan(prevY);
      prevY = pos.y;
    }
    expect(pos.y).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// Determinism + debug helper
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('stepAttached is pure and deterministic', () => {
    const h = latched(ANCHOR, 5);
    const s = state({ x: 5, y: 10, z: 0 }, { x: 3, y: -1, z: 2 });
    const hSnap = JSON.parse(JSON.stringify(h));
    const sSnap = JSON.parse(JSON.stringify(s));
    const a = stepAttached(h, s, DT);
    const b = stepAttached(h, s, DT);
    expect(a).toEqual(b);
    expect(h).toEqual(hSnap); // not mutated
    expect(s).toEqual(sSnap);
  });

  it('stepHook does not mutate its inputs', () => {
    const h = fireHook({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    const hSnap = JSON.parse(JSON.stringify(h));
    stepHook(h, { x: 0, y: 0, z: 0 }, emptyQueries(), DT);
    expect(h).toEqual(hSnap);
  });
});

describe('latchedHook (debug instant attach)', () => {
  it('produces a latched hook with length = player→anchor distance', () => {
    const h = latchedHook({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(h.phase).toBe('latched');
    expect(h.hang).toBe(false);
    expect(h.length).toBeCloseTo(30, 6);
    expect(h.anchor).toEqual({ x: 0, y: 30, z: 0 });
  });
});

// ---------------------------------------------------------------------------
// Terrain ray-march (retained for debug / occlusion)
// ---------------------------------------------------------------------------

describe('raycastTerrain', () => {
  const flatAt = (h: number) => () => h;

  it('hits flat ground below a downward ray', () => {
    const hit = raycastTerrain({ x: 0, y: 10, z: 0 }, { x: 1, y: -1, z: 0 }, flatAt(0), 45);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(0, 1);
    expect(hit!.x).toBeCloseTo(10, 1);
  });

  it('returns null when the ray never meets the ground within range', () => {
    const hit = raycastTerrain({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, flatAt(0), 45);
    expect(hit).toBeNull();
  });

  it('finds a hillside (rising ground ahead)', () => {
    const rising = (x: number) => x;
    const hit = raycastTerrain({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, rising, 45);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(5, 0);
    expect(hit!.y).toBeCloseTo(5, 0);
  });
});

describe('AnchorRegistry', () => {
  it('raycasts the nearest registered sphere', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('near', () => ({ x: 5, y: 0, z: 0 }), 1);
    reg.registerAnchor('far', () => ({ x: 20, y: 0, z: 0 }), 1);
    const hit = reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45);
    expect(hit).not.toBeNull();
    expect(hit!.anchorId).toBe('near');
    expect(hit!.point.x).toBeCloseTo(4, 5);
  });

  it('misses spheres the ray does not cross', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('off', () => ({ x: 5, y: 10, z: 0 }), 1);
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).toBeNull();
  });

  it('respects maxDist and unregister', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('a', () => ({ x: 40, y: 0, z: 0 }), 1);
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull();
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).not.toBeNull();
    reg.unregisterAnchor('a');
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).toBeNull();
  });

  it('tracks a moving anchor via getPos + getAnchorPos', () => {
    const reg = new AnchorRegistry();
    let x = 5;
    reg.registerAnchor('drone', () => ({ x, y: 0, z: 0 }), 1);
    expect(reg.getAnchorPos('drone')!.x).toBe(5);
    x = 30;
    expect(reg.getAnchorPos('drone')!.x).toBe(30);
    expect(reg.getAnchorPos('missing')).toBeNull();
  });
});
