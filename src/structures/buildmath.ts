import { BUILD } from '../core/constants.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure build math (Task 4): piece geometry, the analytic ground-extension
// query (`buildTopAt`), placement snapping (`resolveSnap`), and placement
// validity (`placementValid`), plus the piece→collision/grapple/ray adapters
// the physics + pickup systems need. No `three`, no randomness — plain
// { x, y, z } math, matching the rest of the pure simulation core.
//
// COORDINATE FRAME. A piece's footprint lives in a local (u, w) frame
// centred on (piece.x, piece.z): `u` is the piece's local WIDTH axis, `w` is
// its local DEPTH axis (wall: thickness; ramp: run/slope direction). The
// world↔local transform is the standard three.js `rotateY(yaw)` matrix
// (so a caller can set `mesh.rotation.y = piece.yaw` directly and it will
// visually match this module's geometry exactly):
//
//   world→local (inverse rotate by yaw):
//     u = dx·cos(yaw) − dz·sin(yaw)
//     w = dx·sin(yaw) + dz·cos(yaw)      where dx = x − piece.x, dz = z − piece.z
//
//   local→world (forward rotate by yaw):
//     dx = u·cos(yaw) + w·sin(yaw)
//     dz = −u·sin(yaw) + w·cos(yaw)
//
// This makes the piece's local +u world direction (cos yaw, −sin yaw) and its
// local +w world direction (sin yaw, cos yaw) — an orthonormal pair reused
// throughout this file (`uDir`/`wDir` below).
//
// WALL footprint: u ∈ [−w/2, w/2] (BUILD.wall.w), w ∈ [−t/2, t/2] (BUILD.wall.t).
// RAMP footprint: u ∈ [−w/2, w/2] (BUILD.ramp.w), w ∈ [−run/2, run/2]
// (BUILD.ramp.run); LOW end at w = −run/2 (t=0), HIGH end at w = +run/2 (t=1).
// Boundary is inclusive (<=) on all sides.
//
// Yaw is in RADIANS (see the BUILD-block doc comment in constants.ts for the
// project-wide convention); `resolveSnap`'s `camYawDeg` parameter is the one
// DEGREES-flavoured input, converted at that boundary only.
// ---------------------------------------------------------------------------

/** Every placeable piece kind. `cube` (playtest Task 8) is a flat-topped
 *  BOX like `wall` (same footprint-math shape: a rectangle in the local
 *  (u,w) frame, contributing `y + height` over it), just bigger and square —
 *  see `footprintHalfExtents`/`pieceHeight`, which key off `BUILD.cube`
 *  instead of `BUILD.wall` but otherwise share every wall codepath (top-snap,
 *  edge-snap, rampfoot-snap-target, `buildTopAt`'s flat-top branch,
 *  `placementValid`'s OBB overlap, `pieceAtRay`'s AABB). */
export type PieceKind = 'wall' | 'ramp' | 'cube';

export interface BuildPiece {
  id: number;
  kind: PieceKind;
  x: number;
  y: number;
  z: number;
  /** Yaw in RADIANS — see the coordinate-frame note above. */
  yaw: number;
}

/** Vertical extent of a piece above its own `y` (wall/cube → height, ramp →
 *  rise at its high end). Not in the original interface list, but a natural
 *  shared helper — exported since Task 5's ghost/ground code wants it too. */
