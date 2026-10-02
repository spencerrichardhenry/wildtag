// World queries over a terrain, and full-body admission (spec §3 "Admission of a body").
// Admission tests the oriented hull as axis-sample spheres: ground on a square grid with a margin, then six extreme points per
// sphere against the habitat's media, then the whole hull against refuges. The actor's fit (combat-types `HullFit`) chooses the
// conservative spheres and grid (the default) or the tight ones (the swim plans; owner playtest P3, overrides spec §3's
// conservative margin for the swim envelope only).
import { PLAYER_HALF, seabedHeight, SIZES, WATER_LEVEL } from './biomes';
import type { Actor, Admission, AdmissionContext, Capsule, Constraint, EnvironmentSample, MutVec3, Orientation, Terrain, Vec3, WorldQueries } from './combat-types';
import { orientedHeave, orientedSway, rotateInto } from './orientation';
import { LAND_BAND } from './profiles';
import { stageSolids } from './reef';
import { newContact, type SolidIndex } from './solids';

/** Bounds |∇ seabedHeight|: 2.4 × (.075 + .055) + 4.5 × .018 × √2 + 13 × (.006 + .009) = .6216, rounded up. */
export const SEABED_SLOPE_BOUND = .63;
/** Bounds the spectral norm of the Hessian of seabedHeight: each term A·sin(ax)·cos(bz) (or sin·sin) has a norm of at most
 *  A(a² + b²), and 4.5 sin((x + z)c) has 2 × 4.5c². 2.4 × (.075² + .055²) + 9 × .018² + 13 × (.006² + .009²) = .0252, rounded up. */
export const SEABED_CURVATURE_BOUND = .026;

export function makeTerrain(stage: number): Terrain {
  return { groundAt: seabedHeight, surface: WATER_LEVEL, space: stage === 4, slopeBound: SEABED_SLOPE_BOUND, curvatureBound: SEABED_CURVATURE_BOUND };
}

export interface WorldExtras {
  visibility?: (from: Vec3, to: Vec3) => number;
  refugeAt?: (p: Vec3) => string | null;
  /** Must answer for the whole posed hull (exact or conservative volume test). */
  refugeOverlap?: (world: readonly Capsule[]) => { id: string; normal: Vec3 } | null;
  refugeAccess?: (actor: Actor, id: string) => boolean;
  /** Decoration solids (rocks and arches, reef.ts): admission refuses a hull that enters one ('solid'). */
  solids?: SolidIndex;
}

/** Who an admission is for (QA timing): the player's step and recovery, the ecosystem, the food guide, or anything else. */
export type AdmissionCaller = 'player' | 'ecosystem' | 'guide' | 'other';
/** QA timing of every overlapHull call made through makeWorldQueries, in total and per caller (`caller` names the current one).
 *  main.ts turns it on in QA builds, resets it when a frame starts (so calls made by event handlers between frames, such as the editor's
 *  anchor checks, are not counted; final review M8) and reads it when the frame ends. Off by default (no clock reads). */
export const admissionClock = { on: false, caller: 'other' as AdmissionCaller, ms: 0, calls: 0,
  by: { player: { ms: 0, calls: 0 }, ecosystem: { ms: 0, calls: 0 }, guide: { ms: 0, calls: 0 }, other: { ms: 0, calls: 0 } } as Record<AdmissionCaller, { ms: number; calls: number }> };
export function resetAdmissionClock(): void {
  const c = admissionClock; c.ms = 0; c.calls = 0; c.caller = 'other';
  for (const k of ['player', 'ecosystem', 'guide', 'other'] as const) { c.by[k].ms = 0; c.by[k].calls = 0; }
}
function timedAdmit(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext, t: Terrain, extras: WorldExtras): Admission {
  const t0 = performance.now(), r = admit(actor, at, o, ctx, t, extras), ms = performance.now() - t0, by = admissionClock.by[admissionClock.caller];
  admissionClock.ms += ms; admissionClock.calls++; by.ms += ms; by.calls++;
  return r;
}

/** Every overlapHull call made through makeWorldQueries, counted always (no clock): main.ts reads it around the player's step to give
 *  the rescue search only what the frame has left (fix round 4). */
