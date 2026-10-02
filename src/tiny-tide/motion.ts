// Swept motion over one interval, velocity projection, recovery poses and start anchors (spec §3 "Motion", "Recovery", "Start anchors").
// Motion is a series of straight legs. Each leg has a fixed slot schedule inside [start, end]; a contact ends the leg and the
// projected remainder starts a new leg from the contact point and time. Every admission query time lies in [start, end].
import { SIZES } from './biomes';
import type { Actor, Admission, AdmissionContext, Contact, LegalityContext, MotionRequest, MotionResult, MutVec3, Orientation, RecoveryResult, Vec3 } from './combat-types';
import { hullExtents, supportHeight } from './world-queries';

const SLOT_CAP = 512, MAX_CONTACTS = 4, BISECTIONS = 8, TINY = 1e-9, RECOVERY_CAP = 2000;
/** The separation, in body lengths, that a slide adds along the contact normal. Bisection leaves the body within a slot / 2⁸ of the
 *  boundary, and a ground rule over many grid points has kinks there: a pure tangent step can go into a neighbouring point's shortfall. */
export const CONTACT_SKIN = 1e-3;
const NO_POSE = 'No legal pose within the search budget.';

/** The smallest capsule radius, and the largest distance of any capsule end from the origin plus its radius and sway. */
function hullMetrics(actor: Actor): { minR: number; extent: number } {
  let minR = Infinity, extent = 0;
  for (const c of actor.hull) {
    const grow = c.radius + (c.sway ?? 0);
    minR = Math.min(minR, c.radius);
    extent = Math.max(extent, Math.hypot(c.start.x, c.start.y, c.start.z) + grow, Math.hypot(c.end.x, c.end.y, c.end.z) + grow);
  }
  return { minR, extent };
}

/** The signed shortest arc from a to b, in (−π, π]. */
function shortestArc(a: number, b: number): number {
  const TAU = 2 * Math.PI;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU;
  return d;
}

