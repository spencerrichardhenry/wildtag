// Seabed decoration solids (owner playtest P4): rock ellipsoids and arch capsules in physical units, a uniform grid over them,
// and the sphere tests that admission uses (world-queries.ts). Pure; no allocation on the query path.
import type { MutVec3 } from './combat-types';

/** An ellipsoid with semi-axes (a, b, c) along its local x, y, z, turned by `yaw` about +y (three.js rotation.y). */
export interface EllipsoidShape { kind: 'ellipsoid'; x: number; y: number; z: number; a: number; b: number; c: number; yaw: number }
/** A capsule: every point within `radius` of the segment from (x0, y0, z0) to (x1, y1, z1). */
export interface CapsuleShape { kind: 'capsule'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; radius: number }
export type SolidShape = EllipsoidShape | CapsuleShape;
/** One rock or arch: the union of its shapes. `minX…maxZ` bound every shape. */
export interface Solid { id: string; kind: 'rock' | 'arch'; shapes: readonly SolidShape[]; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/** The axis-aligned bounds of a set of shapes. */
export function solidOf(id: string, kind: Solid['kind'], shapes: readonly SolidShape[]): Solid {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of shapes) {
    if (s.kind === 'ellipsoid') {
      // A turned ellipsoid's horizontal half extent along world x is √((a cos)² + (c sin)²), and along z √((a sin)² + (c cos)²).
      const co = Math.cos(s.yaw), si = Math.sin(s.yaw), hx = Math.hypot(s.a * co, s.c * si), hz = Math.hypot(s.a * si, s.c * co);
      minX = Math.min(minX, s.x - hx); maxX = Math.max(maxX, s.x + hx); minY = Math.min(minY, s.y - s.b); maxY = Math.max(maxY, s.y + s.b); minZ = Math.min(minZ, s.z - hz); maxZ = Math.max(maxZ, s.z + hz);
    } else {
      const r = s.radius;
      minX = Math.min(minX, s.x0 - r, s.x1 - r); maxX = Math.max(maxX, s.x0 + r, s.x1 + r); minY = Math.min(minY, s.y0 - r, s.y1 - r);
      maxY = Math.max(maxY, s.y0 + r, s.y1 + r); minZ = Math.min(minZ, s.z0 - r, s.z1 - r); maxZ = Math.max(maxZ, s.z0 + r, s.z1 + r);
    }
  }
  return { id, kind, shapes, minX, maxX, minY, maxY, minZ, maxZ };
}

// ---- distances ----

/** The result of a sphere test: `depth` (> 0 when the sphere enters the shape), the closest point of the shape to the sphere centre
 *  and the unit normal out of the shape there. */
export interface SolidContact { depth: number; px: number; py: number; pz: number; nx: number; ny: number; nz: number; id: string }
export const newContact = (): SolidContact => ({ depth: -Infinity, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, id: '' });

const local: MutVec3 = { x: 0, y: 0, z: 0 };
/** Distance from the point (u, v, w) (local frame, any octant) to the ellipsoid surface with semi-axes (a, b, c), for a point outside it.
 *  The closest point x satisfies xᵢ = eᵢ² yᵢ / (t + eᵢ²) for the root t > 0 of F(t) = Σ (eᵢ yᵢ / (t + eᵢ²))² − 1. F is convex and
 *  decreasing for t > −min eᵢ², so Newton from a point left of the root converges monotonically. t₀ = max(0, e_min|y| − e_max²) is left
 *  of it (there F ≥ (e_min |y| / (t + e_max²))² − 1 ≥ 0). The closest point is left in `local`. */
function outsideDistance(a: number, b: number, c: number, u: number, v: number, w: number): number {
  const a2 = a * a, b2 = b * b, c2 = c * c, emin = Math.min(a, b, c), emax2 = Math.max(a2, b2, c2);
  let t = Math.max(0, emin * Math.hypot(u, v, w) - emax2);
  for (let i = 0; i < 64; i++) {
    const pa = a * u / (t + a2), pb = b * v / (t + b2), pc = c * w / (t + c2), F = pa * pa + pb * pb + pc * pc - 1;
    if (F <= 1e-12) break;
    const dF = -2 * (pa * pa / (t + a2) + pb * pb / (t + b2) + pc * pc / (t + c2)), step = F / -dF;
    t += step;
    if (step <= 1e-12 * (t + emax2)) break;
  }
  local.x = a2 * u / (t + a2); local.y = b2 * v / (t + b2); local.z = c2 * w / (t + c2);
  return Math.hypot(u - local.x, v - local.y, w - local.z);
}

