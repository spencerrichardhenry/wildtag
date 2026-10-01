// World queries over a terrain, and conservative full-body admission (spec §3 "Admission of a body").
// Admission tests the oriented hull as inflated axis-sample spheres: ground on a square grid with a slope margin,
// then six extreme points per sphere against the habitat's media, then the whole hull against refuges.
import { seabedHeight, WATER_LEVEL } from './biomes';
import type { Actor, Admission, AdmissionContext, Capsule, Constraint, EnvironmentSample, MutVec3, Orientation, Terrain, Vec3, WorldQueries } from './combat-types';
import { orientedHeave, orientedSway, rotateInto } from './orientation';
import { LAND_BAND } from './profiles';

/** Bounds |∇ seabedHeight|: 2.4 × (.075 + .055) + 4.5 × .018 × √2 + 13 × (.006 + .009) = .6216, rounded up. */
export const SEABED_SLOPE_BOUND = .63;

export function makeTerrain(stage: number): Terrain {
  return { groundAt: seabedHeight, surface: WATER_LEVEL, space: stage === 4, slopeBound: SEABED_SLOPE_BOUND };
}

export interface WorldExtras {
  visibility?: (from: Vec3, to: Vec3) => number;
  refugeAt?: (p: Vec3) => string | null;
  /** Must answer for the whole posed hull (exact or conservative volume test). */
  refugeOverlap?: (world: readonly Capsule[]) => { id: string; normal: Vec3 } | null;
  refugeAccess?: (actor: Actor, id: string) => boolean;
}

export function makeWorldQueries(t: Terrain, extras: WorldExtras = {}): WorldQueries {
  return {
    terrain: t,
    sampleEnvironment: p => sampleEnvironment(p, t, extras.refugeAt),
    visibility: (from, to) => extras.visibility ? extras.visibility(from, to) : 1,
    refugeAt: p => extras.refugeAt ? extras.refugeAt(p) : null,
    refugeOverlap: world => extras.refugeOverlap ? extras.refugeOverlap(world) : null,
    refugeAccess: (actor, id) => extras.refugeAccess ? extras.refugeAccess(actor, id) : true,
    overlapHull: (actor, at, o, ctx) => admit(actor, at, o, ctx, t, extras),
  };
}

// ---- terrain helpers ----

const GRAD_STEP = .5;
const gradX = (t: Terrain, x: number, z: number) => (t.groundAt(x + GRAD_STEP, z) - t.groundAt(x - GRAD_STEP, z)) / (2 * GRAD_STEP);
const gradZ = (t: Terrain, x: number, z: number) => (t.groundAt(x, z + GRAD_STEP) - t.groundAt(x, z - GRAD_STEP)) / (2 * GRAD_STEP);
const unit = (x: number, y: number, z: number): Vec3 | null => { const l = Math.hypot(x, y, z); return l > 1e-12 ? { x: x / l, y: y / l, z: z / l } : null; };
/** normalize(−∂g/∂x, 1, −∂g/∂z). */
const terrainNormal = (t: Terrain, x: number, z: number): Vec3 => unit(-gradX(t, x, z), 1, -gradZ(t, x, z))!;

// ---- sample spheres (scratch, reused across calls) ----

// Per sphere: cx, cy, cz (offset from the origin, oriented), r', sway, heave, Gmin, Gmax.
const STRIDE = 8;
let spheres = new Float64Array(STRIDE * 64);
const sa: MutVec3 = { x: 0, y: 0, z: 0 }, sb: MutVec3 = { x: 0, y: 0, z: 0 };

function pushSphere(count: number, x: number, y: number, z: number, r: number, w: number, v: number): number {
  if ((count + 1) * STRIDE > spheres.length) { const grown = new Float64Array(spheres.length * 2); grown.set(spheres); spheres = grown; }
  const i = count * STRIDE;
  spheres[i] = x; spheres[i + 1] = y; spheres[i + 2] = z; spheres[i + 3] = r; spheres[i + 4] = w; spheres[i + 5] = v; spheres[i + 6] = 0; spheres[i + 7] = 0;
  return count + 1;
}

