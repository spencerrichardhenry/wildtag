// Seabed decoration solids (owner playtest P4): rock ellipsoids and arch capsules in physical units, a uniform grid over them,
// and the sphere tests that admission uses (world-queries.ts). Pure; no allocation on the query path.
import type { MutVec3 } from './combat-types';

/** An ellipsoid with semi-axes (a, b, c) along its local x, y, z, turned by `yaw` about +y (three.js rotation.y). */
export interface EllipsoidShape { kind: 'ellipsoid'; x: number; y: number; z: number; a: number; b: number; c: number; yaw: number }
/** A capsule: every point within `radius` of the segment from (x0, y0, z0) to (x1, y1, z1). */
export interface CapsuleShape { kind: 'capsule'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; radius: number }
/** A closed triangle mesh placed like a three.js object: scaled by (sx, sy, sz), turned by `yaw` about +y, moved to (x, y, z). `co` and
 *  `si` are the cosine and sine of the yaw, stored once. The solid is the inside of the mesh (final review I2: the collider is the
 *  visible stone itself). */
export interface MeshShape { kind: 'mesh'; mesh: ColliderMesh; x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; co: number; si: number }
export type SolidShape = EllipsoidShape | CapsuleShape | MeshShape;
/** One rock or arch: the union of its shapes. `footprint` (when given) is the placement footprint that reef.ts keeps apart from plants
 *  and other solids; else the shapes are the footprint. `minX…maxZ` bound every shape and the footprint. */
export interface Solid { id: string; kind: 'rock' | 'arch'; shapes: readonly SolidShape[]; footprint?: readonly SolidShape[]; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

// ---- collider meshes ----

/** A closed, consistently wound triangle mesh in asset units, with a uniform grid: each cell lists the triangles whose bounds meet it. */
export interface ColliderMesh {
  /** 9 numbers per triangle (a, b, c), and per triangle its bounding sphere (centre, radius) in `sphere`. */
  readonly tri: Float64Array; readonly sphere: Float64Array; readonly count: number;
  readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number];
  readonly cell: number; readonly nx: number; readonly ny: number; readonly nz: number;
  /** Cell c lists list[start[c]..start[c + 1]). */
  readonly start: Int32Array; readonly list: Int32Array;
  /** Per triangle: the query stamp that last visited it. */
  readonly stamps: Int32Array; stamp: number;
}
/** Builds the mesh and its grid of cell size `cell` (asset units). */
export function colliderMesh(positions: readonly number[], index: readonly number[], cell: number): ColliderMesh {
  const count = index.length / 3, tri = new Float64Array(9 * count), sphere = new Float64Array(4 * count);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
    const v = positions[3 * index[3 * t + k]! + a]!; tri[9 * t + 3 * k + a] = v; min[a] = Math.min(min[a]!, v); max[a] = Math.max(max[a]!, v);
  }
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / cell)), ny = Math.max(1, Math.ceil((max[1] - min[1]) / cell)), nz = Math.max(1, Math.ceil((max[2] - min[2]) / cell));
  const cellOf = (v: number, a: 0 | 1 | 2, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v - min[a]) / cell)));
  const lists: number[][] = Array.from({ length: nx * ny * nz }, () => []);
  for (let t = 0; t < count; t++) {
    const o = 9 * t, lo = [0, 1, 2].map(a => Math.min(tri[o + a]!, tri[o + 3 + a]!, tri[o + 6 + a]!)), hi = [0, 1, 2].map(a => Math.max(tri[o + a]!, tri[o + 3 + a]!, tri[o + 6 + a]!));
    const cx = (lo[0]! + hi[0]!) / 2, cy = (lo[1]! + hi[1]!) / 2, cz = (lo[2]! + hi[2]!) / 2;
    sphere[4 * t] = cx; sphere[4 * t + 1] = cy; sphere[4 * t + 2] = cz;
    sphere[4 * t + 3] = Math.max(...[0, 1, 2].map(k => Math.hypot(tri[o + 3 * k]! - cx, tri[o + 3 * k + 1]! - cy, tri[o + 3 * k + 2]! - cz)));
    for (let i = cellOf(lo[0]!, 0, nx); i <= cellOf(hi[0]!, 0, nx); i++) for (let j = cellOf(lo[1]!, 1, ny); j <= cellOf(hi[1]!, 1, ny); j++) for (let k = cellOf(lo[2]!, 2, nz); k <= cellOf(hi[2]!, 2, nz); k++) lists[(i * ny + j) * nz + k]!.push(t);
  }
  const start = new Int32Array(lists.length + 1);
  lists.forEach((l, c) => { start[c + 1] = start[c]! + l.length; });
  const list = new Int32Array(start[lists.length]!);
  lists.forEach((l, c) => list.set(l, start[c]!));
  return { tri, sphere, count, min, max, cell, nx, ny, nz, start, list, stamps: new Int32Array(count), stamp: 0 };
}
/** A placed mesh shape. */
export function meshShape(mesh: ColliderMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): MeshShape {
  return { kind: 'mesh', mesh, x, y, z, sx, sy, sz, yaw, co: Math.cos(yaw), si: Math.sin(yaw) };
}