/** Tests the sphere (x, y, z, r) against one shape. When it overlaps more deeply than `out.depth`, writes the contact to `out`. */
export function sphereShape(s: SolidShape, x: number, y: number, z: number, r: number, out: SolidContact): boolean {
  if (s.kind === 'capsule') {
    const ax = s.x0, ay = s.y0, az = s.z0, abx = s.x1 - ax, aby = s.y1 - ay, abz = s.z1 - az, len2 = abx * abx + aby * aby + abz * abz;
    const f = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / len2)) : 0;
    const qx = ax + abx * f, qy = ay + aby * f, qz = az + abz * f, dx = x - qx, dy = y - qy, dz = z - qz, d = Math.hypot(dx, dy, dz);
    const depth = r + s.radius - d;
    if (depth <= 0 || depth <= out.depth) return false;
    out.depth = depth;
    if (d > 1e-12) { out.nx = dx / d; out.ny = dy / d; out.nz = dz / d; } else { out.nx = 0; out.ny = 1; out.nz = 0; }
    out.px = qx + out.nx * s.radius; out.py = qy + out.ny * s.radius; out.pz = qz + out.nz * s.radius;
    return true;
  }
  const dx = x - s.x, dy = y - s.y, dz = z - s.z, co = Math.cos(s.yaw), si = Math.sin(s.yaw);
  const big = Math.max(s.a, s.b, s.c);
  if (dx * dx + dy * dy + dz * dz >= (big + r) * (big + r)) return false;
  // World to local: the inverse of rotation.y.
  const u = dx * co - dz * si, v = dy, w = dx * si + dz * co;
  const k2 = (u / s.a) ** 2 + (v / s.b) ** 2 + (w / s.c) ** 2;
  let depth: number, lx: number, ly: number, lz: number, gx: number, gy: number, gz: number;
  if (k2 > 1) {
    const d = outsideDistance(s.a, s.b, s.c, u, v, w);
    depth = r - d;
    if (depth <= 0 || depth <= out.depth) return false;
    lx = local.x; ly = local.y; lz = local.z; gx = u - lx; gy = v - ly; gz = w - lz;
    if (d < 1e-12) { gx = lx / (s.a * s.a); gy = ly / (s.b * s.b); gz = lz / (s.c * s.c); }
  } else {
    // Inside: the depth grows with the distance in from the surface along the ray (a lower bound of the true depth plus r).
    const k = Math.sqrt(k2);
    depth = r + (1 - k) * Math.min(s.a, s.b, s.c);
    if (depth <= out.depth) return false;
    gx = u / (s.a * s.a); gy = v / (s.b * s.b); gz = w / (s.c * s.c);
    if (k < 1e-12) { gx = 0; gy = 1; gz = 0; }
    const ks = k > 1e-12 ? 1 / k : 0; lx = u * ks; ly = k > 1e-12 ? v * ks : s.b; lz = w * ks;
  }
  const gl = Math.hypot(gx, gy, gz);
  out.depth = depth;
  // Local to world: rotation.y.
  out.nx = (gx * co + gz * si) / gl; out.ny = gy / gl; out.nz = (-gx * si + gz * co) / gl;
  out.px = s.x + lx * co + lz * si; out.py = s.y + ly; out.pz = s.z - lx * si + lz * co;
  return true;
}

/** True when the point lies inside the shape (grown by `margin`). */
export function pointInShape(s: SolidShape, x: number, y: number, z: number, margin = 0): boolean {
  const c = newContact(); c.depth = 0;
  return sphereShape(s, x, y, z, margin + 1e-12, c);
}
export const pointInSolid = (solid: Solid, x: number, y: number, z: number, margin = 0) => solid.shapes.some(s => pointInShape(s, x, y, z, margin));

// ---- grid index ----

/** A uniform grid over the solids' horizontal bounds. Cell keys are packed integers; each cell lists solid indices. */
export class SolidIndex {
  private readonly cells = new Map<number, number[]>();
  /** Per solid: the query stamp that last listed it (each solid is listed once per query). */
  private readonly stamps: Int32Array;
  private stamp = 0;
  /** Candidate solid indices of the last `gather`. */
  readonly found: Int32Array;
  count = 0;
  constructor(readonly solids: readonly Solid[], readonly cell: number) {
    this.stamps = new Int32Array(solids.length); this.found = new Int32Array(solids.length);
    solids.forEach((s, i) => {
      for (let cx = Math.floor(s.minX / cell); cx <= Math.floor(s.maxX / cell); cx++) for (let cz = Math.floor(s.minZ / cell); cz <= Math.floor(s.maxZ / cell); cz++) {
        const key = SolidIndex.key(cx, cz), list = this.cells.get(key);
        if (list) list.push(i); else this.cells.set(key, [i]);
      }
    });
  }
  private static key(cx: number, cz: number) { return (cx + 32768) * 65536 + (cz + 32768); }
  /** Lists into `found[0..count)` every solid whose bounds meet the box; returns the count. */
  gather(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): number {
    this.count = 0;
    if (this.solids.length === 0) return 0;
    if (++this.stamp === 0x7fffffff) { this.stamps.fill(0); this.stamp = 1; }
    const c = this.cell, x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c), z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const list = this.cells.get(SolidIndex.key(cx, cz));
      if (!list) continue;
      for (const i of list) {
        if (this.stamps[i] === this.stamp) continue;
        this.stamps[i] = this.stamp;
        const s = this.solids[i]!;
        if (s.maxX < minX || s.minX > maxX || s.maxY < minY || s.minY > maxY || s.maxZ < minZ || s.minZ > maxZ) continue;
        this.found[this.count++] = i;
      }
    }
    return this.count;
  }
  /** The deepest contact of the sphere with any listed solid (from the last `gather`), written to `out`; false when none. */
  sphere(x: number, y: number, z: number, r: number, out: SolidContact): boolean {
    let hit = false;
    for (let k = 0; k < this.count; k++) {
      const s = this.solids[this.found[k]!]!;
      if (x + r < s.minX || x - r > s.maxX || y + r < s.minY || y - r > s.maxY || z + r < s.minZ || z - r > s.maxZ) continue;
      for (const shape of s.shapes) if (sphereShape(shape, x, y, z, r, out)) { out.id = s.id; hit = true; }
    }
    return hit;
  }
  /** The solid containing the point (grown by `margin`), or null. */
  solidAt(x: number, y: number, z: number, margin = 0): Solid | null {
    this.gather(x - margin, x + margin, y - margin, y + margin, z - margin, z + margin);
    for (let k = 0; k < this.count; k++) { const s = this.solids[this.found[k]!]!; if (pointInSolid(s, x, y, z, margin)) return s; }
    return null;
  }
}
