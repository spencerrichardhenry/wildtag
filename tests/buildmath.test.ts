import { describe, expect, it } from 'vitest';
import { BUILD } from '../src/core/constants.ts';
import type { Vec3 } from '../src/core/types.ts';
import {
  buildTopAt,
  freeformSnap,
  pieceHeight,
  resolveSnap,
  placementValid,
  pieceAtRay,
  pieceAtRayHit,
  pieceObstacles,
  pieceGrapple,
  resolveBuildAim,
  type BuildPiece,
} from '../src/structures/buildmath.ts';

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

function wall(id: number, x: number, y: number, z: number, yaw = 0): BuildPiece {
  return { id, kind: 'wall', x, y, z, yaw };
}

function ramp(id: number, x: number, y: number, z: number, yaw = 0): BuildPiece {
  return { id, kind: 'ramp', x, y, z, yaw };
}

function cube(id: number, x: number, y: number, z: number, yaw = 0): BuildPiece {
  return { id, kind: 'cube', x, y, z, yaw };
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// pieceHeight
// ---------------------------------------------------------------------------

describe('pieceHeight', () => {
  it('wall height is BUILD.wall.h', () => {
    expect(pieceHeight('wall')).toBe(BUILD.wall.h);
  });
  it('ramp height is BUILD.ramp.rise', () => {
    expect(pieceHeight('ramp')).toBe(BUILD.ramp.rise);
  });
  it('cube height is BUILD.cube.h (playtest Task 8)', () => {
    expect(pieceHeight('cube')).toBe(BUILD.cube.h);
  });
});

// ---------------------------------------------------------------------------
// buildTopAt
// ---------------------------------------------------------------------------

describe('buildTopAt', () => {
  it('returns -Infinity with no pieces', () => {
    expect(buildTopAt([], 0, 0)).toBe(-Infinity);
  });

  it('returns -Infinity when no piece covers (x,z)', () => {
    const pieces = [wall(1, 0, 0, 0)];
    expect(buildTopAt(pieces, 50, 50)).toBe(-Infinity);
  });

  it('flat wall: top at centre is y + wall.h', () => {
    const pieces = [wall(1, 0, 0, 0)];
    expect(buildTopAt(pieces, 0, 0)).toBeCloseTo(BUILD.wall.h, 9);
  });

  it('flat wall: top holds anywhere within the w×t footprint (yaw=0 -> width along X, thickness along Z)', () => {
    const pieces = [wall(1, 5, 1, -3)];
    // within half-width (w/2=1) along X, within half-thickness (t/2=0.2) along Z
    expect(buildTopAt(pieces, 5 + 0.9, -3 + 0.15)).toBeCloseTo(1 + BUILD.wall.h, 9);
  });

  it('flat wall: just outside the footprint on X is not covered', () => {
    const pieces = [wall(1, 0, 0, 0)];
    expect(buildTopAt(pieces, BUILD.wall.w / 2 + 0.01, 0)).toBe(-Infinity);
  });

  it('flat wall: just outside the footprint on Z (thickness) is not covered', () => {
    const pieces = [wall(1, 0, 0, 0)];
    expect(buildTopAt(pieces, 0, BUILD.wall.t / 2 + 0.01)).toBe(-Infinity);
  });

  it('2-stack: a wall placed on top of another reports the higher top', () => {
    const base = wall(1, 0, 0, 0);
    const top = wall(2, 0, BUILD.wall.h, 0);
    expect(buildTopAt([base, top], 0, 0)).toBeCloseTo(2 * BUILD.wall.h, 9);
  });

  it('ramp: slope interpolates 0% at the low end (local w = -run/2)', () => {
    const r = ramp(1, 0, 0, 0); // yaw 0 -> wDir=(0,1) in (x,z); low end at z=-run/2
    const z = -BUILD.ramp.run / 2;
    expect(buildTopAt([r], 0, z)).toBeCloseTo(0, 9);
  });

  it('ramp: slope interpolates 25%', () => {
    const r = ramp(1, 0, 0, 0);
    const z = -BUILD.ramp.run / 2 + 0.25 * BUILD.ramp.run;
    expect(buildTopAt([r], 0, z)).toBeCloseTo(0.25 * BUILD.ramp.rise, 9);
  });

  it('ramp: slope interpolates 75%', () => {
    const r = ramp(1, 0, 0, 0);
    const z = -BUILD.ramp.run / 2 + 0.75 * BUILD.ramp.run;
    expect(buildTopAt([r], 0, z)).toBeCloseTo(0.75 * BUILD.ramp.rise, 9);
  });

  it('ramp: slope interpolates 100% at the high end (local w = +run/2)', () => {
    const r = ramp(1, 0, 0, 0);
    const z = BUILD.ramp.run / 2;
    expect(buildTopAt([r], 0, z)).toBeCloseTo(BUILD.ramp.rise, 9);
  });

  it('ramp: off-footprint (outside width) contributes nothing', () => {
    const r = ramp(1, 0, 0, 0);
    expect(buildTopAt([r], BUILD.ramp.w / 2 + 0.5, 0)).toBe(-Infinity);
  });

  it('ramp: off-footprint (beyond the run) contributes nothing', () => {
    const r = ramp(1, 0, 0, 0);
    expect(buildTopAt([r], 0, BUILD.ramp.run / 2 + 0.5)).toBe(-Infinity);
  });

  it('rotated 45° wall: a point on the local-frame diagonal within the footprint is covered', () => {
    const yaw = 45 * DEG;
    const pieces = [wall(1, 10, 0, 10, yaw)];
    // Local point (u=0.5, w=0) rotated into world by the forward transform:
    // dx = u*cos(yaw) + w*sin(yaw); dz = -u*sin(yaw) + w*cos(yaw)
    const u = 0.5;
    const dx = u * Math.cos(yaw);
    const dz = -u * Math.sin(yaw);
    expect(buildTopAt(pieces, 10 + dx, 10 + dz)).toBeCloseTo(BUILD.wall.h, 9);
  });

  it('rotated 45° wall: a point that is inside the AXIS-ALIGNED bbox but outside the true rotated footprint is NOT covered', () => {
    const yaw = 45 * DEG;
    const pieces = [wall(1, 0, 0, 0, yaw)];
    // The AABB half-extent at 45 deg for a w=2,t=0.4 rect is roughly (1+0.2)*cos45 ≈ 0.848
    // Pick a corner-ish axis-aligned point clearly inside the AABB but outside the thin
    // rotated rectangle (e.g. straight along world X at 0.8, z=0.8 -- outside the rotated
    // strip which is only 0.4m thick).
    const x = 0.8;
    const z = 0.8;
    expect(buildTopAt(pieces, x, z)).toBe(-Infinity);
  });

  it('overlapping pieces: buildTopAt reports the max top across all contributing pieces', () => {
    const low = wall(1, 0, 0, 0); // top = wall.h
    const highRamp = ramp(2, 0, 3, 0); // top ranges [3, 3+rise], definitely higher
    expect(buildTopAt([low, highRamp], 0, 0)).toBeCloseTo(3 + BUILD.ramp.rise / 2, 9);
  });

  // --- cube (playtest Task 8): a bigger flat-topped box, same shape-math as wall ---

  it('cube: top at centre is y + cube.h', () => {
    const pieces = [cube(1, 0, 0, 0)];
    expect(buildTopAt(pieces, 0, 0)).toBeCloseTo(BUILD.cube.h, 9);
  });

  it('cube: top holds anywhere within the full 2×2 footprint', () => {
    const pieces = [cube(1, 5, 1, -3)];
    expect(buildTopAt(pieces, 5 + 0.9, -3 + 0.9)).toBeCloseTo(1 + BUILD.cube.h, 9);
  });

  it('cube: just outside the footprint is not covered', () => {
    const pieces = [cube(1, 0, 0, 0)];
    expect(buildTopAt(pieces, BUILD.cube.w / 2 + 0.01, 0)).toBe(-Infinity);
    expect(buildTopAt(pieces, 0, BUILD.cube.d / 2 + 0.01)).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// resolveSnap
// ---------------------------------------------------------------------------

describe('resolveSnap', () => {
  it('freeform fallback when no piece is within snapR: yaw snapped to yawStepDeg, y = supplied aim.y', () => {
    const aim: Vec3 = { x: 100, y: 4.321, z: 100 };
    const camYawDeg = 22; // nearest 15-deg step is 15 (|22-15|=7 < |22-30|=8)
    const res = resolveSnap([], 'wall', aim, camYawDeg);
    expect(res.snapped).toBeNull();
    expect(res.x).toBe(aim.x);
    expect(res.y).toBe(aim.y);
    expect(res.z).toBe(aim.z);
    expect(res.yaw).toBeCloseTo(15 * DEG, 9);
  });

  it('freeform yaw snaps to the nearest yawStepDeg multiple (negative angle)', () => {
    const aim: Vec3 = { x: 0, y: 0, z: 0 };
    const res = resolveSnap([], 'wall', aim, -40); // nearest 15-multiple: -45 vs -30 -> -40 is 10 from -30, 5 from -45... check both
    // -40/15 = -2.667 -> rounds to -3 -> -45 deg
    expect(res.yaw).toBeCloseTo(-45 * DEG, 9);
  });

  it("'top' snap: aiming near an existing piece's top-face centre stacks directly on top (same x/z/yaw)", () => {
    const base = wall(1, 5, 0, -2, 30 * DEG);
    const aim: Vec3 = { x: 5.2, y: BUILD.wall.h + 0.1, z: -2.1 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBe('top');
    expect(res.x).toBeCloseTo(5, 9);
    expect(res.z).toBeCloseTo(-2, 9);
    expect(res.y).toBeCloseTo(BUILD.wall.h, 9);
    expect(res.yaw).toBeCloseTo(30 * DEG, 9);
  });

  it("'edge' snap: aiming near a wall's right edge midpoint continues the row (same yaw, one width over)", () => {
    const base = wall(1, 0, 0, 0, 0); // yaw 0 -> uDir=(1,0) in (x,z)
    // Right edge midpoint (side=+1): x = 0 + 1*(wall.w/2) = 1, y = wall.h/2, z = 0
    const aim: Vec3 = { x: BUILD.wall.w / 2 + 0.1, y: BUILD.wall.h / 2, z: 0.05 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBe('edge');
    expect(res.x).toBeCloseTo(BUILD.wall.w, 9); // one full width over
    expect(res.z).toBeCloseTo(0, 9);
    expect(res.y).toBeCloseTo(0, 9); // same y as base
    expect(res.yaw).toBeCloseTo(0, 9);
  });

  it("'edge' snap: aiming near a wall's LEFT edge continues the row the other direction", () => {
    const base = wall(1, 0, 0, 0, 0);
    const aim: Vec3 = { x: -(BUILD.wall.w / 2 + 0.1), y: BUILD.wall.h / 2, z: 0 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBe('edge');
    expect(res.x).toBeCloseTo(-BUILD.wall.w, 9);
    expect(res.z).toBeCloseTo(0, 9);
  });

  it("'rampfoot' snap: placing a RAMP near a wall's base face aligns its high end to the face, yaw facing the wall", () => {
    const base = wall(1, 0, 0, 0, 0); // yaw 0 -> wDir=(0,1) in (x,z); front face at z=+t/2
    const aim: Vec3 = { x: 0.1, y: 0, z: BUILD.wall.t / 2 + 0.1 };
    const res = resolveSnap([base], 'ramp', aim, 0);
    expect(res.snapped).toBe('rampfoot');
    expect(res.y).toBeCloseTo(0, 9); // same base height as the wall
    // Ramp centre sits run/2 OUT from the face along the face's OUTWARD
    // normal (0,1) — the low end reaches further out into the open; getting
    // this backwards (centre run/2 IN, toward/through the wall) is exactly
    // the bug the placementValid + high-end checks below catch.
    expect(res.z).toBeCloseTo(BUILD.wall.t / 2 + BUILD.ramp.run / 2, 9);
    expect(res.x).toBeCloseTo(0, 9);
    // High end (local w=+run/2) of the ramp should land exactly at the wall face.
    const highEndX = res.x + Math.sin(res.yaw) * (BUILD.ramp.run / 2);
    const highEndZ = res.z + Math.cos(res.yaw) * (BUILD.ramp.run / 2);
    expect(highEndX).toBeCloseTo(0, 9);
    expect(highEndZ).toBeCloseTo(BUILD.wall.t / 2, 9);
    // Ramp top at the wall face equals rise, which equals wall.h -- flush with the wall top.
    expect(BUILD.ramp.rise).toBe(BUILD.wall.h);
    // The whole point: this candidate must NOT overlap the wall it's snapped
    // against (a ramp butted flush against a wall face, not driven through it).
    const candidate: BuildPiece = { id: -1, kind: 'ramp', x: res.x, y: res.y, z: res.z, yaw: res.yaw };
    expect(placementValid([base], candidate, 0)).toEqual({ ok: true });
  });

  it("'rampfoot' snap against the wall's BACK face (faceSign=-1) also lands flush, no overlap", () => {
    const base = wall(1, 0, 0, 0, 0);
    const aim: Vec3 = { x: -0.1, y: 0, z: -(BUILD.wall.t / 2 + 0.1) };
    const res = resolveSnap([base], 'ramp', aim, 0);
    expect(res.snapped).toBe('rampfoot');
    const highEndX = res.x + Math.sin(res.yaw) * (BUILD.ramp.run / 2);
    const highEndZ = res.z + Math.cos(res.yaw) * (BUILD.ramp.run / 2);
    expect(highEndX).toBeCloseTo(0, 9);
    expect(highEndZ).toBeCloseTo(-(BUILD.wall.t / 2), 9);
    const candidate: BuildPiece = { id: -1, kind: 'ramp', x: res.x, y: res.y, z: res.z, yaw: res.yaw };
    expect(placementValid([base], candidate, 0)).toEqual({ ok: true });
  });

  it("'rampfoot' snap against a ROTATED wall (yaw=30deg) still lands flush with no overlap", () => {
    const yaw = 30 * DEG;
    const base = wall(1, 5, 0, -3, yaw);
    // Front face (faceSign=+1) world position: face = p + wDir*(t/2), wDir=(sin(yaw),cos(yaw)).
    const faceX = 5 + Math.sin(yaw) * (BUILD.wall.t / 2);
    const faceZ = -3 + Math.cos(yaw) * (BUILD.wall.t / 2);
    const aim: Vec3 = { x: faceX + Math.sin(yaw) * 0.1, y: 0, z: faceZ + Math.cos(yaw) * 0.1 };
    const res = resolveSnap([base], 'ramp', aim, 0);
    expect(res.snapped).toBe('rampfoot');
    const highEndX = res.x + Math.sin(res.yaw) * (BUILD.ramp.run / 2);
    const highEndZ = res.z + Math.cos(res.yaw) * (BUILD.ramp.run / 2);
    expect(highEndX).toBeCloseTo(faceX, 9);
    expect(highEndZ).toBeCloseTo(faceZ, 9);
    const candidate: BuildPiece = { id: -1, kind: 'ramp', x: res.x, y: res.y, z: res.z, yaw: res.yaw };
    expect(placementValid([base], candidate, 0)).toEqual({ ok: true });
  });

  it("'rampfoot' is not offered when placing a WALL (only ramps get rampfoot candidates)", () => {
    const base = wall(1, 0, 0, 0, 0);
    const aim: Vec3 = { x: 0, y: 0, z: BUILD.wall.t / 2 + 0.1 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).not.toBe('rampfoot');
  });

  it('nearest candidate wins when multiple are within snapR', () => {
    const near = wall(1, 0, 0, 0, 0);
    const far = wall(2, 0, 0, 20, 0);
    // Aim close to `near`'s top (dist ~0.1) and technically also could be near `far`'s
    // edge if positioned right, but here it's just unambiguously near `near`.
    const aim: Vec3 = { x: 0.05, y: BUILD.wall.h + 0.05, z: 0.05 };
    const res = resolveSnap([near, far], 'wall', aim, 0);
    expect(res.snapped).toBe('top');
    expect(res.x).toBeCloseTo(0, 9);
    expect(res.z).toBeCloseTo(0, 9);
  });

  it('tie-break: top beats edge at equal distance', () => {
    // Construct an aim equidistant from `near`'s top-centre and `near`'s right edge
    // midpoint is contrived; instead directly verify the ordering by using two
    // different pieces positioned so their trigger points coincide with different
    // priorities but identical aim distance is impractical geometrically -- so we
    // verify tie-break via same-piece top vs edge distances forced equal using a
    // custom wall height... simplest: use a piece where wall.h/2 == wall.w/2 is false
    // in this project's constants (h=2,w=2 -> h/2=1=w/2=1) so top-centre (z=0,y=h) and
    // edge-mid (x=w/2,y=h/2,z=0) both project a specific distance from a well-chosen aim.
    const base = wall(1, 0, 0, 0, 0);
    // top centre: (0, BUILD.wall.h, 0); right edge mid: (BUILD.wall.w/2, BUILD.wall.h/2, 0)
    // Choose aim at the midpoint between these two trigger points -> equal distance to both.
    const topPt = { x: 0, y: BUILD.wall.h, z: 0 };
    const edgePt = { x: BUILD.wall.w / 2, y: BUILD.wall.h / 2, z: 0 };
    const aim: Vec3 = {
      x: (topPt.x + edgePt.x) / 2,
      y: (topPt.y + edgePt.y) / 2,
      z: (topPt.z + edgePt.z) / 2,
    };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBe('top');
  });

  it('beyond snapR of every piece falls back to freeform even with pieces present', () => {
    const base = wall(1, 0, 0, 0, 0);
    const aim: Vec3 = { x: 500, y: 3, z: 500 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBeNull();
    expect(res.x).toBe(500);
    expect(res.z).toBe(500);
  });

  // --- cube (playtest Task 8): top/edge/rampfoot all treat cubes like walls ---

  it("'top' snap works against a CUBE (any placed kind qualifies)", () => {
    const base = cube(1, 5, 0, -2, 30 * DEG);
    const aim: Vec3 = { x: 5.2, y: BUILD.cube.h + 0.1, z: -2.1 };
    const res = resolveSnap([base], 'wall', aim, 0);
    expect(res.snapped).toBe('top');
    expect(res.x).toBeCloseTo(5, 9);
    expect(res.z).toBeCloseTo(-2, 9);
    expect(res.y).toBeCloseTo(BUILD.cube.h, 9);
  });

  it("'edge' snap continues a CUBE row in the cube's own width (not the wall's)", () => {
    const base = cube(1, 0, 0, 0, 0);
    const aim: Vec3 = { x: BUILD.cube.w / 2 + 0.1, y: BUILD.cube.h / 2, z: 0.05 };
    const res = resolveSnap([base], 'cube', aim, 0);
    expect(res.snapped).toBe('edge');
    expect(res.x).toBeCloseTo(BUILD.cube.w, 9); // one full cube-width over
    expect(res.y).toBeCloseTo(0, 9);
  });

  it("'rampfoot' snap against a CUBE's face lands flush, no overlap — enables ramp->cube staircases", () => {
    const base = cube(1, 0, 0, 0, 0); // yaw 0 -> wDir=(0,1); front face at z=+cube.d/2
    const aim: Vec3 = { x: 0.1, y: 0, z: BUILD.cube.d / 2 + 0.1 };
    const res = resolveSnap([base], 'ramp', aim, 0);
    expect(res.snapped).toBe('rampfoot');
    expect(res.y).toBeCloseTo(0, 9);
    const highEndX = res.x + Math.sin(res.yaw) * (BUILD.ramp.run / 2);
    const highEndZ = res.z + Math.cos(res.yaw) * (BUILD.ramp.run / 2);
    expect(highEndX).toBeCloseTo(0, 9);
    expect(highEndZ).toBeCloseTo(BUILD.cube.d / 2, 9);
    // Cube height equals ramp rise, so the ramp's high end is flush with the
    // cube's top too — a second ramp can then 'top'-snap onto the cube.
    expect(BUILD.ramp.rise).toBe(BUILD.cube.h);
    const candidate: BuildPiece = { id: -1, kind: 'ramp', x: res.x, y: res.y, z: res.z, yaw: res.yaw };
    expect(placementValid([base], candidate, 0)).toEqual({ ok: true });
  });

  it("edge/rampfoot are NOT offered off a RAMP source piece (only wall/cube sources)", () => {
    const base = ramp(1, 0, 0, 0, 0);
    const aimEdge: Vec3 = { x: BUILD.ramp.w / 2 + 0.1, y: BUILD.ramp.rise / 2, z: 0 };
    expect(resolveSnap([base], 'wall', aimEdge, 0).snapped).not.toBe('edge');
    const aimFoot: Vec3 = { x: 0, y: 0, z: BUILD.ramp.run / 2 + 0.1 };
    expect(resolveSnap([base], 'ramp', aimFoot, 0).snapped).not.toBe('rampfoot');
  });
});

// ---------------------------------------------------------------------------
// freeformSnap
// ---------------------------------------------------------------------------

describe('freeformSnap', () => {
  it('is exactly resolveSnap\'s no-candidate fallback: aim verbatim, yaw stepped to yawStepDeg', () => {
    const aim: Vec3 = { x: 12.3, y: 4.5, z: -6.7 };
    const res = freeformSnap(aim, 22);
    expect(res.snapped).toBeNull();
    expect(res.x).toBe(aim.x);
    expect(res.y).toBe(aim.y);
    expect(res.z).toBe(aim.z);
    expect(res.yaw).toBeCloseTo(15 * DEG, 9);
  });

  it('ignores nearby pieces entirely — unlike resolveSnap, there is no piece argument at all', () => {
    // (compile-time: freeformSnap has no `pieces`/`kind` params — nothing to
    // assert at runtime beyond the identical fallback math above; this test
    // exists to document the contract explicitly.)
    const aim: Vec3 = { x: 0, y: 0, z: 0 };
    expect(freeformSnap(aim, 0)).toEqual({ x: 0, y: 0, z: 0, yaw: 0, snapped: null });
  });
});

// ---------------------------------------------------------------------------
// placementValid
// ---------------------------------------------------------------------------

describe('placementValid', () => {
  it('accepts a valid freeform placement on flat ground with no other pieces', () => {
    const candidate = wall(1, 0, 0, 0, 0);
    expect(placementValid([], candidate, 0)).toEqual({ ok: true });
  });

  it('height cap: exactly at maxStackH is OK (boundary)', () => {
    // candidate.y chosen so that candidate.y + wall.h - terrainY === maxStackH exactly.
    const terrainY = 0;
    const y = BUILD.maxStackH - BUILD.wall.h; // top = y + h = maxStackH exactly
    const candidate = wall(1, 0, y, 0, 0);
    expect(placementValid([], candidate, terrainY).ok).toBe(true);
  });

  it('height cap: clearly over maxStackH (beyond the march-precision tolerance) is invalid with reason "height"', () => {
    // HEIGHT_EPS (0.05) absorbs realistic raycastTerrain march-precision slop
    // (see its doc in buildmath.ts) — this delta (0.2) is well beyond that,
    // so it must still read as a genuine overshoot, not tolerance slack.
    const terrainY = 0;
    const y = BUILD.maxStackH - BUILD.wall.h + 0.2; // top = maxStackH + 0.2
    const candidate = wall(1, 0, y, 0, 0);
    const res = placementValid([], candidate, terrainY);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('height');
  });

  it('height cap: a small overshoot within the march-precision tolerance is still OK (playtest Task 8 fix)', () => {
    // Root cause (see HEIGHT_EPS's doc in buildmath.ts): a freeform piece's
    // stored y comes from raycastTerrain's bisection-refined march, which
    // only converges to within ~0.023 m of the true analytic height — NOT
    // machine precision. A stack whose base carried that much slop and is
    // otherwise sitting exactly at the nominal cap must not be spuriously
    // rejected on its last piece.
    const terrainY = 0;
    const y = BUILD.maxStackH - BUILD.wall.h + 0.02; // top = maxStackH + 0.02
    const candidate = wall(1, 0, y, 0, 0);
    expect(placementValid([], candidate, terrainY)).toEqual({ ok: true });
  });

  it('height cap accounts for terrainY (relative, not absolute, height)', () => {
    const terrainY = 50;
    const y = terrainY + BUILD.maxStackH - BUILD.wall.h; // top - terrainY == maxStackH exactly
    const candidate = wall(1, 0, y, 0, 0);
    expect(placementValid([], candidate, terrainY).ok).toBe(true);
    const badCandidate = wall(1, 0, y + 1, 0, 0);
    expect(placementValid([], badCandidate, terrainY).ok).toBe(false);
  });

  it('overlap: two walls at the same position/yaw/y are rejected as overlapping', () => {
    const existing = [wall(1, 0, 0, 0, 0)];
    const candidate = wall(2, 0, 0, 0, 0);
    const res = placementValid(existing, candidate, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overlap');
  });

  it('overlap: two walls overlapping in XZ AND y-range (partial stack overlap) are rejected', () => {
    const existing = [wall(1, 0, 0, 0, 0)]; // y-range [0, 2]
    const candidate = wall(2, 0, 1, 0, 0); // y-range [1, 3] -- overlaps [1,2], well beyond 0.05 tol
    const res = placementValid(existing, candidate, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overlap');
  });

  it('flush stack tolerance: a wall placed exactly on top of another (top-candidate output) is NOT an overlap', () => {
    const existing = [wall(1, 0, 0, 0, 0)];
    const candidate = wall(2, 0, BUILD.wall.h, 0, 0); // y-range [2,4], touches existing's [0,2] at y=2
    const res = placementValid(existing, candidate, 0);
    expect(res).toEqual({ ok: true });
  });

  it('edge-adjacent walls (same row, touching edges) are NOT an overlap', () => {
    const existing = [wall(1, 0, 0, 0, 0)];
    // Edge-snap candidate from the earlier resolveSnap test: one full width over.
    const candidate = wall(2, BUILD.wall.w, 0, 0, 0);
    const res = placementValid(existing, candidate, 0);
    expect(res).toEqual({ ok: true });
  });

  it('a small XZ gap between non-overlapping y-ranges never trips overlap even if XZ would overlap', () => {
    // Same XZ footprint entirely, but y-ranges only touch (already covered above) --
    // here instead confirm a real separation (gap > 0.05) between y ranges skips XZ.
    const existing = [wall(1, 0, 0, 0, 0)]; // [0,2]
    const candidate = wall(2, 0, 2.2, 0, 0); // [2.2, 4.2], gap of 0.2 > 0.05 tol, and same XZ footprint
    const res = placementValid(existing, candidate, 0);
    expect(res).toEqual({ ok: true });
  });

  it('overlap: a rotated (45°) wall overlapping an axis-aligned wall in XZ + y-range is rejected', () => {
    const existing = [wall(1, 0, 0, 0, 0)];
    const candidate = wall(2, 0, 0, 0, 45 * DEG); // same centre, same y-range -> footprints overlap
    const res = placementValid(existing, candidate, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overlap');
  });

  it('non-overlap: two walls far apart in XZ are valid regardless of y', () => {
    const existing = [wall(1, 0, 0, 0, 0)];
    const candidate = wall(2, 50, 0, 50, 0);
    expect(placementValid(existing, candidate, 0)).toEqual({ ok: true });
  });

  it('overlap check works against ramps too (ramp vs ramp, same footprint)', () => {
    const existing = [ramp(1, 0, 0, 0, 0)];
    const candidate = ramp(2, 0, 0, 0, 0);
    const res = placementValid(existing, candidate, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overlap');
  });

  it('overlap check works against cubes too (cube vs cube, same footprint) — playtest Task 8', () => {
    const existing = [cube(1, 0, 0, 0, 0)];
    const candidate = cube(2, 0, 0, 0, 0);
    const res = placementValid(existing, candidate, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overlap');
  });

  it('a cube top-stacked on another cube (flush touch) is NOT an overlap', () => {
    const existing = [cube(1, 0, 0, 0, 0)];
    const candidate = cube(2, 0, BUILD.cube.h, 0, 0);
    expect(placementValid(existing, candidate, 0)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// pieceAtRay
// ---------------------------------------------------------------------------

describe('pieceAtRay', () => {
  it('hits a wall directly ahead along +X', () => {
    const pieces = [wall(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRay(pieces, origin, dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe(1);
  });

  it('misses when aimed away from every piece', () => {
    const pieces = [wall(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: -1, y: 0, z: 0 };
    expect(pieceAtRay(pieces, origin, dir, 100)).toBeNull();
  });

  it('misses when the piece is beyond maxDist', () => {
    const pieces = [wall(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    expect(pieceAtRay(pieces, origin, dir, 5)).toBeNull();
  });

  it('returns the nearest piece when multiple are along the ray', () => {
    const pieces = [wall(1, 20, 0, 0, 0), wall(2, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRay(pieces, origin, dir, 100);
    expect(hit!.id).toBe(2);
  });

  it('hits a ramp too, via its expanded AABB', () => {
    const pieces = [ramp(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRay(pieces, origin, dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe(1);
  });

  it('misses empty piece list', () => {
    expect(pieceAtRay([], { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 100)).toBeNull();
  });

  it('hits a cube too, via its expanded AABB', () => {
    const pieces = [cube(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRay(pieces, origin, dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pieceAtRayHit (playtest Task 8 — "ghost lands behind the target" fix)
// ---------------------------------------------------------------------------

describe('pieceAtRayHit', () => {
  it('returns the piece AND its entry point/distance along the ray', () => {
    const pieces = [wall(1, 10, 0, 0, 0)];
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRayHit(pieces, origin, dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.piece.id).toBe(1);
    // Entry point is on the piece's expanded AABB, just short of its centre
    // (wall.w/2 + PICKUP_AABB_PAD before x=10).
    expect(hit!.point.x).toBeLessThan(10);
    expect(hit!.point.x).toBeGreaterThan(8);
    expect(hit!.point.y).toBeCloseTo(1, 9);
    expect(hit!.point.z).toBeCloseTo(0, 9);
    expect(hit!.dist).toBeCloseTo(hit!.point.x - origin.x, 9);
  });

  it('null on a total miss, same as pieceAtRay', () => {
    expect(pieceAtRayHit([], { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 100)).toBeNull();
  });

  it("aiming at a wall's SIDE FACE hits the wall nearer than terrain would ever be sampled behind it", () => {
    // This is the exact playtest bug: aiming levelly at a wall's face used to
    // sail past it (the terrain height field has no notion of a vertical
    // face) and land on whatever terrain sits behind. `pieceAtRayHit` gives
    // main.ts a piece-hit distance to compare against the terrain-hit
    // distance and prefer whichever is nearer — here, the piece is only ~2m
    // away while "behind the wall" terrain would be 10+m away along the
    // same ray, so callers should always prefer this hit.
    const pieces = [wall(1, 2, 1, 0, 0)]; // wall centred at x=2, spanning roughly x in [1,3]
    const origin: Vec3 = { x: 0, y: 1, z: 0 };
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const hit = pieceAtRayHit(pieces, origin, dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// resolveBuildAim (playtest Task 8 — the exact "aim at a wall face lands ON
// it, not behind it" fix, extracted so main.ts's comparison is unit-testable)
// ---------------------------------------------------------------------------

describe('resolveBuildAim', () => {
  const origin: Vec3 = { x: 0, y: 1, z: 0 };

  it('prefers the piece hit when it is nearer than the terrain hit', () => {
    const pieceHit = { piece: wall(1, 2, 1, 0, 0), point: { x: 1.8, y: 1, z: 0 }, dist: 1.8 };
    const terrainAim: Vec3 = { x: 10, y: 0, z: 0 }; // "behind the wall" — far terrain hit
    const result = resolveBuildAim(pieceHit, terrainAim, origin);
    expect(result).toEqual(pieceHit.point);
  });

  it('prefers the terrain hit when it is nearer than the piece hit', () => {
    const pieceHit = { piece: wall(1, 50, 1, 0, 0), point: { x: 49.8, y: 1, z: 0 }, dist: 49.8 };
    const terrainAim: Vec3 = { x: 3, y: 0, z: 0 };
    const result = resolveBuildAim(pieceHit, terrainAim, origin);
    expect(result).toEqual(terrainAim);
  });

  it('a piece hit wins outright when the terrain march missed entirely', () => {
    const pieceHit = { piece: wall(1, 2, 1, 0, 0), point: { x: 1.8, y: 1, z: 0 }, dist: 1.8 };
    const result = resolveBuildAim(pieceHit, null, origin);
    expect(result).toEqual(pieceHit.point);
  });

  it('falls back to the terrain aim when no piece was hit at all', () => {
    const terrainAim: Vec3 = { x: 3, y: 0, z: 0 };
    const result = resolveBuildAim(null, terrainAim, origin);
    expect(result).toEqual(terrainAim);
  });

  it('null when both miss', () => {
    expect(resolveBuildAim(null, null, origin)).toBeNull();
  });

  it('end-to-end: aiming levelly at a wall face lands ON the wall, not on terrain behind it', () => {
    // The exact playtest scenario: a wall sits between the player and open
    // ground; aiming levelly at its face must not sail through to the
    // terrain beyond.
    const pieces = [wall(1, 5, 1, 0, 0)]; // wall face at roughly x=4
    const dir: Vec3 = { x: 1, y: 0, z: 0 };
    const pieceHit = pieceAtRayHit(pieces, origin, dir, 100);
    const terrainAim: Vec3 = { x: 40, y: 0, z: 0 }; // "ground behind the wall", far away
    const result = resolveBuildAim(pieceHit, terrainAim, origin);
    expect(result).not.toBeNull();
    expect(result!.x).toBeLessThan(5); // anchored on the wall's face, well short of x=40
  });
});

// ---------------------------------------------------------------------------
// pieceObstacles / pieceGrapple
// ---------------------------------------------------------------------------

describe('pieceObstacles', () => {
  it('wall: 2 circles with r = t*1.5, yTop = y + wall.h', () => {
    const p = wall(1, 5, 2, -3, 0);
    const obs = pieceObstacles(p);
    expect(obs).toHaveLength(2);
    for (const o of obs) {
      expect(o.r).toBeCloseTo(BUILD.wall.t * 1.5, 9);
      expect(o.yTop).toBeCloseTo(2 + BUILD.wall.h, 9);
    }
    // Positioned symmetrically along the panel width (yaw=0 -> along X) about the centre.
    const xs = obs.map((o) => o.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(5 - BUILD.wall.w / 4, 9);
    expect(xs[1]).toBeCloseTo(5 + BUILD.wall.w / 4, 9);
    for (const o of obs) expect(o.z).toBeCloseTo(-3, 9);
  });

  it('ramp: 1 circle, r=0.9, at the piece centre, yTop = y + rise', () => {
    const p = ramp(1, 4, 1, 7, 0);
    const obs = pieceObstacles(p);
    expect(obs).toHaveLength(1);
    expect(obs[0].r).toBeCloseTo(0.9, 9);
    expect(obs[0].x).toBeCloseTo(4, 9);
    expect(obs[0].z).toBeCloseTo(7, 9);
    expect(obs[0].yTop).toBeCloseTo(1 + BUILD.ramp.rise, 9);
  });

  it('wall obstacles rotate with yaw (90deg puts the two circles along Z instead of X)', () => {
    const p = wall(1, 0, 0, 0, 90 * DEG);
    const obs = pieceObstacles(p);
    for (const o of obs) expect(Math.abs(o.x)).toBeLessThan(1e-6);
    const zs = obs.map((o) => o.z).sort((a, b) => a - b);
    expect(Math.abs(zs[1] - zs[0])).toBeCloseTo(BUILD.wall.w / 2, 6);
  });

  it('cube: 1 circle, r=1.2, at the piece centre, yTop = y + cube.h (playtest Task 8)', () => {
    const p = cube(1, 4, 1, 7, 0);
    const obs = pieceObstacles(p);
    expect(obs).toHaveLength(1);
    expect(obs[0].r).toBeCloseTo(1.2, 9);
    expect(obs[0].x).toBeCloseTo(4, 9);
    expect(obs[0].z).toBeCloseTo(7, 9);
    expect(obs[0].yTop).toBeCloseTo(1 + BUILD.cube.h, 9);
  });
});

describe('pieceGrapple', () => {
  it('wall: 2 colliders matching pieceObstacles circles, plus yBase = piece.y', () => {
    const p = wall(1, 5, 2, -3, 0);
    const obstacles = pieceObstacles(p);
    const colliders = pieceGrapple(p);
    expect(colliders).toHaveLength(obstacles.length);
    for (let i = 0; i < colliders.length; i++) {
      expect(colliders[i].x).toBeCloseTo(obstacles[i].x, 9);
      expect(colliders[i].z).toBeCloseTo(obstacles[i].z, 9);
      expect(colliders[i].r).toBeCloseTo(obstacles[i].r, 9);
      expect(colliders[i].yTop).toBeCloseTo(obstacles[i].yTop!, 9);
      expect(colliders[i].yBase).toBeCloseTo(2, 9);
    }
  });

  it('ramp: 1 collider, yBase = piece.y, yTop = y + rise', () => {
    const p = ramp(1, 4, 1, 7, 0);
    const colliders = pieceGrapple(p);
    expect(colliders).toHaveLength(1);
    expect(colliders[0].yBase).toBeCloseTo(1, 9);
    expect(colliders[0].yTop).toBeCloseTo(1 + BUILD.ramp.rise, 9);
  });
});