/** Fills `spheres` with the oriented axis samples of the hull; returns the count. n = max(1, ceil(ℓ / (r/2))), r' = r + s/2. */
function buildSpheres(hull: readonly Capsule[], o: Orientation): number {
  let count = 0;
  for (const c of hull) {
    const bw = c.sway ?? 0, bv = c.heave ?? 0, w = orientedSway(bw, bv, o.pitch), v = orientedHeave(bw, bv, o.pitch), r = c.radius;
    rotateInto(o, c.start, sa); rotateInto(o, c.end, sb);
    const dx = sb.x - sa.x, dy = sb.y - sa.y, dz = sb.z - sa.z, len = Math.hypot(dx, dy, dz);
    if (len === 0) { count = pushSphere(count, sa.x, sa.y, sa.z, r, w, v); continue; }
    const n = r > 0 ? Math.max(1, Math.ceil(len / (r / 2))) : 1, s = len / n, rp = r + s / 2;
    for (let k = 0; k <= n; k++) count = pushSphere(count, sa.x + dx * k / n, sa.y + dy * k / n, sa.z + dz * k / n, rp, w, v);
  }
  return count;
}

// ---- conservative ground grid ----

/** Result of one sphere's grid scan: the largest shortfall `groundAt(g) + m − (base − depth)` and its point, and the footprint bounds. */
const scan = { short: -Infinity, gx: 0, gz: 0, gy: 0, gmin: Infinity, gmax: -Infinity };

/** Grid of spacing h = r'/2 around (cx, cz), every point with d ≤ r' + w + h/√2; margin m = slopeBound · h/√2. */
function scanGrid(t: Terrain, cx: number, cz: number, rp: number, w: number, base: number): void {
  const h = rp / 2, diag = h * Math.SQRT1_2, m = t.slopeBound * diag, reach = rp + w + diag;
  scan.short = -Infinity; scan.gmin = Infinity; scan.gmax = -Infinity;
  const N = h > 0 ? Math.floor(reach / h + 1e-9) : 0, lim = reach * (1 + 1e-12) + 1e-12;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const d = h * Math.sqrt(i * i + j * j);
    if (d > lim) continue;
    const gx = cx + i * h, gz = cz + j * h, g = t.groundAt(gx, gz);
    const e = Math.max(0, d - diag - w), depth = e < rp ? Math.sqrt(rp * rp - e * e) : 0;
    const short = g + m - (base - depth);
    if (short > scan.short) { scan.short = short; scan.gx = gx; scan.gz = gz; scan.gy = g; }
    if (g < scan.gmin) scan.gmin = g;
    if (g > scan.gmax) scan.gmax = g;
  }
  scan.gmin -= m; scan.gmax += m;
}

// ---- admission ----

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const fail = (constraint: Constraint, point: Vec3, normal: Vec3 | null): Admission => ({ ok: false, constraint, point, normal });