export const admissionCount = { n: 0 };
export function makeWorldQueries(t: Terrain, extras: WorldExtras = {}): WorldQueries {
  return {
    terrain: t,
    sampleEnvironment: p => sampleEnvironment(p, t, extras.refugeAt),
    visibility: (from, to) => extras.visibility ? extras.visibility(from, to) : 1,
    refugeAt: p => extras.refugeAt ? extras.refugeAt(p) : null,
    refugeOverlap: world => extras.refugeOverlap ? extras.refugeOverlap(world) : null,
    refugeAccess: (actor, id) => extras.refugeAccess ? extras.refugeAccess(actor, id) : true,
    overlapHull: (actor, at, o, ctx) => (admissionCount.n++, admissionClock.on) ? timedAdmit(actor, at, o, ctx, t, extras) : admit(actor, at, o, ctx, t, extras),
    solidTop: id => extras.solids?.byId(id)?.maxY,
  };
}

/** The world queries of a stage for a world seed: its terrain and the reef solids its bodies collide with (reef.ts `stageSolids`).
 *  Every gameplay user (player, ecosystem, food access, avoidance, fixtures) builds its queries here. */
export function stageWorldQueries(stage: number, seed: number, extras: Omit<WorldExtras, 'solids'> = {}): WorldQueries {
  return makeWorldQueries(makeTerrain(stage), { ...extras, solids: stageSolids(stage, seed) });
}

/** The player's hard bound for a stage (physical units): the square of PLAYER_HALF × size and, from stage 3, the sky cap 30 × size
 *  (`maxY`, which replaced the old sky clamp). The one source for the game, avoidance, food access and the browser fixtures. */
const STAGE_BOUNDS: readonly { readonly half: number; readonly maxY?: number }[] = SIZES.map((size, stage) => Object.freeze({ half: PLAYER_HALF * size, maxY: stage >= 3 ? 30 * size : undefined }));
export const stageBounds = (stage: number): { readonly half: number; readonly maxY?: number } => STAGE_BOUNDS[stage]!;

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

/** The tight sample spheres of one capsule whose axis is `len` long sit at the axis fractions k/n, k = 0..n, with
 *  n = max(1, ceil(len / (r/2))) for r the smaller end radius (n = 0: one sphere, for a zero-length capsule), spacing s = len/n. */
export function tightSampleCount(c: Pick<Capsule, 'start' | 'end' | 'radius' | 'radii'>, len: number): number {
  if (len === 0) return 0;
  const rmin = c.radii ? Math.min(c.radii[0], c.radii[1]) : c.radius;
  return rmin > 0 ? Math.max(1, Math.ceil(len / (rmin / 2))) : 1;
}
/** The radius r' of tight sample k of n (body-space capsule). A capsule point p lies in the cross-section (a plane of constant body z)
 *  of an axis point a at most s/2 along the axis from a sample q, at |p − a| ≤ r⁺ (the larger radius at the half-steps around q; the
 *  radius is linear along a tapered capsule). |p − q|² = |p − a|² + |a − q|² + 2(p − a)·(a − q), and the last term is at most
 *  2 r⁺ (s/2) sin τ, where τ is the axis' tilt away from body z (p − a lies in the cross-section). So r' = √(r⁺² + (s/2)² + r⁺ s sin τ). */
export function tightSampleRadius(c: Pick<Capsule, 'start' | 'end' | 'radius' | 'radii'>, len: number, k: number, n: number): number {
  const [r0, r1] = c.radii ?? [c.radius, c.radius];
  if (n === 0) return Math.max(r0, r1);
  const s = len / n, tilt = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y) / len;
  const rplus = r0 + (r1 - r0) * Math.max(0, Math.min(1, (r1 > r0 ? k + .5 : k - .5) / n));
  return Math.sqrt(rplus * rplus + s * s / 4 + rplus * s * tilt);
}

/** Fills `spheres` with the oriented axis samples of the hull; returns the count. Conservative: n = max(1, ceil(ℓ / (r/2))) samples
 *  with spacing s and r' = r + s/2. Tight: tightSampleCount / tightSampleRadius (tapered capsules), one sphere per shared end point. */