export function resolveMotion(req: MotionRequest, ctx: LegalityContext & { actor: Actor; interval: { start: number; end: number } }): MotionResult {
  const actor = ctx.actor;
  if (req.hull !== actor.hull) throw new Error(`resolveMotion: request hull is not the hull of actor ${actor.id}`);
  if (req.habitatProfileId !== actor.habitat.id) throw new Error(`resolveMotion: habitat ${req.habitatProfileId} is not the habitat of actor ${actor.id}`);
  const { start, end } = ctx.interval, q = ctx.queries;
  const actx: AdmissionContext = { time: start, permit: req.traversalPermit ?? null, bounds: ctx.bounds };
  let o: Orientation = req.orientation;
  const adm = (p: Vec3, at: Orientation, time: number): Admission => { actx.time = time; return q.overlapHull(actor, p, at, actx); };

  const d = req.displacement, from = req.from;
  if (!adm(from, o, start).ok) return { status: 'invalid-start', position: { ...from }, orientation: { ...o }, contacts: [], unconsumed: { ...d }, time: start };

  const { minR, extent } = hullMetrics(actor);

  // Turn, at the start time; stop at the last admitted orientation.
  if (req.turn) {
    const dy = shortestArc(o.yaw, req.turn.yaw), dp = req.turn.pitch - o.pitch, step = minR / (2 * extent);
    const m = step > 0 ? Math.ceil(Math.max(Math.abs(dy), Math.abs(dp)) / step) : 0;
    for (let k = 1; k <= m; k++) {
      // Fractions come from the step index; the last step lands exactly on the requested pitch.
      const next = { yaw: req.orientation.yaw + dy * k / m, pitch: k === m ? req.turn.pitch : req.orientation.pitch + dp * k / m };
      if (!adm(from, next, start).ok) break;
      o = next;
    }
  }

  // Translation in legs.
  const s = minR / 2, dLen = Math.hypot(d.x, d.y, d.z);
  const P: MutVec3 = { x: from.x, y: from.y, z: from.z }, Q: MutVec3 = { x: 0, y: 0, z: 0 }, M: MutVec3 = { x: 0, y: 0, z: 0 };
  const contacts: Contact[] = [];
  let bx = from.x, by = from.y, bz = from.z, vx = d.x, vy = d.y, vz = d.z, t0 = start, time = start, travelled = 0, tests = 0;
  let rem: Vec3 = { x: 0, y: 0, z: 0 }, clamped = false;
  // After a contact, the remainder is projected onto the contact face and, when it also goes into an earlier face of this
  // move, onto the crease of the two faces. A remainder that still slides gets a small separation (the skin) away from those
  // faces. Every leg is admitted slot by slot, so the skin never installs a refused pose. A skinned leg that cannot start on the
  // same face is retried once without the skin (the plain remainder); a plain retry that cannot start and whose projection changes
  // nothing would repeat exactly, so the move stops there instead of using up the contact budget.
  const skin = CONTACT_SKIN * actor.bodyLength, faces: Vec3[] = [];
  let plainX = 0, plainY = 0, plainZ = 0, skinned = false, retried = false, skinFace: Vec3 | null = null;
  legs: while (true) {
    const vLen = Math.hypot(vx, vy, vz);
    if (vLen < TINY) { rem = { x: vx, y: vy, z: vz }; break; }
    const N = Math.ceil(vLen / s), slotLen = vLen / N;
    for (let k = 1; k <= N; k++) {
      if (tests >= SLOT_CAP) { clamped = true; rem = { x: vx * (N - k + 1) / N, y: vy * (N - k + 1) / N, z: vz * (N - k + 1) / N }; break legs; }
      tests++;
      const tPrev = Math.min(end, t0 + (end - t0) * (k - 1) / N), tk = Math.min(end, t0 + (end - t0) * k / N);
      Q.x = bx + vx * k / N; Q.y = by + vy * k / N; Q.z = bz + vz * k / N;
      const aq = adm(Q, o, tk);
      if (aq.ok) { P.x = Q.x; P.y = Q.y; P.z = Q.z; time = tk; travelled += slotLen; continue; }

      // Contact: time-only at P, or the bisected boundary between P and Q.
      let f = 0, failed = adm(P, o, tk);
      if (failed.ok) {
        failed = aq;
        let lo = 0, hi = 1;
        for (let i = 0; i < BISECTIONS; i++) {
          const mid = (lo + hi) / 2;
          M.x = P.x + (Q.x - P.x) * mid; M.y = P.y + (Q.y - P.y) * mid; M.z = P.z + (Q.z - P.z) * mid;
          const am = adm(M, o, tk);
          if (am.ok) lo = mid; else { hi = mid; failed = am; }
        }
        f = lo;
        P.x += (Q.x - P.x) * f; P.y += (Q.y - P.y) * f; P.z += (Q.z - P.z) * f;
      }
      const t = tPrev + f * (tk - tPrev);
      time = t; travelled += f * slotLen;
      let n: Vec3;
      if (failed.normal) n = { x: failed.normal.x, y: failed.normal.y, z: failed.normal.z };
      else n = { x: -vx / vLen, y: -vy / vLen, z: -vz / vLen };   // −step/|step|; the step is V/N
      contacts.push({ point: { x: P.x, y: P.y, z: P.z }, normal: n, constraint: failed.constraint!, distanceFraction: dLen > 0 ? travelled / dLen : 0, time: t });

      const stuck = k === 1 && f === 0;   // this leg did not move the body
      if (stuck && skinned && skinFace && dot3(n, skinFace) > 1 - 1e-6) {
        // The skin did not help on this face: retry the plain remainder of this leg once.
        rem = { x: plainX, y: plainY, z: plainZ };
        if (contacts.length >= MAX_CONTACTS) break legs;
        vx = plainX; vy = plainY; vz = plainZ; t0 = t; skinned = false; retried = true;
        continue legs;
      }
      const left = (N - k + 1 - f) / N, slide = slideRemainder({ x: vx * left, y: vy * left, z: vz * left }, n, faces);
      let rx = slide.r.x, ry = slide.r.y, rz = slide.r.z;
      rem = { x: rx, y: ry, z: rz };
      if (contacts.length >= MAX_CONTACTS) break legs;
      if (stuck && retried && !slide.changed) break legs;   // the same leg from the same point would be refused again
      if (!faces.some(m => dot3(m, n) > 1 - 1e-6)) faces.push(n);
      // Only a slide gets the skin: a remainder that the projection removed stays at rest on the surface.
      plainX = rx; plainY = ry; plainZ = rz; skinned = Math.hypot(rx, ry, rz) >= TINY; retried = false; skinFace = n;
      if (skinned) { rx += slide.away.x * skin; ry += slide.away.y * skin; rz += slide.away.z * skin; }
      bx = P.x; by = P.y; bz = P.z; vx = rx; vy = ry; vz = rz; t0 = t;
      continue legs;
    }
    rem = { x: 0, y: 0, z: 0 };
    break;
  }

  const position = { x: P.x, y: P.y, z: P.z }, orientation = { ...o };
  const status: MotionResult['status'] = !adm(position, o, end).ok ? 'needs-recovery' : clamped ? 'clamped' : contacts.length > 0 ? 'blocked' : 'moved';
  return { status, position, orientation, contacts, unconsumed: rem, time };
}

const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
/** The remainder `r` after a contact on face `n`, given the earlier faces of this move: r −= min(0, r · n) n; if that goes into an
 *  earlier face m, r is kept only along the crease n × m; if it still goes into a face, nothing is left. `away` is the unit
 *  separation direction (n, or n + m on a crease); `changed` says whether the projection changed r. */