/** The body of overlapHull: the first failing rule, in the order bounds, ground, media, refuge. */
export function admit(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext, t: Terrain, extras: WorldExtras = {}): Admission {
  const hab = actor.habitat, L = actor.bodyLength;
  if (hab.isStaticProp) return { ok: true, constraint: null, point: null, normal: null };

  // 1. Bounds, on the oriented capsules with their own radius and envelope.
  if (ctx.bounds) {
    const { half, maxY } = ctx.bounds;
    for (const c of actor.hull) {
      const bw = c.sway ?? 0, bv = c.heave ?? 0, w = orientedSway(bw, bv, o.pitch), v = orientedHeave(bw, bv, o.pitch), r = c.radius;
      rotateInto(o, c.start, sa); rotateInto(o, c.end, sb);
      const ax = at.x + sa.x, ay = at.y + sa.y, az = at.z + sa.z, bx = at.x + sb.x, by = at.y + sb.y, bz = at.z + sb.z;
      const lowX = ax <= bx, lx = Math.min(ax, bx) - r - w, hx = Math.max(ax, bx) + r + w;
      if (lx < -half) return fail('bounds-x', { x: lx, y: lowX ? ay : by, z: lowX ? az : bz }, { x: 1, y: 0, z: 0 });
      if (hx > half) return fail('bounds-x', { x: hx, y: lowX ? by : ay, z: lowX ? bz : az }, { x: -1, y: 0, z: 0 });
      const lowZ = az <= bz, lz = Math.min(az, bz) - r - w, hz = Math.max(az, bz) + r + w;
      if (lz < -half) return fail('bounds-z', { x: lowZ ? ax : bx, y: lowZ ? ay : by, z: lz }, { x: 0, y: 0, z: 1 });
      if (hz > half) return fail('bounds-z', { x: lowZ ? bx : ax, y: lowZ ? by : ay, z: hz }, { x: 0, y: 0, z: -1 });
      if (maxY !== undefined) {
        const highA = ay >= by, hy = Math.max(ay, by) + r + v;
        if (hy > maxY) return fail('bounds-y', { x: highA ? ax : bx, y: hy, z: highA ? az : bz }, { x: 0, y: -1, z: 0 });
      }
    }
  }

  const count = buildSpheres(actor.hull, o);

  // 3. Ground (skipped in space). Also stores each sphere's footprint bounds for the media rules.
  if (!t.space) {
    let worst = 0, wx = 0, wy = 0, wz = 0;
    for (let s = 0; s < count; s++) {
      const i = s * STRIDE;
      scanGrid(t, at.x + spheres[i]!, at.z + spheres[i + 2]!, spheres[i + 3]!, spheres[i + 4]!, at.y + spheres[i + 1]! - spheres[i + 5]!);
      spheres[i + 6] = scan.gmin; spheres[i + 7] = scan.gmax;
      if (scan.short > worst) { worst = scan.short; wx = scan.gx; wy = scan.gy; wz = scan.gz; }
    }
    if (worst > 0) return fail('ground', { x: wx, y: wy, z: wz }, terrainNormal(t, wx, wz));
  }

  // 4. Body floor gap, from the lowest sample sphere.
  let gap = Infinity;
  if (!t.space) {
    let lowest = Infinity, lx = 0, lz = 0;
    for (let s = 0; s < count; s++) {
      const i = s * STRIDE, bottom = at.y + spheres[i + 1]! - spheres[i + 3]! - spheres[i + 5]!;
      if (bottom < lowest) { lowest = bottom; lx = at.x + spheres[i]!; lz = at.z + spheres[i + 2]!; }
    }
    if (count > 0) gap = lowest - t.groundAt(lx, lz);
  }

  // 5. Media at six extreme points of each sphere.
  const permit = ctx.permit, permitOn = !!permit && permit.startsAt <= ctx.time && ctx.time < permit.expiresAt;
  const has = (m: 'water' | 'air' | 'land' | 'space') => hab.media.includes(m) || (permitOn && permit!.media.includes(m));
  const water = has('water'), air = has('air'), land = has('land'), space = has('space');
  const maxDepth = hab.maxWaterDepthBodyLengths, maxGap = hab.maxFloorGapBodyLengths, band = hab.surfaceBandBodyLengths, wading = hab.wadingSupportBodyLengths;
  for (let s = 0; s < count; s++) {
    const i = s * STRIDE, cx = at.x + spheres[i]!, cy = at.y + spheres[i + 1]!, cz = at.z + spheres[i + 2]!;
    const rp = spheres[i + 3]!, w = spheres[i + 4]!, v = spheres[i + 5]!, gmin = spheres[i + 6]!, gmax = spheres[i + 7]!;
    const ry = rp + v, rh = rp + w;
    for (let k = 0; k < 6; k++) {
      const px = cx + (k === 2 ? -rh : k === 3 ? rh : 0), py = cy + (k === 0 ? -ry : k === 1 ? ry : 0), pz = cz + (k === 4 ? -rh : k === 5 ? rh : 0);
      if (t.space) { if (!space) return fail('space', vec(px, py, pz), null); continue; }
      if (py < t.surface) {
        if (!water) return fail('water', vec(px, py, pz), { x: 0, y: 1, z: 0 });
        if (maxDepth !== null && t.surface - gmin > maxDepth * L) return fail('depth', vec(px, py, pz), unit(gradX(t, px, pz), 0, gradZ(t, px, pz)));
        if (maxGap !== null && gap > maxGap * L) return fail('floor-gap', vec(px, py, pz), unit(gradX(t, px, pz), -1, gradZ(t, px, pz)));
        continue;
      }
      if (gmin < t.surface) {
        const ok = (band !== null && py - t.surface <= band * L) || (wading !== null && gap <= wading * L) || air;
        if (!ok) return fail('surface-top', vec(px, py, pz), { x: 0, y: -1, z: 0 });
      }
      if (gmax >= t.surface) {
        if (py - gmin <= LAND_BAND * L) {
          const ok = air || (land && Math.acos(Math.min(1, terrainNormal(t, px, pz).y)) <= hab.maxLandSlopeRadians);
          if (!ok) return fail('land-band', vec(px, py, pz), unit(-gradX(t, px, pz), 0, -gradZ(t, px, pz)));
        } else if (!air) return fail('air', vec(px, py, pz), unit(gradX(t, px, pz), -1, gradZ(t, px, pz)));
      }
    }
  }

  // 6. Refuge, for the whole posed hull with each radius grown by its envelope.
  if (extras.refugeOverlap) {
    const world: Capsule[] = actor.hull.map(c => {
      const bw = c.sway ?? 0, bv = c.heave ?? 0;
      rotateInto(o, c.start, sa); rotateInto(o, c.end, sb);
      return { start: { x: at.x + sa.x, y: at.y + sa.y, z: at.z + sa.z }, end: { x: at.x + sb.x, y: at.y + sb.y, z: at.z + sb.z },
        radius: c.radius + orientedSway(bw, bv, o.pitch) + orientedHeave(bw, bv, o.pitch) };
    });
    const hit = extras.refugeOverlap(world);
    if (hit && !(extras.refugeAccess ? extras.refugeAccess(actor, hit.id) : true)) return fail('refuge', { x: at.x, y: at.y, z: at.z }, hit.normal);
  }
  return { ok: true, constraint: null, point: null, normal: null };
}