function buildSpheres(hull: readonly Capsule[], o: Orientation, tight = false): number {
  let count = 0;
  for (const c of hull) {
    const bw = c.sway ?? 0, bv = c.heave ?? 0, w = orientedSway(bw, bv, o.pitch), v = orientedHeave(bw, bv, o.pitch), r = c.radius;
    rotateInto(o, c.start, sa); rotateInto(o, c.end, sb);
    const dx = sb.x - sa.x, dy = sb.y - sa.y, dz = sb.z - sa.z, len = Math.hypot(dx, dy, dz);
    if (len === 0 && !tight) { count = pushSphere(count, sa.x, sa.y, sa.z, r, w, v); continue; }
    if (tight) {
      const n = tightSampleCount(c, len);
      for (let k = 0; k <= n; k++) {
        const x = sa.x + dx * (n ? k / n : 0), y = sa.y + dy * (n ? k / n : 0), z = sa.z + dz * (n ? k / n : 0), rp = tightSampleRadius(c, len, k, n);
        // Consecutive capsules share their end points: one sphere with the larger values holds both samples.
        const j = (count - 1) * STRIDE;
        if (count > 0 && spheres[j] === x && spheres[j + 1] === y && spheres[j + 2] === z) {
          spheres[j + 3] = Math.max(spheres[j + 3]!, rp); spheres[j + 4] = Math.max(spheres[j + 4]!, w); spheres[j + 5] = Math.max(spheres[j + 5]!, v);
        } else count = pushSphere(count, x, y, z, rp, w, v);
      }
      continue;
    }
    const n = r > 0 ? Math.max(1, Math.ceil(len / (r / 2))) : 1, s = len / n, rp = r + s / 2;
    for (let k = 0; k <= n; k++) count = pushSphere(count, sa.x + dx * k / n, sa.y + dy * k / n, sa.z + dz * k / n, rp, w, v);
  }
  return count;
}

// ---- conservative ground grid ----

/** Result of one sphere's grid scan: the largest shortfall `groundAt(g) + m − (base − depth)` and its point, and the footprint bounds. */
const scan = { short: -Infinity, gx: 0, gz: 0, gy: 0, gmin: Infinity, gmax: -Infinity };

/** The tight grid has spacing r'/TIGHT_GRID. */
export const TIGHT_GRID = 6;

/** Conservative: grid of spacing h = r'/2 around (cx, cz), every point with d ≤ r' + w + h/√2; margin m = slopeBound · h/√2, and the
 *  depth at e = d − h/√2 − w (a first-order bound for the whole cell of each point). Tight: see scanGridTight. */
