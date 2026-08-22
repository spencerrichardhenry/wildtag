import { PATHS } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Dirt-path network (Fidelity-3). Pure math, no three imports — consumed by
// the terrain colour pipeline (chunks.ts lerps toward the path tan) and the
// scatter pass (drops placements on the corridor). See PATHS in constants.ts.
//
// The hand-authored waypoint routes are tessellated ONCE at module init into
// short segments with a sine wobble applied perpendicular to each leg (taper
// → 0 at route endpoints so they anchor exactly on their waypoints). Segments
// are indexed into a coarse spatial hash, so a `pathMask` query far from any
// path is a single empty map lookup. Everything is deterministic — no rng at
// all, the wobble phase derives from the route index.
// ---------------------------------------------------------------------------

export interface PathSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

const SEGMENTS: PathSegment[] = [];
// Cell key → indices into SEGMENTS. Keys pack the (ix, iz) cell coords; the
// world is ±~1200 m → ±75 cells at 16 m, far inside the ±2048 packing range.
const HASH = new Map<number, number[]>();
const REACH = PATHS.coreWidth + PATHS.fadeWidth; // max distance that matters

function cellKey(ix: number, iz: number): number {
  return (ix + 2048) * 8192 + (iz + 2048);
}

function insertSegment(idx: number, s: PathSegment): void {
  const minX = Math.min(s.ax, s.bx) - REACH;
  const maxX = Math.max(s.ax, s.bx) + REACH;
  const minZ = Math.min(s.az, s.bz) - REACH;
  const maxZ = Math.max(s.az, s.bz) + REACH;
  for (let ix = Math.floor(minX / PATHS.cell); ix <= Math.floor(maxX / PATHS.cell); ix++) {
    for (let iz = Math.floor(minZ / PATHS.cell); iz <= Math.floor(maxZ / PATHS.cell); iz++) {
      const key = cellKey(ix, iz);
      let list = HASH.get(key);
      if (!list) {
        list = [];
        HASH.set(key, list);
      }
      list.push(idx);
    }
  }
}

// --- tessellation (module init) ----------------------------------------------
(() => {
  for (let r = 0; r < PATHS.routes.length; r++) {
    const pts = PATHS.routes[r]!;
    // Total route length (for the endpoint wobble taper).
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    }
    const phase = r * 2.399; // fixed per-route phase (golden-angle spacing)
    let s = 0; // cumulative arc length along the straight polyline
    let prevX: number | null = null;
    let prevZ: number | null = null;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1]!;
      const [x1, z1] = pts[i]!;
      const legLen = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(legLen / PATHS.tessStep));
      const dx = (x1 - x0) / legLen;
      const dz = (z1 - z0) / legLen;
      // Perpendicular of this leg (wobble direction).
      const px = -dz;
      const pz = dx;
      for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
        const t = k / steps;
        const along = s + legLen * t;
        // Taper: 0 at both route endpoints, full amplitude mid-route.
        const taper = Math.sin(Math.min(1, Math.max(0, along / total)) * Math.PI);
        const off = Math.sin(along * PATHS.wobbleFreq + phase) * PATHS.wobbleAmp * taper;
        const wx = x0 + (x1 - x0) * t + px * off;
        const wz = z0 + (z1 - z0) * t + pz * off;
        if (prevX !== null && prevZ !== null) {
          const seg: PathSegment = { ax: prevX, az: prevZ, bx: wx, bz: wz };
          SEGMENTS.push(seg);
          insertSegment(SEGMENTS.length - 1, seg);
        }
        prevX = wx;
        prevZ = wz;
      }
      s += legLen;
    }
    prevX = prevZ = null; // safety: never bridge between routes
  }
})();

/** All tessellated path segments (tests / debug rendering). */
export function pathSegments(): readonly PathSegment[] {
  return SEGMENTS;
}

function distToSegmentSq(x: number, z: number, s: PathSegment): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const wx = x - s.ax;
  const wz = z - s.az;
  const c1 = vx * wx + vz * wz;
  if (c1 <= 0) return wx * wx + wz * wz;
  const c2 = vx * vx + vz * vz;
  const t = c1 >= c2 ? 1 : c1 / c2;
  const dx = x - (s.ax + vx * t);
  const dz = z - (s.az + vz * t);
  return dx * dx + dz * dz;
}

/**
 * Path corridor mask at world (x, z): 1 on the packed-dirt core, fading
 * linearly to 0 across the shoulder, 0 elsewhere. Pure & position-only →
 * seam-safe for the terrain colour pipeline.
 */
export function pathMask(x: number, z: number): number {
  const list = HASH.get(cellKey(Math.floor(x / PATHS.cell), Math.floor(z / PATHS.cell)));
  if (!list) return 0;
  let best = Infinity;
  for (const idx of list) {
    const d2 = distToSegmentSq(x, z, SEGMENTS[idx]!);
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  if (d <= PATHS.coreWidth) return 1;
  if (d >= PATHS.coreWidth + PATHS.fadeWidth) return 0;
  return 1 - (d - PATHS.coreWidth) / PATHS.fadeWidth;
}