function slideRemainder(r: Vec3, n: Vec3, faces: readonly Vec3[]): { r: Vec3; away: Vec3; changed: boolean } {
  let x = r.x, y = r.y, z = r.z, ax = n.x, ay = n.y, az = n.z, changed = false;
  const d = x * n.x + y * n.y + z * n.z;
  if (d < 0) { x -= d * n.x; y -= d * n.y; z -= d * n.z; changed = true; }
  for (const m of faces) {
    if (x * m.x + y * m.y + z * m.z >= -TINY) continue;
    const ex = n.y * m.z - n.z * m.y, ey = n.z * m.x - n.x * m.z, ez = n.x * m.y - n.y * m.x, el = Math.hypot(ex, ey, ez);
    if (el < 1e-6) continue;   // the same face again
    const along = (x * ex + y * ey + z * ez) / (el * el);
    x = ex * along; y = ey * along; z = ez * along; ax += m.x; ay += m.y; az += m.z; changed = true;
    break;
  }
  if (faces.some(m => x * m.x + y * m.y + z * m.z < -TINY)) { x = 0; y = 0; z = 0; changed = true; }
  const al = Math.hypot(ax, ay, az) || 1;
  return { r: { x, y, z }, away: { x: ax / al, y: ay / al, z: az / al }, changed };
}

/** For each contact, v −= min(0, v · n) n. */
export function projectVelocity(v: Vec3, contacts: readonly Contact[]): Vec3 {
  let x = v.x, y = v.y, z = v.z;
  for (const c of contacts) {
    const n = c.normal, dot = x * n.x + y * n.y + z * n.z;
    if (dot < 0) { x -= dot * n.x; y -= dot * n.y; z -= dot * n.z; }
  }
  return { x, y, z };
}

export function findRecoveryPose(actor: Actor, near: Vec3, ctx: LegalityContext & { orientation: Orientation; time: number }, opts: { maxDistance: number; anchor?: Vec3 }): RecoveryResult {
  const q = ctx.queries, t = q.terrain, o = ctx.orientation, actx: AdmissionContext = { time: ctx.time, permit: null, bounds: ctx.bounds };
  const ok = (p: Vec3): RecoveryResult => ({ ok: true, position: { x: p.x, y: p.y, z: p.z }, orientation: { yaw: o.yaw, pitch: o.pitch } });
  if (q.overlapHull(actor, near, o, actx).ok) return ok(near);

  const hab = actor.habitat, L = actor.bodyLength, eps = .01 * L, max = opts.maxDistance;
  const { top, bottom } = hullExtents(actor, o);
  // Candidates in generation order: x, y, z, distance.
  const cand: { x: number; y: number; z: number; d: number }[] = [];
  const add = (x: number, y: number, z: number) => {
    const d = Math.hypot(x - near.x, y - near.y, z - near.z);
    if (d <= max) cand.push({ x, y, z, d });
  };
  const heights = (x: number, z: number) => {
    add(x, near.y, z);
    if (t.space) return;
    const G = t.groundAt(x, z);
    add(x, supportHeight(actor, x, z, o, t) + eps, z);
    if (hab.maxFloorGapBodyLengths !== null) add(x, G + hab.maxFloorGapBodyLengths * L + bottom - eps, z);
    if (hab.wadingSupportBodyLengths !== null) add(x, G + hab.wadingSupportBodyLengths * L + bottom - eps, z);
    add(x, t.surface - top - eps, z);
    add(x, t.surface + bottom + eps, z);
    if (hab.surfaceBandBodyLengths !== null) add(x, t.surface + hab.surfaceBandBodyLengths * L - top - eps, z);
  };
  heights(near.x, near.z);
  for (let k = 1; k * .5 * L <= max; k++) {
    const r = k * .5 * L;
    for (let j = 0; j < 16; j++) { const a = j * Math.PI / 8; heights(near.x + r * Math.cos(a), near.z + r * Math.sin(a)); }
  }
  cand.sort((a, b) => a.d - b.d);   // stable: equal distances keep generation order
  const P: MutVec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < cand.length && i < RECOVERY_CAP; i++) {
    const c = cand[i]!;
    P.x = c.x; P.y = c.y; P.z = c.z;
    if (q.overlapHull(actor, P, o, actx).ok) return ok(P);
  }
  if (opts.anchor && q.overlapHull(actor, opts.anchor, o, actx).ok) return ok(opts.anchor);
  return { ok: false, reason: NO_POSE };
}

/** Recovery from just above the ground at the origin (space: (0, 3 × size, 0)), level, at time 0, within 60 body lengths. */
export function startAnchor(actor: Actor, stage: number, ctx: LegalityContext): RecoveryResult {
  const o0: Orientation = { yaw: 0, pitch: 0 }, t = ctx.queries.terrain, L = actor.bodyLength;
  const near: Vec3 = t.space ? { x: 0, y: 3 * SIZES[stage]!, z: 0 } : { x: 0, y: supportHeight(actor, 0, 0, o0, t) + .01 * L, z: 0 };
  return findRecoveryPose(actor, near, { ...ctx, orientation: o0, time: 0 }, { maxDistance: 60 * L });
}
