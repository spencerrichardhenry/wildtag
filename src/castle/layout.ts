import { CASTLE } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';

// ---------------------------------------------------------------------------
// Cursed Castle layout — PURE, deterministic geometry (no `three` import).
// The castle is a square curtain wall (CASTLE.half) with a tower at each
// corner, a central keep, and a gate cut into whichever wall faces back
// toward the origin/spawn (the site sits NW of spawn, mostly along +x, so
// the origin-facing wall here is the EAST wall — see the gateWallIndex
// computation in computeCastleLayout below; the brief's working assumption
// of a "south" gate doesn't hold for this site and the naming is adjusted
// accordingly).
//
// Everything is computed once from CASTLE and memoised: `castleLayout()`
// for the raw geometry, `castleObstacles()` / `castleGrappleColliders()` for
// the circle approximations consumed by player collision / the grapple.
// ---------------------------------------------------------------------------

export interface Point2 {
  x: number;
  z: number;
}

export interface CastleLayout {
  center: Point2;
  towers: { x: number; z: number; r: number; h: number }[]; // 4
  walls: { x1: number; z1: number; x2: number; z2: number; h: number; t: number }[]; // 4
  keep: { x: number; z: number; half: number; h: number };
  gate: { x: number; z: number; w: number };
  crystalPos: Vec3;
  perches: Vec3[]; // CASTLE.perchCount, on tower tops + keep corners
}

interface WallDef {
  a: Point2;
  b: Point2;
}

/** Pure builder: recompute the whole layout from CASTLE (memoised below). */
function computeCastleLayout(): CastleLayout {
  const center: Point2 = { x: CASTLE.center.x, z: CASTLE.center.z };
  const half = CASTLE.half;

  // Corners, named by compass direction under the project's atan2(z, x)
  // convention (+x East, +z South).
  const NE: Point2 = { x: center.x + half, z: center.z - half };
  const SE: Point2 = { x: center.x + half, z: center.z + half };
  const SW: Point2 = { x: center.x - half, z: center.z + half };
  const NW: Point2 = { x: center.x - half, z: center.z - half };

  const towers = [NE, SE, SW, NW].map((c) => ({
    x: c.x,
    z: c.z,
    r: CASTLE.towerR,
    h: CASTLE.towerH,
  }));

  // Fixed wall order: north, east, south, west.
  const wallDefs: WallDef[] = [
    { a: NW, b: NE }, // north, z = center.z - half
    { a: NE, b: SE }, // east,  x = center.x + half
    { a: SE, b: SW }, // south, z = center.z + half
    { a: SW, b: NW }, // west,  x = center.x - half
  ];
  const walls = wallDefs.map((w) => ({
    x1: w.a.x,
    z1: w.a.z,
    x2: w.b.x,
    z2: w.b.z,
    h: CASTLE.wallH,
    t: CASTLE.wallT,
  }));

  // The gate sits on whichever wall's outward face points back toward the
  // origin/spawn: the dominant axis of the vector from the castle centre to
  // the origin picks the wall (x-face vs z-face), and its sign picks east
  // vs west (or south vs north).
  const toOriginX = -center.x;
  const toOriginZ = -center.z;
  const gateWallIndex =
    Math.abs(toOriginX) >= Math.abs(toOriginZ)
      ? toOriginX > 0
        ? 1 // east
        : 3 // west
      : toOriginZ > 0
        ? 2 // south
        : 0; // north
  const gateWall = wallDefs[gateWallIndex]!; // gateWallIndex is always 0..3
  const gate = {
    x: (gateWall.a.x + gateWall.b.x) / 2,
    z: (gateWall.a.z + gateWall.b.z) / 2,
    w: CASTLE.gateW,
  };

  const keep = { x: center.x, z: center.z, half: CASTLE.keepHalf, h: CASTLE.keepH };
  const crystalPos: Vec3 = { x: center.x, y: CASTLE.padHeight + 1.2, z: center.z };

  const towerPerches: Vec3[] = towers.map((t) => ({
    x: t.x,
    y: CASTLE.padHeight + CASTLE.towerH,
    z: t.z,
  }));
  const keepPerches: Vec3[] = [
    { x: keep.x + keep.half, y: CASTLE.padHeight + CASTLE.keepH, z: keep.z + keep.half },
    { x: keep.x - keep.half, y: CASTLE.padHeight + CASTLE.keepH, z: keep.z - keep.half },
  ];
  const perches = [...towerPerches, ...keepPerches];

  return { center, towers, walls, keep, gate, crystalPos, perches };
}