function scanGrid(t: Terrain, cx: number, cz: number, rp: number, w: number, base: number, tight = false, clearOk = false, prune = clearOk): void {
  if (tight && scanGridTight(t, cx, cz, rp, w, base, clearOk, prune)) return;
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

/** Tight scan (owner playtest P3). The shortfall F(q) = groundAt(q) + depth(q) − base is evaluated exactly at grid points of spacing
 *  h = r'/TIGHT_GRID strictly inside the swept footprint (e = d − w < r'). Where the hull touches the ground, F has its maximum at
 *  an interior point q* (the slope bound S keeps the touching point at e ≤ e_t = r'·S/√(1 + S²)), so ∇F(q*) = 0 and the nearest
 *  grid point g (|g − q*| ≤ h/√2) misses the maximum by at most κ·(h/√2)²/2, where κ bounds the curvature of F on that segment:
 *  the sphere's r'²/(r'² − (e_t + h/√2)²)^1.5 plus the terrain's curvature bound. That second-order margin is added to every point.
 *  The footprint bounds gmin/gmax (for the media rules) widen by S·2h: every footprint point is within 2h of a sampled point.
 *  Returns false (use the conservative scan) when the slope is too steep for the bound (e_t + h/√2 ≥ .9 r').
 *  `clearOk`: a sphere that is clear by the slope bound alone (ground(c) + S(r' + w) + m + r' ≤ base) skips the grid; its footprint
 *  bounds are then ground(c) ∓ (S(r' + w) + m). The caller allows it only where those looser bounds cannot change a media rule. */
function scanGridTight(t: Terrain, cx: number, cz: number, rp: number, w: number, base: number, clearOk: boolean, prune = clearOk): boolean {
  const h = rp / TIGHT_GRID, diag = h * Math.SQRT1_2, S = t.slopeBound, eMax = rp * S / Math.sqrt(1 + S * S) + diag;
  if (eMax >= .9 * rp) return false;
  const K = t.curvatureBound ?? 0, kappa = rp * rp / Math.pow(rp * rp - eMax * eMax, 1.5) + K, m = kappa * diag * diag / 2, reach = rp + w;
  if (clearOk) {
    const g0 = t.groundAt(cx, cz), spread = S * reach + m;
    if (g0 + spread + rp - base <= 0) { scan.short = g0 + spread + rp - base; scan.gx = cx; scan.gz = cz; scan.gy = g0; scan.gmin = g0 - spread; scan.gmax = g0 + spread; return true; }
  }
  scan.short = -Infinity; scan.gmin = Infinity; scan.gmax = -Infinity;
  T.t = t; T.cx = cx; T.cz = cz; T.h = h; T.rp = rp; T.w = w; T.base = base; T.m = m; T.prune = false;
  if (prune && t.curvatureBound !== undefined) {
    // The local model: ground(c + δ) ≤ g0 + ĝ·δ + K h (|δx| + |δz|) + K|δ|²/2, with ĝ the central differences over ±h (each equals the
    // derivative somewhere within h of c, so it is within K h of the derivative at c). Points whose bound cannot beat the best shortfall
    // so far are not sampled; rings go outward from the centre, where the depth is largest.
    const g0 = t.groundAt(cx, cz), gxp = t.groundAt(cx + h, cz), gxm = t.groundAt(cx - h, cz), gzp = t.groundAt(cx, cz + h), gzm = t.groundAt(cx, cz - h);
    T.prune = true; T.g0 = g0; T.sx = (gxp - gxm) / (2 * h); T.sz = (gzp - gzm) / (2 * h); T.K = K;
    tightPoint(0, 0, g0); tightPoint(1, 0, gxp); tightPoint(-1, 0, gxm); tightPoint(0, 1, gzp); tightPoint(0, -1, gzm);
    T.known = true;
  } else T.known = false;
  const N = Math.ceil(reach / h);
  for (let k = 0; k <= N; k++) {
    if (k === 0) { if (!T.known) tightPoint(0, 0, NaN); continue; }
    for (let i = -k; i <= k; i++) { tightPoint(i, -k, NaN); tightPoint(i, k, NaN); }
    for (let j = -k + 1; j <= k - 1; j++) { tightPoint(-k, j, NaN); tightPoint(k, j, NaN); }
  }
  scan.gmin -= S * 2 * h; scan.gmax += S * 2 * h;
  return true;
}
/** Scratch state of one tight scan (no allocation per call). */
const T = { t: null as Terrain | null, cx: 0, cz: 0, h: 0, rp: 0, w: 0, base: 0, m: 0, prune: false, known: false, g0: 0, sx: 0, sz: 0, K: 0 };
/** One grid point (i, j) of the tight scan; `known` is its ground height when already sampled (else NaN). */
function tightPoint(i: number, j: number, known: number): void {
  const d = T.h * Math.sqrt(i * i + j * j), e = Math.max(0, d - T.w);
  if (e >= T.rp) return;
  if (T.known && Number.isNaN(known) && ((i === 0 && (j === 0 || j === 1 || j === -1)) || (j === 0 && (i === 1 || i === -1)))) return;   // sampled first
  const depth = Math.sqrt(T.rp * T.rp - e * e), dx = i * T.h, dz = j * T.h;
  if (T.prune && Number.isNaN(known)) {
    const slack = T.K * T.h * (Math.abs(dx) + Math.abs(dz)) + T.K * (dx * dx + dz * dz) / 2, mid = T.g0 + T.sx * dx + T.sz * dz;
    if (mid + slack + T.m - (T.base - depth) <= scan.short) {
      // Not sampled: its ground lies within mid ± slack, which bounds the footprint instead.
      if (mid - slack < scan.gmin) scan.gmin = mid - slack;
      if (mid + slack > scan.gmax) scan.gmax = mid + slack;
      return;
    }
  }
  const gx = T.cx + dx, gz = T.cz + dz, g = Number.isNaN(known) ? T.t!.groundAt(gx, gz) : known, short = g + T.m - (T.base - depth);
  if (short > scan.short) { scan.short = short; scan.gx = gx; scan.gz = gz; scan.gy = g; }
  if (g < scan.gmin) scan.gmin = g;
  if (g > scan.gmax) scan.gmax = g;
}

// ---- admission ----

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** Scratch contact of the solid rule. */
const solidContact = newContact();
const fail = (constraint: Constraint, point: Vec3, normal: Vec3 | null): Admission => ({ ok: false, constraint, point, normal });

/** The body of overlapHull: the first failing rule, in the order bounds, ground, solids, media, refuge. */
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

  const tight = actor.fit === 'tight', count = buildSpheres(actor.hull, o, tight);

  // 3. Ground (skipped in space). Also stores each sphere's footprint bounds for the media rules.
  if (!t.space) {
    // The tight scan may skip a clear sphere when its looser footprint bounds only feed the depth rule (which a null maximum depth
    // turns off) because the whole sphere is under the surface.
    let worst = 0, wx = 0, wy = 0, wz = 0;
    const depthFree = hab.maxWaterDepthBodyLengths === null;
    for (let s = 0; s < count; s++) {
      const i = s * STRIDE, clearOk = tight && depthFree && at.y + spheres[i + 1]! + spheres[i + 3]! + spheres[i + 5]! < t.surface;
      scanGrid(t, at.x + spheres[i]!, at.z + spheres[i + 2]!, spheres[i + 3]!, spheres[i + 4]!, at.y + spheres[i + 1]! - spheres[i + 5]!, tight, clearOk);
      spheres[i + 6] = scan.gmin; spheres[i + 7] = scan.gmax;
      if (scan.short > worst) { worst = scan.short; wx = scan.gx; wy = scan.gy; wz = scan.gz; }
    }
    if (worst > 0) return fail('ground', { x: wx, y: wy, z: wz }, terrainNormal(t, wx, wz));
  }

  // 3b. Decoration solids, against every sample sphere grown by its envelope like the ground rule: sway horizontally, heave vertically
  //     (fix round 3; SolidIndex.sphereEnvelope). Skipped in space, which has none. The deepest contact gives the point (on the solid)
  //     and the normal (out of it).
  const solids = extras.solids;
  if (solids && count > 0 && solids.solids.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let s = 0; s < count; s++) {
      const i = s * STRIDE, R = spheres[i + 3]! + Math.max(spheres[i + 4]!, spheres[i + 5]!), x = at.x + spheres[i]!, y = at.y + spheres[i + 1]!, z = at.z + spheres[i + 2]!;
      minX = Math.min(minX, x - R); maxX = Math.max(maxX, x + R); minY = Math.min(minY, y - R); maxY = Math.max(maxY, y + R); minZ = Math.min(minZ, z - R); maxZ = Math.max(maxZ, z + R);
    }
    if (solids.gather(minX, maxX, minY, maxY, minZ, maxZ) > 0) {
      const c = solidContact; c.depth = 0;
      let hit = false;
      for (let s = 0; s < count; s++) {
        const i = s * STRIDE;
        if (solids.sphereEnvelope(at.x + spheres[i]!, at.y + spheres[i + 1]!, at.z + spheres[i + 2]!, spheres[i + 3]!, spheres[i + 4]!, spheres[i + 5]!, c)) hit = true;
      }
      if (hit) return { ok: false, constraint: 'solid', point: vec(c.px, c.py, c.pz), normal: vec(c.nx, c.ny, c.nz), solidId: c.id };
    }
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
  const count = buildSpheres(actor.hull, o, actor.fit === 'tight');
  let top = -Infinity, bottom = -Infinity;
  for (let s = 0; s < count; s++) {
    const i = s * STRIDE, y = spheres[i + 1]!, ext = spheres[i + 3]! + spheres[i + 5]!;
    top = Math.max(top, y + ext); bottom = Math.max(bottom, ext - y);
  }
  return { top, bottom };
}