/** The axis-aligned bounds of a set of shapes (and of the placement footprint, when given). */
export function solidOf(id: string, kind: Solid['kind'], shapes: readonly SolidShape[], footprint?: readonly SolidShape[]): Solid {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of footprint ? [...shapes, ...footprint] : shapes) {
    if (s.kind === 'mesh') {
      // The mesh's asset bounds, scaled and turned: the world box of that box's corners.
      const m = s.mesh;
      for (const u of [m.min[0], m.max[0]]) for (const w of [m.min[2], m.max[2]]) {
        const X = s.x + u * s.sx * s.co + w * s.sz * s.si, Z = s.z - u * s.sx * s.si + w * s.sz * s.co;
        minX = Math.min(minX, X); maxX = Math.max(maxX, X); minZ = Math.min(minZ, Z); maxZ = Math.max(maxZ, Z);
      }
      minY = Math.min(minY, s.y + m.min[1] * s.sy); maxY = Math.max(maxY, s.y + m.max[1] * s.sy);
    } else if (s.kind === 'ellipsoid') {
      // A turned ellipsoid's horizontal half extent along world x is √((a cos)² + (c sin)²), and along z √((a sin)² + (c cos)²).
      const co = Math.cos(s.yaw), si = Math.sin(s.yaw), hx = Math.hypot(s.a * co, s.c * si), hz = Math.hypot(s.a * si, s.c * co);
      minX = Math.min(minX, s.x - hx); maxX = Math.max(maxX, s.x + hx); minY = Math.min(minY, s.y - s.b); maxY = Math.max(maxY, s.y + s.b); minZ = Math.min(minZ, s.z - hz); maxZ = Math.max(maxZ, s.z + hz);
    } else {
      const r = s.radius;
      minX = Math.min(minX, s.x0 - r, s.x1 - r); maxX = Math.max(maxX, s.x0 + r, s.x1 + r); minY = Math.min(minY, s.y0 - r, s.y1 - r);
      maxY = Math.max(maxY, s.y0 + r, s.y1 + r); minZ = Math.min(minZ, s.z0 - r, s.z1 - r); maxZ = Math.max(maxZ, s.z0 + r, s.z1 + r);
    }
  }
  return { id, kind, shapes, ...(footprint ? { footprint } : {}), minX, maxX, minY, maxY, minZ, maxZ };
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

