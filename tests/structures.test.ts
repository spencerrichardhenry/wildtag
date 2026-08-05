import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STRUCTURES } from '../src/core/constants.ts';
import type { GroundQuery, Vec3 } from '../src/core/types.ts';
import {
  validateZipline,
  zipRide,
  zipPoint,
  ZiplineSystem,
  initialHold,
  stepHold,
} from '../src/structures/ziplines.ts';
import { DroneSystem, hoverAltitude } from '../src/structures/drones.ts';
import { AnchorRegistry } from '../src/structures/anchors.ts';
import { createInventory } from '../src/craft/inventory.ts';

const DT = 1 / 60;

/** Flat ground at y=0 unless a height function is supplied. */
function ground(heightAt: (x: number, z: number) => number = () => 0): GroundQuery {
  return { heightAt, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

// ---------------------------------------------------------------------------
// validateZipline
// ---------------------------------------------------------------------------

describe('validateZipline', () => {
  const flat = () => 0;

  it('accepts a clear span within range', () => {
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: 50, y: 4, z: 0 };
    expect(validateZipline(a, b, flat)).toEqual({ ok: true });
  });

  it('rejects a span longer than the max length', () => {
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: STRUCTURES.ziplineMaxLen + 5, y: 4, z: 0 };
    const res = validateZipline(a, b, flat);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('length');
  });

  it('accepts a span exactly at the max length', () => {
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: STRUCTURES.ziplineMaxLen, y: 4, z: 0 };
    expect(validateZipline(a, b, flat).ok).toBe(true);
  });

  it('rejects a span blocked by a terrain bump (wall in the middle)', () => {
    // A wall rises to y=10 near the midpoint; the cable dips through it.
    const wall = (x: number): number => (x > 20 && x < 30 ? 10 : 0);
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: 50, y: 4, z: 0 };
    const res = validateZipline(a, b, wall);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('los');
  });

  it("rejects a span that clears the ground but hangs a rider too low ('low')", () => {
    // Cable clears losClearance everywhere but the sagging midpoint sits within
    // losClearance + ziplineHang of the ground, so a hanging rider would drag.
    const a: Vec3 = { x: 0, y: 2.5, z: 0 };
    const b: Vec3 = { x: 50, y: 2.5, z: 0 };
    const res = validateZipline(a, b, () => 0);
    // Midpoint cable y = 2.5 − sag(1.5) = 1.0; clearance 1.0 ≥ losClearance (0.5)
    // but < losClearance + ziplineHang (1.7).
    expect(STRUCTURES.losClearance + STRUCTURES.ziplineHang).toBeGreaterThan(1.0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('low');
  });

  it('accepts a span that clears the full rider hang', () => {
    // Endpoints high enough that even the sag midpoint keeps a rider clear.
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: 50, y: 4, z: 0 };
    expect(validateZipline(a, b, () => 0).ok).toBe(true);
  });

  it('allows the endpoints to sit right on the terrain', () => {
    // Ground rises to endpoint height only at the two ends; interior is clear.
    const bumpedEnds = (x: number): number => (x < 2 || x > 48 ? 4 : 0);
    const a: Vec3 = { x: 0, y: 4, z: 0 };
    const b: Vec3 = { x: 50, y: 4, z: 0 };
    expect(validateZipline(a, b, bumpedEnds).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// zipPoint — sag curve
// ---------------------------------------------------------------------------

describe('zipPoint', () => {
  const a: Vec3 = { x: 0, y: 10, z: 0 };
  const b: Vec3 = { x: 40, y: 10, z: 0 };

  it('matches the endpoints at t=0 and t=1', () => {
    expect(zipPoint(0, a, b)).toEqual({ x: 0, y: 10, z: 0 });
    expect(zipPoint(1, a, b)).toEqual({ x: 40, y: 10, z: 0 });
  });

  it('dips by the sag amount at the midpoint', () => {
    const mid = zipPoint(0.5, a, b);
    expect(mid.x).toBeCloseTo(20, 6);
    // Chord midpoint y is 10; sag pulls it down by exactly STRUCTURES.sag.
    expect(mid.y).toBeCloseTo(10 - STRUCTURES.sag, 6);
  });

  it('never dips more than the sag amount (max at the midpoint)', () => {
    let maxDip = 0;
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const chordY = 10; // flat chord
      maxDip = Math.max(maxDip, chordY - zipPoint(t, a, b).y);
    }
    expect(maxDip).toBeCloseTo(STRUCTURES.sag, 6);
  });
});

// ---------------------------------------------------------------------------
// zipRide — traversal + slope assist + exit velocity
// ---------------------------------------------------------------------------

describe('zipRide', () => {
  it('advances t at the base speed on a level line', () => {
    const a: Vec3 = { x: 0, y: 10, z: 0 };
    const b: Vec3 = { x: 70, y: 10, z: 0 }; // length 70
    const r = zipRide(0, a, b, DT);
    // dt-per-step advance = speed/len * dt; level → base speed.
    expect(r.t).toBeCloseTo((STRUCTURES.ziplineSpeed / 70) * DT, 6);
    expect(r.done).toBe(false);
  });

  it('rides faster downhill than uphill', () => {
    const len = 40;
    const down: [Vec3, Vec3] = [
      { x: 0, y: 30, z: 0 },
      { x: 40, y: 10, z: 0 },
    ];
    const up: [Vec3, Vec3] = [
      { x: 0, y: 10, z: 0 },
      { x: 40, y: 30, z: 0 },
    ];
    void len;
    const dT = zipRide(0, down[0], down[1], DT).t;
    const uT = zipRide(0, up[0], up[1], DT).t;
    expect(dT).toBeGreaterThan(uT);
  });

  it('never drops below the minimum ride speed on a steep uphill', () => {
    // Near-vertical uphill: slope ≈ -1 → base 14 - 6 = 8, still ≥ min 6.
    // Force an extreme by making the drop dominate: a→b climbs almost fully.
    const a: Vec3 = { x: 0, y: 0, z: 0 };
    const b: Vec3 = { x: 1, y: 40, z: 0 }; // slope (a.y-b.y)/len ≈ -1
    const len = dist(a, b);
    const r = zipRide(0, a, b, DT);
    const speed = (r.t / DT) * len;
    expect(speed).toBeGreaterThanOrEqual(STRUCTURES.minSpeed - 1e-6);
  });

  it('clamps t to 1 and reports done at the end of the line', () => {
    const a: Vec3 = { x: 0, y: 10, z: 0 };
    const b: Vec3 = { x: 5, y: 10, z: 0 };
    const r = zipRide(0.99, a, b, 10); // huge dt overshoots
    expect(r.t).toBe(1);
    expect(r.done).toBe(true);
    expect(r.pos.x).toBeCloseTo(5, 6);
  });

  it('exit velocity points along the line at ride speed', () => {
    const a: Vec3 = { x: 0, y: 20, z: 0 };
    const b: Vec3 = { x: 30, y: 10, z: 0 };
    const r = zipRide(0.5, a, b, DT);
    const len = dist(a, b);
    // Direction is the chord a→b unit vector.
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const uz = (b.z - a.z) / len;
    const speed = Math.hypot(r.vel.x, r.vel.y, r.vel.z);
    expect(r.vel.x / speed).toBeCloseTo(ux, 6);
    expect(r.vel.y / speed).toBeCloseTo(uy, 6);
    expect(r.vel.z / speed).toBeCloseTo(uz, 6);
    // Downhill → faster than base.
    expect(speed).toBeGreaterThan(STRUCTURES.ziplineSpeed);
  });
});

// ---------------------------------------------------------------------------
// ZiplineSystem — count limits + kit accounting + mounts
// ---------------------------------------------------------------------------

describe('ZiplineSystem', () => {
  function makeSystem(kits = 10): { sys: ZiplineSystem; inv: ReturnType<typeof createInventory> } {
    const inv = createInventory();
    inv.kits.zipline = kits;
    const sys = new ZiplineSystem(new THREE.Scene(), ground(), inv);
    return { sys, inv };
  }

  const A: Vec3 = { x: 0, y: 4, z: 0 };
  const B: Vec3 = { x: 40, y: 4, z: 0 };

  it('enforces the max-zipline count and reports it', () => {
    const { sys } = makeSystem();
    for (let i = 0; i < STRUCTURES.maxZiplines; i++) {
      const b: Vec3 = { x: 40, y: 4, z: i * 5 };
      expect(sys.place(A, b).ok).toBe(true);
    }
    const over = sys.place(A, { x: 40, y: 4, z: 99 });
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('max');
    expect(sys.count).toBe(STRUCTURES.maxZiplines);
  });

  it('consumes a kit on place and refunds it on recall', () => {
    const { sys, inv } = makeSystem(2);
    const res = sys.place(A, B);
    expect(res.ok).toBe(true);
    expect(inv.kits.zipline).toBe(1);
    const recalled = sys.recall(res.id!);
    expect(recalled).toBe(true);
    expect(inv.kits.zipline).toBe(2);
    expect(sys.count).toBe(0);
  });

  it('rejects placing without a kit', () => {
    const { sys } = makeSystem(0);
    expect(sys.place(A, B).ok).toBe(false);
  });

  it('finds the nearest mountable post within range', () => {
    const { sys } = makeSystem();
    sys.place(A, B);
    // Stand near post A (posts sit at the endpoint's ground column).
    const near = sys.nearestMount({ x: 0.5, y: 0, z: 0 });
    expect(near).not.toBeNull();
    expect(near!.end).toBe('a');
    // Far from either post → no mount.
    expect(sys.nearestMount({ x: 20, y: 0, z: 40 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stepHold — pure tap-vs-recall timer
// ---------------------------------------------------------------------------

describe('stepHold', () => {
  it('classifies a short tap as a mount on release', () => {
    let s = initialHold;
    // Hold for 0.3s (< recallTap), then release.
    for (let t = 0; t < 0.3; t += DT) {
      const r = stepHold(s, true, DT);
      s = r.next;
      expect(r.action).toBeNull();
    }
    const rel = stepHold(s, false, DT);
    expect(rel.action).toBe('mount');
  });

  it('fires recall exactly once after the hold threshold and not again', () => {
    let s = initialHold;
    let recalls = 0;
    let mounts = 0;
    // Hold well past the recall threshold.
    for (let t = 0; t < STRUCTURES.recallHold + 0.5; t += DT) {
      const r = stepHold(s, true, DT);
      s = r.next;
      if (r.action === 'recall') recalls++;
      if (r.action === 'mount') mounts++;
    }
    // Release after the recall already fired → no mount.
    const rel = stepHold(s, false, DT);
    if (rel.action === 'recall') recalls++;
    if (rel.action === 'mount') mounts++;
    expect(recalls).toBe(1);
    expect(mounts).toBe(0);
  });

  it('does nothing on release for an ambiguous mid-length hold', () => {
    let s = initialHold;
    // Hold between recallTap and recallHold, then release.
    for (let t = 0; t < (STRUCTURES.recallTap + STRUCTURES.recallHold) / 2; t += DT) {
      s = stepHold(s, true, DT).next;
    }
    expect(stepHold(s, false, DT).action).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DroneSystem — hover height, count limits, ascent + anchor registration
// ---------------------------------------------------------------------------

describe('DroneSystem', () => {
  it('hover target is the ground height plus the hover offset', () => {
    expect(hoverAltitude(0)).toBe(STRUCTURES.droneHover);
    expect(hoverAltitude(12)).toBe(12 + STRUCTURES.droneHover);
  });

  function makeSystem(kits = 10): {
    sys: DroneSystem;
    inv: ReturnType<typeof createInventory>;
    anchors: AnchorRegistry;
  } {
    const inv = createInventory();
    inv.kits.drone = kits;
    const anchors = new AnchorRegistry();
    const sys = new DroneSystem(new THREE.Scene(), ground(() => 5), anchors, inv);
    return { sys, inv, anchors };
  }

  it('enforces the max-drone count', () => {
    // Needs at least maxDrones kits (12 as of playtest Task 9, up from 2) —
    // makeSystem's own default (10) predates that bump and would starve the
    // loop below on kit count rather than the cap it's meant to exercise.
    const { sys } = makeSystem(STRUCTURES.maxDrones);
    for (let i = 0; i < STRUCTURES.maxDrones; i++) {
      expect(sys.place({ x: i * 10, y: 5, z: 0 }).ok).toBe(true);
    }
    const over = sys.place({ x: 999, y: 5, z: 0 });
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('max');
  });

  it('consumes a kit on place and refunds + unregisters the anchor on recall', () => {
    const { sys, inv, anchors } = makeSystem(1);
    const res = sys.place({ x: 0, y: 5, z: 0 }, { instant: true });
    expect(res.ok).toBe(true);
    expect(inv.kits.drone).toBe(0);
    // An instant-altitude drone registers its anchor immediately.
    sys.update(DT);
    expect(anchors.size).toBe(1);
    expect(sys.recall(res.id!)).toBe(true);
    expect(inv.kits.drone).toBe(1);
    expect(anchors.size).toBe(0);
  });

  it('ascends toward the hover altitude and registers an anchor there', () => {
    const { sys, anchors } = makeSystem();
    const res = sys.place({ x: 0, y: 5, z: 0 });
    expect(res.ok).toBe(true);
    // Not yet at altitude → no anchor.
    sys.update(DT);
    expect(anchors.size).toBe(0);
    // Fly the ascent forward well past the climb time.
    for (let t = 0; t < 20; t += DT) sys.update(DT);
    expect(anchors.size).toBe(1);
    const pos = sys.dronePos(res.id!)!;
    // Station-holds within the bob band around ground(5)+hover.
    expect(pos.y).toBeGreaterThan(5 + STRUCTURES.droneHover - STRUCTURES.droneBob - 1e-6);
    expect(pos.y).toBeLessThan(5 + STRUCTURES.droneHover + STRUCTURES.droneBob + 1e-6);
  });

  // Destruction mode (playtest Task 9): drones reclaim by PROXIMITY (standing
  // beneath one), not by aiming a ray — see structures/demolish.ts's file
  // header for why. `recallableIdNear` is a thin public wrapper over the same
  // private test `nearRecall` already uses.
  describe('recallableIdNear (playtest Task 9 demolish proximity reclaim)', () => {
    it('returns the id of a recallable drone within droneRecallRange', () => {
      const { sys } = makeSystem(1);
      const res = sys.place({ x: 0, y: 5, z: 0 }, { instant: true });
      sys.update(DT); // register the anchor
      expect(sys.recallableIdNear({ x: 1, y: 5, z: 0 })).toBe(res.id);
    });

    it('returns null when no drone is within range', () => {
      const { sys } = makeSystem(1);
      sys.place({ x: 0, y: 5, z: 0 }, { instant: true });
      sys.update(DT);
      expect(sys.recallableIdNear({ x: 999, y: 5, z: 0 })).toBeNull();
    });

    it('mirrors nearRecall\'s boolean — id present iff nearRecall is true', () => {
      const { sys } = makeSystem(1);
      sys.place({ x: 0, y: 5, z: 0 }, { instant: true });
      sys.update(DT);
      const near = { x: 2, y: 5, z: 0 };
      const far = { x: 999, y: 5, z: 0 };
      expect(sys.recallableIdNear(near) !== null).toBe(sys.nearRecall(near));
      expect(sys.recallableIdNear(far) !== null).toBe(sys.nearRecall(far));
    });

    it('the returned id actually recalls that drone and refunds its kit', () => {
      const { sys, inv } = makeSystem(1);
      sys.place({ x: 0, y: 5, z: 0 }, { instant: true });
      sys.update(DT);
      const id = sys.recallableIdNear({ x: 0, y: 5, z: 0 });
      expect(id).not.toBeNull();
      expect(sys.recall(id!)).toBe(true);
      expect(inv.kits.drone).toBe(1);
      expect(sys.count).toBe(0);
    });
  });
});