export function pieceHeight(kind: PieceKind): number {
  if (kind === 'ramp') return BUILD.ramp.rise;
  if (kind === 'cube') return BUILD.cube.h;
  return BUILD.wall.h;
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Local-frame half-extents (u = width axis, w = depth/run axis) per kind. */
function footprintHalfExtents(kind: PieceKind): { halfU: number; halfW: number } {
  if (kind === 'ramp') return { halfU: BUILD.ramp.w / 2, halfW: BUILD.ramp.run / 2 };
  if (kind === 'cube') return { halfU: BUILD.cube.w / 2, halfW: BUILD.cube.d / 2 };
  return { halfU: BUILD.wall.w / 2, halfW: BUILD.wall.t / 2 };
}

// ---------------------------------------------------------------------------
// buildTopAt
// ---------------------------------------------------------------------------

/**
 * The analytic ground-extension query: the highest walkable top surface any
 * placed piece contributes at world column (x, z), or `-Infinity` when no
 * piece's footprint covers it. Walls contribute a flat `y + wall.h` over
 * their rotated w×t footprint; ramps contribute a LINEAR SLOPE
 * `y + rise * clamp(t, 0, 1)` over their rotated w×run footprint, where `t`
 * is the local along-run coordinate (0 at the low end `w = -run/2`, 1 at the
 * high end `w = +run/2`). Overlapping pieces take the MAX contributed top —
 * a linear scan over `pieces` (fine up to BUILD.maxPieces = 200; Task 5 adds
 * spatial hashing on top of this same function for larger queries).
 */
export function buildTopAt(pieces: readonly BuildPiece[], x: number, z: number): number {
  let top = -Infinity;

  for (const p of pieces) {
    const dx = x - p.x;
    const dz = z - p.z;
    const cosY = Math.cos(p.yaw);
    const sinY = Math.sin(p.yaw);
    const u = dx * cosY - dz * sinY;
    const w = dx * sinY + dz * cosY;
    const { halfU, halfW } = footprintHalfExtents(p.kind);

    if (Math.abs(u) > halfU) continue; // outside the width — never contributes

    if (p.kind === 'ramp') {
      if (w < -halfW || w > halfW) continue; // beyond the run
      const t = clamp((w + halfW) / (2 * halfW), 0, 1);
      const y = p.y + BUILD.ramp.rise * t;
      if (y > top) top = y;
    } else {
      // wall OR cube: a flat top over the whole rectangular footprint.
      if (Math.abs(w) > halfW) continue; // outside the thickness/depth
      const y = p.y + pieceHeight(p.kind);
      if (y > top) top = y;
    }
  }

  return top;
}

// ---------------------------------------------------------------------------
// resolveSnap
// ---------------------------------------------------------------------------

export interface SnapResult {
  x: number;
  y: number;
  z: number;
  yaw: number;
  snapped: 'top' | 'edge' | 'rampfoot' | null;
}

/** Distance tie-break epsilon for candidate ordering (float-safety only). */
const SNAP_TIE_EPS = 1e-9;

/**
 * Resolve where a `kind` piece would land given an `aim` point and the
 * player's camera yaw (`camYawDeg`, DEGREES — the one non-radians input in
 * this module). Scans every existing piece for up to three snap-candidate
 * anchor points and returns whichever is nearest to `aim` and within
 * `BUILD.snapR`; ties break `top` > `edge` > `rampfoot`. No candidate within
 * range → freeform: `aim` verbatim (the caller supplies `aim.y` — typically
 * `effectiveGroundAt`), with yaw snapped to the nearest `BUILD.yawStepDeg`
 * multiple of the camera yaw.
 *
 * Candidate anchors (all in the source piece `p`'s local (u, w) frame —
 * see the file-header coordinate-frame note):
 *
 * - `'top'` (any existing piece, any placed `kind`): trigger = the piece's
 *   top-face centre `(p.x, p.y + pieceHeight(p.kind), p.z)`. Candidate =
 *   that same point, `yaw = p.yaw` (flush stack, inherits x/z/yaw).
 * - `'edge'` (existing WALL or CUBE pieces only): trigger = the left/right
 *   edge midpoint at local `(u = ±halfU, w = 0)` (the source piece's OWN
 *   half-width — `wall.w/2` or `cube.w/2`), vertical midpoint `y = p.y +
 *   pieceHeight(p.kind)/2`. Candidate = one full width further out along the
 *   same side (`u = ±2·halfU`), `y = p.y`, `yaw = p.yaw` — continues the row
 *   (a cube row continues in cubes' own width; a wall row in walls').
 * - `'rampfoot'` (existing WALL or CUBE pieces only, and only when placing a
 *   RAMP): trigger = the source piece's front/back face centre at local
 *   `(u = 0, w = ±halfW)` (the source's own half-thickness/depth — `wall.t/2`
 *   or `cube.d/2`), `y = p.y` (the source's base). Candidate: the ramp's yaw
 *   is set so its own local +w axis (its high-end direction) points along
 *   the face's INWARD normal (back toward the source piece — the OPPOSITE of
 *   the face's own outward normal), and its centre sits `run/2` OUT from the
 *   face along the face's outward normal — so the ramp's HIGH end (local
 *   `w = +run/2`, displaced `-run/2` along its own +w from the centre, i.e.
 *   `+run/2` outward from the centre) lands exactly on the source's face,
 *   `y = p.y` (same base height as the source; since `ramp.rise === wall.h
 *   === cube.h` the high end is then flush with the source's top), while the
 *   LOW end (local `w = -run/2`) reaches a full `run` further out into the
 *   open — where a player actually approaches from. Getting the +w direction
 *   backwards here (pointing outward instead of inward) would put the HIGH
 *   end in the open and drive the ramp's whole footprint THROUGH the source
 *   instead of butting flush against its face — always overlapping. This is
 *   what lets a ramp→cube→ramp staircase compose: the first ramp's rampfoot
 *   targets the cube's face, and a second ramp's `'top'` candidate targets
 *   the cube's top (any placed kind qualifies for `'top'`, see above).
 */
export function resolveSnap(
  pieces: readonly BuildPiece[],
  kind: PieceKind,
  aim: Vec3,
  camYawDeg: number,
): SnapResult {
  type Snapped = 'top' | 'edge' | 'rampfoot';
  const PRIORITY: Record<Snapped, number> = { top: 0, edge: 1, rampfoot: 2 };

  let bestDist = Infinity;
  let bestPriority = Infinity;
  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;
  let bestYaw = 0;
  let bestSnapped: Snapped | null = null;

  const consider = (
    d: number,
    priority: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    snapped: Snapped,
  ): void => {
    if (d > BUILD.snapR) return;
    const better =
      d < bestDist - SNAP_TIE_EPS ||
      (Math.abs(d - bestDist) <= SNAP_TIE_EPS && priority < bestPriority);
    if (!better) return;
    bestDist = d;
    bestPriority = priority;
    bestX = x;
    bestY = y;
    bestZ = z;
    bestYaw = yaw;
    bestSnapped = snapped;
  };

  for (const p of pieces) {
    // --- top: flush stack on any existing piece ---
    const topY = p.y + pieceHeight(p.kind);
    consider(dist3(aim, { x: p.x, y: topY, z: p.z }), PRIORITY.top, p.x, topY, p.z, p.yaw, 'top');

    // edge + rampfoot both anchor off flat-topped WALL/CUBE source pieces —
    // a ramp's own sloped face isn't a sensible row-continuation or
    // rampfoot target.
    if (p.kind === 'ramp') continue;

    const cosY = Math.cos(p.yaw);
    const sinY = Math.sin(p.yaw);
    const uDirX = cosY;
    const uDirZ = -sinY;
    const wDirX = sinY;
    const wDirZ = cosY;
    const { halfU: srcHalfU, halfW: srcHalfW } = footprintHalfExtents(p.kind);

    // --- edge: continue the row left/right (in the SOURCE piece's own width) ---
    for (const side of [-1, 1] as const) {
      const edgeX = p.x + uDirX * (side * srcHalfU);
      const edgeZ = p.z + uDirZ * (side * srcHalfU);
      const edgeY = p.y + pieceHeight(p.kind) / 2;
      const d = dist3(aim, { x: edgeX, y: edgeY, z: edgeZ });
      const newX = p.x + uDirX * (side * srcHalfU * 2);
      const newZ = p.z + uDirZ * (side * srcHalfU * 2);
      consider(d, PRIORITY.edge, newX, p.y, newZ, p.yaw, 'edge');
    }

    // --- rampfoot: ramp's high end meets the source piece's base face ---
    if (kind === 'ramp') {
      for (const faceSign of [-1, 1] as const) {
        const faceX = p.x + wDirX * (faceSign * srcHalfW);
        const faceZ = p.z + wDirZ * (faceSign * srcHalfW);
        const d = dist3(aim, { x: faceX, y: p.y, z: faceZ });
        // Outward normal of this face (away from the source piece's body).
        const normalX = wDirX * faceSign;
        const normalZ = wDirZ * faceSign;
        // The ramp's own local +w (its HIGH-end direction) must point the
        // OPPOSITE way — INWARD, back toward the source piece — so the high
        // end sits flush at the face while the low end reaches outward into
        // the open (see the doc comment above for the full derivation).
        const rampYaw = Math.atan2(-normalX, -normalZ);
        const centerX = faceX + normalX * (BUILD.ramp.run / 2);
        const centerZ = faceZ + normalZ * (BUILD.ramp.run / 2);
        consider(d, PRIORITY.rampfoot, centerX, p.y, centerZ, rampYaw, 'rampfoot');
      }
    }
  }

  if (bestSnapped !== null) {
    return { x: bestX, y: bestY, z: bestZ, yaw: bestYaw, snapped: bestSnapped };
  }

  return freeformSnap(aim, camYawDeg);
}

/**
 * The freeform (unsnapped) placement rule, on its own: `aim` verbatim (the
 * caller supplies `aim.y` — typically `effectiveGroundAt`), with yaw snapped
 * to the nearest `BUILD.yawStepDeg` multiple of the camera yaw (converted
 * degrees→radians at this boundary — the one non-radians input here, mirrors
 * `resolveSnap`'s own `camYawDeg`). Extracted from `resolveSnap`'s no-
 * candidate-in-range fallback (Task 8 playtest, Ctrl-to-snap): `resolveSnap`
 * still calls this internally for that fallback, but `BuildSystem` also
 * calls it DIRECTLY — bypassing every snap candidate — while Ctrl isn't
 * held, so snapping only ever engages with the modifier down. Kept pure/
 * three-free like the rest of this module.
 */
export function freeformSnap(aim: Vec3, camYawDeg: number): SnapResult {
  const yawStepRad = (BUILD.yawStepDeg * Math.PI) / 180;
  const camYawRad = (camYawDeg * Math.PI) / 180;
  const yaw = Math.round(camYawRad / yawStepRad) * yawStepRad;
  return { x: aim.x, y: aim.y, z: aim.z, yaw, snapped: null };
}

// ---------------------------------------------------------------------------
// placementValid
// ---------------------------------------------------------------------------

/** Y-interval overlap tolerance (m): stacked pieces flush top-to-bottom (an
 *  exact touch, plus a little float slack) do NOT count as overlapping. */
const OVERLAP_Y_TOL = 0.05;
/**
 * Height-cap boundary tolerance (m) — exactly at the cap is OK.
 *
 * ROOT CAUSE (playtest Task 8, "can only stack 3 high, not 4"): this used to
 * be `1e-6`, i.e. pure-float-rounding-only slack. But `candidate.y` for a
 * FREEFORM (unsnapped) placement is never pure/exact — it's `aim.y`, and in
 * real play `aim` comes from `raycastTerrain`'s bisection-refined terrain
 * march (`player/grapple.ts`), which only converges to within roughly
 * `GRAPPLE.marchStep / 2^(GRAPPLE.marchRefine + 1)` ≈ 0.75 / 32 ≈ 0.023 m of
 * the true surface — NOT machine precision. `placementValid`'s own
 * `terrainY` argument, by contrast, is always an EXACT fresh `heightAt(x, z)`
 * sample. So the very first (freeform) piece of a stack can land with up to
 * ~0.02 m of vertical slop baked into its stored `y`; every piece stacked on
 * top of it via `resolveSnap`'s exact `'top'` candidate inherits that same
 * offset verbatim (no further drift — confirmed empirically: only the
 * freeform base introduces error, top-snap never adds any). That's normally
 * harmless slop, but once a stack's nominal height reaches EXACTLY
 * `maxStackH` (4 walls × 2 m = 8 m), a base that happened to overshoot by
 * even 0.005 m pushes the top just past the old 1e-6 boundary — an entirely
 * real, exactly-at-the-cap stack gets spuriously rejected on its last piece.
 * Reproduced deterministically (not slope-specific — the same march-
 * precision floor exists on flat ground too, it's a function of the ray's
 * vertical alignment against `marchStep`, not terrain shape) in
 * `tests/build-system.test.ts`. Widened to comfortably exceed that ~0.023 m
 * worst case with margin, while staying far too tight to let a player
 * meaningfully cheat the cap (2.5% of one wall's height).
 */
const HEIGHT_EPS = 0.05;
/** XZ separating-axis tolerance (float safety only): an exact edge-to-edge
 *  touch (e.g. two walls placed via the 'edge' snap candidate) must NOT read
 *  as overlapping, so a separating axis found within this slack still counts
 *  as separating. Deliberately much tighter than OVERLAP_Y_TOL, which forgives
 *  real placement slack rather than pure float error. */
const XZ_TOUCH_EPS = 1e-6;

/** World-space unit (u, w) axis directions for a piece's yaw (see the
 *  file-header coordinate-frame note). */
function pieceAxes(yaw: number): { uDir: { x: number; z: number }; wDir: { x: number; z: number } } {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  return { uDir: { x: cosY, z: -sinY }, wDir: { x: sinY, z: cosY } };
}

/**
 * Rotated-rectangle (OBB) overlap test in the XZ plane via the separating-
 * axis theorem over the two rects' own (u, w) axes — the standard 2D-OBB SAT
 * (4 candidate axes: `a`'s u/w and `b`'s u/w). Approximate in the sense that
 * it treats each piece as a single flat rectangle at its footprint (no
 * height/slope shape beyond the y-interval gate `placementValid` applies
 * before calling this).
 */
function obbOverlapXZ(a: BuildPiece, b: BuildPiece): boolean {
  const ea = footprintHalfExtents(a.kind);
  const eb = footprintHalfExtents(b.kind);
  const aAxes = pieceAxes(a.yaw);
  const bAxes = pieceAxes(b.yaw);
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  const axes = [aAxes.uDir, aAxes.wDir, bAxes.uDir, bAxes.wDir];
  for (const axis of axes) {
    const distCenter = Math.abs(dx * axis.x + dz * axis.z);
    const projA =
      ea.halfU * Math.abs(aAxes.uDir.x * axis.x + aAxes.uDir.z * axis.z) +
      ea.halfW * Math.abs(aAxes.wDir.x * axis.x + aAxes.wDir.z * axis.z);
    const projB =
      eb.halfU * Math.abs(bAxes.uDir.x * axis.x + bAxes.uDir.z * axis.z) +
      eb.halfW * Math.abs(bAxes.wDir.x * axis.x + bAxes.wDir.z * axis.z);
    if (distCenter > projA + projB - XZ_TOUCH_EPS) return false; // separating axis (or exact touch)
  }
  return true; // no separating axis on any of the 4 candidate axes
}

/**
 * Validity check for placing `candidate` against the already-placed
 * `pieces`, given the terrain height `terrainY` beneath it.
 *
 * - `'height'`: `candidate.y + pieceHeight(candidate.kind) - terrainY` is
 *   more than `BUILD.maxStackH` above the terrain (a small epsilon keeps the
 *   boundary — exactly at the cap — valid).
 * - `'overlap'`: APPROXIMATE — rotated-rect XZ overlap (`obbOverlapXZ`),
 *   checked ONLY when the two pieces' y-intervals `[y, y + pieceHeight]`
 *   overlap by more than `OVERLAP_Y_TOL` (0.05 m), so a piece stacked flush
 *   on top of another (touching, not interpenetrating) never reads as
 *   overlapping. Not a true 3D solid check (no ramp-slope shape considered
 *   in the y-interval, no rotation of the wall's finite height); adequate
 *   for kid-built forts, documented per the brief.
 */
export function placementValid(
  pieces: readonly BuildPiece[],
  candidate: BuildPiece,
  terrainY: number,
): { ok: boolean; reason?: 'height' | 'overlap' } {
  const h = pieceHeight(candidate.kind);
  if (candidate.y + h - terrainY > BUILD.maxStackH + HEIGHT_EPS) {
    return { ok: false, reason: 'height' };
  }

  const cY0 = candidate.y;
  const cY1 = candidate.y + h;

  for (const p of pieces) {
    const pY0 = p.y;
    const pY1 = p.y + pieceHeight(p.kind);
    const yLo = Math.max(cY0, pY0);
    const yHi = Math.min(cY1, pY1);
    if (yHi - yLo <= OVERLAP_Y_TOL) continue; // y-separated, or a flush touch — no conflict
    if (obbOverlapXZ(candidate, p)) {
      return { ok: false, reason: 'overlap' };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// pieceAtRay
// ---------------------------------------------------------------------------

interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Coarse pickup pad (m) expanding a piece's world AABB for ray picking. */
const PICKUP_AABB_PAD = 0.2;

/** World-space AABB of a piece's (possibly rotated) footprint, expanded by `pad`. */
function pieceAabb(p: BuildPiece, pad: number): Aabb {
  const { halfU, halfW } = footprintHalfExtents(p.kind);
  const cosY = Math.cos(p.yaw);
  const sinY = Math.sin(p.yaw);
  // World-space half-extent of a rotated (u,w) rect: sum of each local axis's
  // absolute projection onto the world axis (standard rotated-AABB formula).
  const extX = halfU * Math.abs(cosY) + halfW * Math.abs(sinY);
  const extZ = halfU * Math.abs(sinY) + halfW * Math.abs(cosY);
  const h = pieceHeight(p.kind);
  return {
    minX: p.x - extX - pad,
    maxX: p.x + extX + pad,
    minY: p.y - pad,
    maxY: p.y + h + pad,
    minZ: p.z - extZ - pad,
    maxZ: p.z + extZ + pad,
  };
}

/** Standard slab-method ray/AABB entry-t, or null on a miss (behind the ray counts as a miss). */
function rayAabbEntry(o: Vec3, d: Vec3, box: Aabb): number | null {
  let tMin = 0;
  let tMax = Infinity;

  const slabs: readonly (readonly [number, number, number, number])[] = [
    [o.x, d.x, box.minX, box.maxX],
    [o.y, d.y, box.minY, box.maxY],
    [o.z, d.z, box.minZ, box.maxZ],
  ];

  for (const [oo, dd, lo, hi] of slabs) {
    if (Math.abs(dd) < 1e-12) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** `pieceAtRayHit`'s result: the nearest hit piece, its ray-entry world point,
 *  and the distance along `dir` (in whatever units `dir` was — see
 *  `pieceAtRayHit`'s doc) at which it was hit. */
export interface PieceRayHit {
  piece: BuildPiece;
  point: Vec3;
  dist: number;
}

/**
 * Coarse ray-vs-piece aiming: sweeps `origin` along `dir` (need not be unit —
 * `dist` comes back in units of the NORMALIZED direction either way) up to
 * `maxDist` against each piece's world AABB (footprint rotated, then
 * expanded by 0.2 m — see `pieceAabb`), returning the nearest hit piece +
 * its entry point, or `null` on a total miss. `pieceAtRay` (below) is a thin
 * wrapper kept for pickup callers that only need the piece, not the point.
 *
 * The `point` is what Task 8's placement-ghost aim wants: when a build
 * piece's AABB is nearer than whatever the terrain march found along the
 * same ray, the ghost should anchor on the PIECE's face, not on the ground
 * behind it (the playtest "ghost lands behind the target" bug) — see
 * `BuildSystem.update`'s caller in `main.ts`, which compares this `dist`
 * against the terrain hit's distance and prefers whichever is nearer.
 */
export function pieceAtRayHit(
  pieces: readonly BuildPiece[],
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
): PieceRayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d: Vec3 = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

  let best: BuildPiece | null = null;
  let bestT = Infinity;
  for (const p of pieces) {
    const t = rayAabbEntry(origin, d, pieceAabb(p, PICKUP_AABB_PAD));
    if (t !== null && t >= 0 && t <= maxDist && t < bestT) {
      bestT = t;
      best = p;
    }
  }
  if (!best) return null;
  return {
    piece: best,
    point: { x: origin.x + d.x * bestT, y: origin.y + d.y * bestT, z: origin.z + d.z * bestT },
    dist: bestT,
  };
}

/**
 * Coarse ray-vs-piece pickup aiming: same as `pieceAtRayHit`, returning just
 * the nearest hit piece (or `null` on a total miss) — the shape existing
 * pickup callers/tests want.
 */
export function pieceAtRay(
  pieces: readonly BuildPiece[],
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
): BuildPiece | null {
  return pieceAtRayHit(pieces, origin, dir, maxDist)?.piece ?? null;
}

/**
 * Playtest Task 8 ("ghost lands behind the target"): pick whichever of a
 * piece-ray hit or a terrain-march hit is NEARER `origin`, preferring the
 * piece whenever it's closer (including when the terrain march missed
 * entirely — `terrainAim === null` — a piece hit always wins then). `null`
 * only when BOTH miss. Pure/three-free so main.ts's per-frame ghost-aim
 * comparison (the caller — see its own doc for why pieces must be tested
 * FIRST) is directly unit-testable without a camera or a real terrain field.
 */
export function resolveBuildAim(
  pieceHit: PieceRayHit | null,
  terrainAim: Vec3 | null,
  origin: Vec3,
): Vec3 | null {
  if (!pieceHit) return terrainAim;
  if (!terrainAim) return pieceHit.point;
  const terrainDist = dist3(origin, terrainAim);
  return pieceHit.dist < terrainDist ? pieceHit.point : terrainAim;
}

// ---------------------------------------------------------------------------
// pieceObstacles / pieceGrapple
// ---------------------------------------------------------------------------

interface PieceCircle {
  x: number;
  z: number;
  r: number;
  yBase: number;
  yTop: number;
}

/** Shared circle geometry for a piece — obstacles and grapple colliders are
 *  the SAME circles (obstacles just drop `yBase`), mirroring the existing
 *  castle/village pattern of one circle set feeding both consumers. */
function pieceCircles(p: BuildPiece): PieceCircle[] {
  const yBase = p.y;
  if (p.kind === 'wall') {
    const yTop = p.y + BUILD.wall.h;
    const r = BUILD.wall.t * 1.5;
    const { uDir } = pieceAxes(p.yaw);
    const off = BUILD.wall.w / 4;
    return ([-1, 1] as const).map((side) => ({
      x: p.x + uDir.x * (side * off),
      z: p.z + uDir.z * (side * off),
      r,
      yBase,
      yTop,
    }));
  }
  if (p.kind === 'cube') {
    // A single circle at the piece centre, big enough (r=1.2, vs the cube's
    // own 1 m half-width/half-depth) to cover the full 2×2 footprint.
    return [{ x: p.x, z: p.z, r: 1.2, yBase, yTop: p.y + BUILD.cube.h }];
  }
  // ramp: a single circle at the piece centre.
  return [{ x: p.x, z: p.z, r: 0.9, yBase, yTop: p.y + BUILD.ramp.rise }];
}

/**
 * Collision circles for a piece: walls get 2 overlapping circles
 * (`r = wall.t * 1.5`) spaced along the panel width so their union covers
 * the whole 2 m panel without a gap; cubes get 1 centred circle (`r = 1.2`,
 * covering the whole 2×2 footprint); ramps get 1 centred circle (`r = 0.9`).
 * `yTop` is the piece's top so a gliding/falling player can pass over it
 * (matches `Obstacle`'s finite-height convention in `player/collision.ts`).
 */
export function pieceObstacles(p: BuildPiece): Obstacle[] {
  return pieceCircles(p).map(({ x, z, r, yTop }) => ({ x, z, r, yTop }));
}

/** Grappleable colliders for a piece — the same circles as `pieceObstacles`,
 *  with `yBase = piece.y` added for the grapple core's y-band cylinder test. */
export function pieceGrapple(p: BuildPiece): GrappleCollider[] {
  return pieceCircles(p);
}