// Scratch state of one mesh query (no allocation on the query path).
const M = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, best: Infinity, tri: -1 };
/** Closest point to (M.px, M.py, M.pz) on triangle t of the mesh, scaled by (sx, sy, sz); updates M.best (squared), M.q and M.tri when
 *  closer (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(m: ColliderMesh, t: number, sx: number, sy: number, sz: number): void {
  const o = 9 * t, T = m.tri;
  const ax = T[o]! * sx, ay = T[o + 1]! * sy, az = T[o + 2]! * sz, bx = T[o + 3]! * sx, by = T[o + 4]! * sy, bz = T[o + 5]! * sz, cx = T[o + 6]! * sx, cy = T[o + 7]! * sy, cz = T[o + 8]! * sz;
  const px = M.px, py = M.py, pz = M.pz, abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  let qx: number, qy: number, qz: number;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
  else if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w; }
  else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
  const d = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  if (d < M.best) { M.best = d; M.qx = qx; M.qy = qy; M.qz = qz; M.tri = t; }
}
/** Is the asset point (u, v, w) inside the closed mesh? The parity of the mesh's crossings with the ray from it along +y. The ray's
 *  (x, z) is moved by a tiny amount, so it never passes exactly through an edge or a vertex. Only the cells of its column are read. */