/** Ground plans step over a rock whose top stands at most STEP_HEIGHT body lengths above the seabed under the body (owner decision,
 *  fix round 2); a taller rock and every arch stay walls. A step lifts the body by at most STEP_LIFT_MAX body lengths (the hull's own
 *  margins under the belly can need more than the rock's height). */
export const STEP_HEIGHT = .15, STEP_LIFT_MAX = .5;
const stepAt: MutVec3 = { x: 0, y: 0, z: 0 };
/** The lift over the seabed support (`base`, from supportHeight) that a ground body needs at (x, z) to stand on a low rock: 0 when no
 *  rock refuses it there, or when the refusing solid is an arch or a rock whose top is more than STEP_HEIGHT × L above the seabed under
 *  the contact point (the rock's own foot: fix round 3, so a long body on a slope classifies a rock the same at its head and its
 *  tail). The smallest lift admitted against the solids, found in STEP_TRIES steps and STEP_HALVINGS halvings: at most
 *  1 + STEP_TRIES + STEP_HALVINGS = 12 admissions a call (one when no rock is under the body). A lift refused only by another rule
 *  counts as clear: motion admits every pose anyway. */
export const STEP_TRIES = 6, STEP_HALVINGS = 5;
/** What refused a ground body at (x, z) for stepLift: 0 clear (or another rule than a solid), 1 a low rock it may step onto, 2 a wall
 *  (an arch, or a rock whose top is more than STEP_HEIGHT × L above the seabed under the contact point). */