let _cached: CastleLayout | null = null;

/** Memoised castle layout (computed once per session). */
export function castleLayout(): CastleLayout {
  if (!_cached) _cached = computeCastleLayout();
  return _cached;
}

/**
 * Arc-length offsets (m, from 0) of circle centres of radius `r` that fully
 * cover a straight run of length `segLen`, flush with both ends: first
 * centre at `r`, last at `segLen - r`, spacing between neighbours <= 2r so
 * adjacent circles always touch or overlap. Degenerates to a single centred
 * circle when the run is too short to fit two.
 */
function coverSegment(segLen: number, r: number): number[] {
  if (segLen <= 0) return [];
  if (segLen <= 2 * r) return [segLen / 2];
  const n = Math.ceil((segLen - 2 * r) / (2 * r)) + 1;
  if (n <= 1) return [segLen / 2];
  const step = (segLen - 2 * r) / (n - 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r + i * step);
  return out;
}

/**
 * Circle positions of radius `r` that solidly cover wall segment `w` — no
 * gap wider than 2r anywhere along it, so the wall actually blocks a
 * cylinder of radius <= r (not just a sparse sketch with incidental holes).
 * If `gate` sits on this wall (its midpoint matches the wall's midpoint),
 * the wall is covered as two flush segments flanking the real gate gap
 * (arc-length [len/2 - gateHalf, len/2 + gateHalf]) instead of one, so the
 * gate stays genuinely open however densely the flanks are packed.
 */
function wallCircles(
  w: { x1: number; z1: number; x2: number; z2: number },
  r: number,
  gate: { x: number; z: number; w: number },
): { x: number; z: number; r: number }[] {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const midx = (w.x1 + w.x2) / 2;
  const midz = (w.z1 + w.z2) / 2;
  const isGateWall = Math.hypot(midx - gate.x, midz - gate.z) < 1e-6;
  const gateHalf = gate.w / 2;

  const segments: [number, number][] = isGateWall
    ? [
        [0, len / 2 - gateHalf],
        [len / 2 + gateHalf, len],
      ]
    : [[0, len]];

  const out: { x: number; z: number; r: number }[] = [];
  for (const [a, b] of segments) {
    for (const off of coverSegment(b - a, r)) {
      const s = a + off;
      out.push({ x: w.x1 + ux * s, z: w.z1 + uz * s, r });
    }
  }
  return out;
}

let _obstacles: Obstacle[] | null = null;

/** Cache-computed collision circles: towers, keep, wall segments (gate gap left open). */
export function castleObstacles(): Obstacle[] {
  if (_obstacles) return _obstacles;
  const l = castleLayout();
  const out: Obstacle[] = [];
  for (const t of l.towers) out.push({ x: t.x, z: t.z, r: t.r });
  // Keep footprint: one circle covering the square corner-to-corner.
  out.push({ x: l.keep.x, z: l.keep.z, r: l.keep.half * Math.SQRT2 });
  for (const w of l.walls) {
    for (const c of wallCircles(w, CASTLE.wallT, l.gate)) out.push(c);
  }
  _obstacles = out;
  return out;
}

let _grapple: GrappleCollider[] | null = null;

/** Cache-computed climbable cylinders: towers, keep, wall segments (gate gap left open). */
export function castleGrappleColliders(): GrappleCollider[] {
  if (_grapple) return _grapple;
  const l = castleLayout();
  const yBase = CASTLE.padHeight;
  const out: GrappleCollider[] = [];
  for (const t of l.towers) out.push({ x: t.x, z: t.z, r: t.r, yBase, yTop: yBase + t.h });
  out.push({
    x: l.keep.x,
    z: l.keep.z,
    r: l.keep.half * Math.SQRT2,
    yBase,
    yTop: yBase + l.keep.h,
  });
  for (const w of l.walls) {
    for (const c of wallCircles(w, CASTLE.wallT * 1.5, l.gate)) {
      out.push({ x: c.x, z: c.z, r: c.r, yBase, yTop: yBase + w.h });
    }
  }
  _grapple = out;
  return out;
}

/** True when (x, z) lies within the castle's goblin-region radius. */
export function inCastleRegion(x: number, z: number): boolean {
  return Math.hypot(x - CASTLE.center.x, z - CASTLE.center.z) <= CASTLE.regionR;
}