function insideMesh(m: ColliderMesh, u: number, v: number, w: number): boolean {
  if (u < m.min[0] || u > m.max[0] || v < m.min[1] || v > m.max[1] || w < m.min[2] || w > m.max[2]) return false;
  const x = u + 1.234567e-7 * m.cell, z = w + 2.345678e-7 * m.cell, T = m.tri;
  const i = Math.max(0, Math.min(m.nx - 1, Math.floor((x - m.min[0]) / m.cell))), k = Math.max(0, Math.min(m.nz - 1, Math.floor((z - m.min[2]) / m.cell)));
  const j0 = Math.max(0, Math.min(m.ny - 1, Math.floor((v - m.min[1]) / m.cell)));
  if (++m.stamp === 0x7fffffff) { m.stamps.fill(0); m.stamp = 1; }
  let crossings = 0;
  for (let j = j0; j < m.ny; j++) {
    const c = (i * m.ny + j) * m.nz + k;
    for (let e = m.start[c]!; e < m.start[c + 1]!; e++) {
      const t = m.list[e]!;
      if (m.stamps[t] === m.stamp) continue;
      m.stamps[t] = m.stamp;
      const o = 9 * t, ax = T[o]!, az = T[o + 2]!, bx = T[o + 3]!, bz = T[o + 5]!, cx = T[o + 6]!, cz = T[o + 8]!;
      // Barycentric coordinates of (x, z) in the triangle's projection on the xz plane.
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (det === 0) continue;
      const l1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det, l2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
      if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
      if (T[o + 1]! + (T[o + 4]! - T[o + 1]!) * l1 + (T[o + 7]! - T[o + 1]!) * l2 > v) crossings++;
    }
  }
  return crossings % 2 === 1;
}
/** sphereShape for a mesh: the exact distance to the scaled mesh in its turned frame, the sign from insideMesh. */
function sphereMesh(s: MeshShape, x: number, y: number, z: number, r: number, out: SolidContact): boolean {
  const m = s.mesh, co = s.co, si = s.si, dx = x - s.x, dy = y - s.y, dz = z - s.z;
  // World to the turned frame (the inverse of rotation.y), then to asset units.
  const u = dx * co - dz * si, v = dy, w = dx * si + dz * co, au = u / s.sx, av = v / s.sy, aw = w / s.sz;
  const ru = r / s.sx, rv = r / s.sy, rw = r / s.sz;
  if (au + ru < m.min[0] || au - ru > m.max[0] || av + rv < m.min[1] || av - rv > m.max[1] || aw + rw < m.min[2] || aw - rw > m.max[2]) return false;
  // Every triangle within r lists in a cell that meets the sphere's asset box.
  const c = m.cell, i0 = Math.max(0, Math.floor((au - ru - m.min[0]) / c)), i1 = Math.min(m.nx - 1, Math.floor((au + ru - m.min[0]) / c));
  const j0 = Math.max(0, Math.floor((av - rv - m.min[1]) / c)), j1 = Math.min(m.ny - 1, Math.floor((av + rv - m.min[1]) / c));
  const k0 = Math.max(0, Math.floor((aw - rw - m.min[2]) / c)), k1 = Math.min(m.nz - 1, Math.floor((aw + rw - m.min[2]) / c));
  if (++m.stamp === 0x7fffffff) { m.stamps.fill(0); m.stamp = 1; }
  M.px = u; M.py = v; M.pz = w; M.best = r * r; M.tri = -1;
  const S = m.sphere, sMax = Math.max(s.sx, s.sy, s.sz);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
    const cell = (i * m.ny + j) * m.nz + k;
    for (let e = m.start[cell]!; e < m.start[cell + 1]!; e++) {
      const t = m.list[e]!;
      if (m.stamps[t] === m.stamp) continue;
      m.stamps[t] = m.stamp;
      // The triangle's bounding sphere, scaled (its radius by the largest scale): skip it when it is farther than the best so far.
      const gap = Math.hypot(S[4 * t]! * s.sx - u, S[4 * t + 1]! * s.sy - v, S[4 * t + 2]! * s.sz - w) - S[4 * t + 3]! * sMax;
      if (gap > 0 && gap * gap >= M.best) continue;
      closestOnTriangle(m, t, s.sx, s.sy, s.sz);
    }
  }
  const inside = insideMesh(m, au, av, aw);
  if (M.tri < 0 && !inside) return false;
  let depth: number, nx: number, ny: number, nz: number, qx: number, qy: number, qz: number;
  if (M.tri < 0) {
    // Deep inside: no surface within r, so the depth is at least 2r. The normal points out from the mesh's centre.
    depth = 2 * r; qx = u; qy = v; qz = w;
    const cx = (m.min[0] + m.max[0]) / 2 * s.sx, cy = (m.min[1] + m.max[1]) / 2 * s.sy, cz = (m.min[2] + m.max[2]) / 2 * s.sz, l = Math.hypot(u - cx, v - cy, w - cz);
    if (l > 1e-12) { nx = (u - cx) / l; ny = (v - cy) / l; nz = (w - cz) / l; } else { nx = 0; ny = 1; nz = 0; }
  } else {
    const d = Math.sqrt(M.best);
    depth = inside ? r + d : r - d; qx = M.qx; qy = M.qy; qz = M.qz;
    if (d > 1e-9 * Math.max(1, r)) { const sign = inside ? -1 : 1; nx = sign * (u - qx) / d; ny = sign * (v - qy) / d; nz = sign * (w - qz) / d; }
    else {
      // On the surface: the triangle's outward normal (the mesh is wound outward; normals scale by the inverse scale).
      const o = 9 * M.tri, T = m.tri, e1x = T[o + 3]! - T[o]!, e1y = T[o + 4]! - T[o + 1]!, e1z = T[o + 5]! - T[o + 2]!, e2x = T[o + 6]! - T[o]!, e2y = T[o + 7]! - T[o + 1]!, e2z = T[o + 8]! - T[o + 2]!;
      const gx = (e1y * e2z - e1z * e2y) / s.sx, gy = (e1z * e2x - e1x * e2z) / s.sy, gz = (e1x * e2y - e1y * e2x) / s.sz, gl = Math.hypot(gx, gy, gz) || 1;
      nx = gx / gl; ny = gy / gl; nz = gz / gl;
    }
  }
  if (depth <= 0 || depth <= out.depth) return false;
  out.depth = depth;
  // Turned frame to world: rotation.y.
  out.nx = nx * co + nz * si; out.ny = ny; out.nz = -nx * si + nz * co;
  out.px = s.x + qx * co + qz * si; out.py = s.y + qy; out.pz = s.z - qx * si + qz * co;
  return true;
}

/** Tests the sphere (x, y, z, r) against one shape. When it overlaps more deeply than `out.depth`, writes the contact to `out`. */
export function sphereShape(s: SolidShape, x: number, y: number, z: number, r: number, out: SolidContact): boolean {
  if (s.kind === 'mesh') return sphereMesh(s, x, y, z, r, out);
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