export function stepKind(a: Admission, q: WorldQueries, x: number, z: number, L: number): 0 | 1 | 2 {
  if (a.constraint !== 'solid') return 0;
  const top = a.solidId === undefined || a.solidId.startsWith('arch') || !q.solidTop ? Infinity : q.solidTop(a.solidId) ?? Infinity;
  const foot = a.point ? q.terrain.groundAt(a.point.x, a.point.z) : q.terrain.groundAt(x, z);
  return top - foot <= STEP_HEIGHT * L ? 1 : 2;
}
export function stepLift(actor: Actor, x: number, z: number, o: Orientation, q: WorldQueries, base: number, ctx: AdmissionContext): number {
  if (q.terrain.space || !q.solidTop) return 0;
  const L = actor.bodyLength, eps = .01 * L, max = STEP_LIFT_MAX * L;
  stepAt.x = x; stepAt.z = z;
  const solidAt = (lift: number): number => {   // 1: a low rock refuses it, 2: a wall refuses it, 0: clear
    stepAt.y = base + eps + lift;
    return stepKind(q.overlapHull(actor, stepAt, o, ctx), q, x, z, L);
  };
  if (solidAt(0) !== 1) return 0;
  let lo = 0, hi = -1;
  for (let k = 1; k <= STEP_TRIES; k++) {
    const lift = max * k / STEP_TRIES, s = solidAt(lift);
    if (s === 2) return 0;
    if (s === 0) { hi = lift; break; }
    lo = lift;
  }
  if (hi < 0) return 0;
  for (let i = 0; i < STEP_HALVINGS; i++) { const mid = (lo + hi) / 2; if (solidAt(mid) === 0) hi = mid; else lo = mid; }
  return hi;
}

/** The lowest origin height at which the ground rule (step 3) passes, plus 1e-9. −Infinity in space. */
export function supportHeight(actor: Actor, x: number, z: number, o: Orientation, t: Terrain): number {
  if (t.space) return -Infinity;
  const tight = actor.fit === 'tight', count = buildSpheres(actor.hull, o, tight);
  let need = -Infinity;
  for (let s = 0; s < count; s++) {
    const i = s * STRIDE;
    scanGrid(t, x + spheres[i]!, z + spheres[i + 2]!, spheres[i + 3]!, spheres[i + 4]!, 0, tight, false, true);   // short = max(groundAt(g) + m + depth)
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