/** The largest height above (top) and below (bottom) the origin of any oriented sample sphere, using r' + heave. */
export function hullExtents(actor: Actor, o: Orientation): { top: number; bottom: number } {
  const count = buildSpheres(actor.hull, o);
  let top = -Infinity, bottom = -Infinity;
  for (let s = 0; s < count; s++) {
    const i = s * STRIDE, y = spheres[i + 1]!, ext = spheres[i + 3]! + spheres[i + 5]!;
    top = Math.max(top, y + ext); bottom = Math.max(bottom, ext - y);
  }
  return { top, bottom };
}

/** The lowest origin height at which the ground rule (step 3) passes, plus 1e-9. −Infinity in space. */
export function supportHeight(actor: Actor, x: number, z: number, o: Orientation, t: Terrain): number {
  if (t.space) return -Infinity;
  const count = buildSpheres(actor.hull, o);
  let need = -Infinity;
  for (let s = 0; s < count; s++) {
    const i = s * STRIDE;
    scanGrid(t, x + spheres[i]!, z + spheres[i + 2]!, spheres[i + 3]!, spheres[i + 4]!, 0);   // short = max(groundAt(g) + m + depth)
    need = Math.max(need, scan.short + spheres[i + 5]! - spheres[i + 1]!);
  }
  return need + 1e-9;
}

// ---- environment ----

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function sampleEnvironment(p: Vec3, t: Terrain, refugeAt?: (p: Vec3) => string | null): EnvironmentSample {
  if (t.space) return { medium: 'space', groundHeight: -Infinity, surfaceHeight: null, waterDepth: 0, groundClearance: Infinity, groundNormal: UP, coverIds: [], refugeId: null };
  const ground = t.groundAt(p.x, p.z);
  return {
    medium: p.y < ground ? 'land' : p.y < t.surface ? 'water' : 'air',
    groundHeight: ground, surfaceHeight: t.surface, waterDepth: Math.max(0, t.surface - ground), groundClearance: p.y - ground,
    groundNormal: terrainNormal(t, p.x, p.z), coverIds: [], refugeId: refugeAt ? refugeAt(p) : null,
  };
}

export type ZoneLabel = 'space' | 'seabed' | 'shallow' | 'deep' | 'land' | 'air';

/** space; seabed (water, clearance ≤ 1.1L); shallow (water, depth < 2.5L); deep; land (dry ground, clearance ≤ .6L); air. */
export function zoneLabel(env: EnvironmentSample, L: number): ZoneLabel {
  if (env.medium === 'space') return 'space';
  // A point inside submerged ground counts as the seabed.
  const inWater = env.medium === 'water' || (env.medium === 'land' && env.waterDepth > 0);
  if (inWater) return env.groundClearance <= 1.1 * L ? 'seabed' : env.waterDepth < 2.5 * L ? 'shallow' : 'deep';
  if (env.waterDepth === 0 && env.groundClearance <= LAND_BAND * L) return 'land';
  return 'air';
}
