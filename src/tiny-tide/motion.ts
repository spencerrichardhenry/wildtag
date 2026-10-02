// Swept motion over one interval, velocity projection, recovery poses and start anchors (spec §3 "Motion", "Recovery", "Start anchors").
// Motion is a series of straight legs. Each leg has a fixed slot schedule inside [start, end]; a contact ends the leg and the
// projected remainder starts a new leg from the contact point and time. Every admission query time lies in [start, end].
import { SIZES } from './biomes';
import type { Actor, Admission, AdmissionContext, Contact, LegalityContext, MotionRequest, MotionResult, MutVec3, Orientation, RecoveryResult, Vec3, WorldQueries } from './combat-types';
import { hullExtents, supportHeight } from './world-queries';

const SLOT_CAP = 512, MAX_CONTACTS = 4, BISECTIONS = 8, TINY = 1e-9, RECOVERY_CAP = 2000;
/** The separation, in body lengths, that a slide adds along the contact normal. Bisection leaves the body within a slot / 2⁸ of the
 *  boundary, and a ground rule over many grid points has kinks there: a pure tangent step can go into a neighbouring point's shortfall. */
export const CONTACT_SKIN = 1e-3;
const NO_POSE = 'No legal pose within the search budget.';

/** The smallest capsule radius (`minR`) and the largest distance of any capsule end from the origin plus its radius and sway
 *  (`extent`), written to the scratch HM (no allocation). */
const HM = { minR: 0, extent: 0 };
function hullMetrics(actor: Actor): void {
  let minR = Infinity, extent = 0;
  for (const c of actor.hull) {
    const grow = c.radius + (c.sway ?? 0);
    minR = Math.min(minR, c.radius);
    extent = Math.max(extent, Math.hypot(c.start.x, c.start.y, c.start.z) + grow, Math.hypot(c.end.x, c.end.y, c.end.z) + grow);
  }
  HM.minR = minR; HM.extent = extent;
}

// Scratch state of resolveMotion (final review M17: the ecosystem resolves every active entity every frame). resolveMotion is not
// re-entrant: nothing it calls resolves motion.
const ACTX: AdmissionContext = { time: 0, permit: null };
const FACES: MutVec3[] = [];
const SLIDE = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, changed: false };
const TURN: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
/** Turns `o` toward `target` at `at` in steps of at most `step` radians (yaw and pitch), stopping at the last admitted orientation. The
 *  last step lands exactly on the target. */
function turnAt(q: WorldQueries, actor: Actor, at: Vec3, o: { yaw: number; pitch: number }, target: Orientation, time: number, step: number): void {
  const y0 = o.yaw, p0 = o.pitch, dy = shortestArc(y0, target.yaw), dp = target.pitch - p0;
  const m = step > 0 ? Math.ceil(Math.max(Math.abs(dy), Math.abs(dp)) / step) : 0;
  for (let k = 1; k <= m; k++) {
    TURN.yaw = k === m ? y0 + dy : y0 + dy * k / m; TURN.pitch = k === m ? target.pitch : p0 + dp * k / m;
    if (!admAt(q, actor, at, TURN, time).ok) break;
    o.yaw = TURN.yaw; o.pitch = TURN.pitch;
  }
}
/** One admission at a time, through the scratch context. */
function admAt(q: WorldQueries, actor: Actor, p: Vec3, o: Orientation, time: number): Admission { ACTX.time = time; return q.overlapHull(actor, p, o, ACTX); }

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
  const { start, end } = ctx.interval, q = ctx.queries, actx = ACTX;
  actx.time = start; actx.permit = req.traversalPermit ?? null; actx.bounds = ctx.bounds;
  const o = { yaw: req.orientation.yaw, pitch: req.orientation.pitch };

  const d = req.displacement, from = req.from;
  if (!admAt(q, actor, from, o, start).ok) return { status: 'invalid-start', position: { ...from }, orientation: o, contacts: [], unconsumed: { ...d }, time: start };

  hullMetrics(actor);
  const minR = HM.minR, extent = HM.extent;

  // Turn, at the start time; stop at the last admitted orientation.
  if (req.turn) turnAt(q, actor, from, o, req.turn, start, minR / (2 * extent));

  // Translation in legs.
  const s = minR / 2, dLen = Math.hypot(d.x, d.y, d.z);
  const P: MutVec3 = { x: from.x, y: from.y, z: from.z }, Q: MutVec3 = { x: 0, y: 0, z: 0 }, M: MutVec3 = { x: 0, y: 0, z: 0 };
  const contacts: Contact[] = [];
  let bx = from.x, by = from.y, bz = from.z, vx = d.x, vy = d.y, vz = d.z, t0 = start, time = start, travelled = 0, tests = 0;
  let remX = 0, remY = 0, remZ = 0, clamped = false;
  // After a contact, the remainder is projected onto the contact face and, when it also goes into an earlier face of this
  // move, onto the crease of the two faces. A remainder that still slides gets a small separation (the skin) away from those
  // faces. Every leg is admitted slot by slot, so the skin never installs a refused pose. A skinned leg that cannot start on the
  // same face is retried once without the skin (the plain remainder); a plain retry that cannot start and whose projection changes
  // nothing would repeat exactly, so the move stops there instead of using up the contact budget.
  const skin = CONTACT_SKIN * actor.bodyLength;
  let faceCount = 0, plainX = 0, plainY = 0, plainZ = 0, skinned = false, retried = false, skinFace: Vec3 | null = null;
  legs: while (true) {
    const vLen = Math.hypot(vx, vy, vz);
    if (vLen < TINY) { remX = vx; remY = vy; remZ = vz; break; }
    const N = Math.ceil(vLen / s), slotLen = vLen / N;
    for (let k = 1; k <= N; k++) {
      if (tests >= SLOT_CAP) { clamped = true; remX = vx * (N - k + 1) / N; remY = vy * (N - k + 1) / N; remZ = vz * (N - k + 1) / N; break legs; }
      tests++;
      const tPrev = Math.min(end, t0 + (end - t0) * (k - 1) / N), tk = Math.min(end, t0 + (end - t0) * k / N);
      Q.x = bx + vx * k / N; Q.y = by + vy * k / N; Q.z = bz + vz * k / N;
      const aq = admAt(q, actor, Q, o, tk);
      if (aq.ok) { P.x = Q.x; P.y = Q.y; P.z = Q.z; time = tk; travelled += slotLen; continue; }

      // Contact: time-only at P, or the bisected boundary between P and Q. A leg that starts at a contact (or at rest against one) is
      // first tested at the bisection's finest step, 2^-BISECTIONS of the slot: refused there, every bisection point is refused too
      // (each is at least that far), so the bisection would end at P with this refusal. That one admission replaces its eight
      // (fix round 4: a body at rest against two walls spent 4 contacts × 8 bisections a frame to stay still).
      let f = 0, failed = admAt(q, actor, P, o, tk);
      let near: Admission | null = null;
      if (failed.ok && k === 1) {
        const fine = 2 ** -BISECTIONS;
        M.x = P.x + (Q.x - P.x) * fine; M.y = P.y + (Q.y - P.y) * fine; M.z = P.z + (Q.z - P.z) * fine;
        near = admAt(q, actor, M, o, tk);
      }
      if (near && !near.ok) failed = near;
      else if (failed.ok) {
        failed = aq;
        let lo = 0, hi = 1;
        for (let i = 0; i < BISECTIONS; i++) {
          const mid = (lo + hi) / 2;
          M.x = P.x + (Q.x - P.x) * mid; M.y = P.y + (Q.y - P.y) * mid; M.z = P.z + (Q.z - P.z) * mid;
          const am = admAt(q, actor, M, o, tk);
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
      const contact: Contact = { point: { x: P.x, y: P.y, z: P.z }, normal: n, constraint: failed.constraint!, distanceFraction: dLen > 0 ? travelled / dLen : 0, time: t };
      if (failed.solidId !== undefined) contact.solidId = failed.solidId;
      contacts.push(contact);

      const stuck = k === 1 && f === 0;   // this leg did not move the body
      if (stuck && skinned && skinFace && dot3(n, skinFace) > 1 - 1e-6) {
        // The skin did not help on this face: retry the plain remainder of this leg once.
        remX = plainX; remY = plainY; remZ = plainZ;
        if (contacts.length >= MAX_CONTACTS) break legs;
        vx = plainX; vy = plainY; vz = plainZ; t0 = t; skinned = false; retried = true;
        continue legs;
      }
      const left = (N - k + 1 - f) / N;
      slideRemainder(vx * left, vy * left, vz * left, n, faceCount);
      let rx = SLIDE.x, ry = SLIDE.y, rz = SLIDE.z;
      // A ground body does not climb by sliding: the slide may not lift it above the rise the move asked for (fix round 3; it only
      // steps onto low rocks through its support, stepLift).
      // When the slide would rise more, it goes along the face's horizontal tangent instead (n × up): around the solid, level.
      if (req.riseCap !== undefined) {
        const allowed = Math.max(0, req.riseCap - (P.y - from.y));
        if (ry > allowed) {
          const tx = -n.z, tz = n.x, tl = Math.hypot(tx, tz);
          if (tl > 1e-9) { const along = (rx * tx + rz * tz) / (tl * tl); rx = tx * along; rz = tz * along; } else { rx = 0; rz = 0; }
          ry = allowed;
        }
      }
      remX = rx; remY = ry; remZ = rz;
      if (contacts.length >= MAX_CONTACTS) break legs;
      if (stuck && retried && !SLIDE.changed) break legs;   // the same leg from the same point would be refused again
      let known = false;
      for (let i = 0; i < faceCount; i++) if (dot3(FACES[i]!, n) > 1 - 1e-6) { known = true; break; }
      if (!known) { const m = FACES[faceCount] ?? (FACES[faceCount] = { x: 0, y: 0, z: 0 }); m.x = n.x; m.y = n.y; m.z = n.z; faceCount++; }
      // Only a slide gets the skin: a remainder that the projection removed stays at rest on the surface.
      plainX = rx; plainY = ry; plainZ = rz; skinned = Math.hypot(rx, ry, rz) >= TINY; retried = false; skinFace = n;
      if (skinned) { rx += SLIDE.ax * skin; ry += SLIDE.ay * skin; rz += SLIDE.az * skin; if (req.riseCap !== undefined) ry = Math.min(ry, Math.max(0, req.riseCap - (P.y - from.y)) + skin); }
      bx = P.x; by = P.y; bz = P.z; vx = rx; vy = ry; vz = rz; t0 = t;
      continue legs;
    }
    remX = 0; remY = 0; remZ = 0;
    break;
  }

  // A turn that a solid cut short at the start is tried again where the move ended (continuation: crawler freeze). A long body wedged
  // beside a rock can not turn in place, but it can once it has moved; without this it keeps its old facing as long as the wedge
  // holds it. Every step is admitted at the end time, so the result is checked as before.
  if (req.turn && (P.x !== from.x || P.y !== from.y || P.z !== from.z) && (o.yaw !== req.turn.yaw || o.pitch !== req.turn.pitch)) turnAt(q, actor, P, o, req.turn, end, minR / (2 * extent));
  const position = { x: P.x, y: P.y, z: P.z };
  const status: MotionResult['status'] = !admAt(q, actor, position, o, end).ok ? 'needs-recovery' : clamped ? 'clamped' : contacts.length > 0 ? 'blocked' : 'moved';
  return { status, position, orientation: o, contacts, unconsumed: { x: remX, y: remY, z: remZ }, time };
}

const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
/** The remainder r = (x, y, z) after a contact on face `n`, given the first `count` earlier faces of this move (FACES): r −= min(0, r · n) n;
 *  if that goes into an earlier face m, r is kept only along the crease n × m; if it still goes into a face, nothing is left. Writes
 *  SLIDE: the remainder, `a*` the unit separation direction (n, or n + m on a crease) and `changed` (whether the projection changed r). */
function slideRemainder(rx: number, ry: number, rz: number, n: Vec3, count: number): void {
  let x = rx, y = ry, z = rz, ax = n.x, ay = n.y, az = n.z, changed = false;
  const d = x * n.x + y * n.y + z * n.z;
  if (d < 0) { x -= d * n.x; y -= d * n.y; z -= d * n.z; changed = true; }
  for (let i = 0; i < count; i++) {
    const m = FACES[i]!;
    if (x * m.x + y * m.y + z * m.z >= -TINY) continue;
    const ex = n.y * m.z - n.z * m.y, ey = n.z * m.x - n.x * m.z, ez = n.x * m.y - n.y * m.x, el = Math.hypot(ex, ey, ez);
    if (el < 1e-6) continue;   // the same face again
    const along = (x * ex + y * ey + z * ez) / (el * el);
    x = ex * along; y = ey * along; z = ez * along; ax += m.x; ay += m.y; az += m.z; changed = true;
    break;
  }
  for (let i = 0; i < count; i++) { const m = FACES[i]!; if (x * m.x + y * m.y + z * m.z < -TINY) { x = 0; y = 0; z = 0; changed = true; break; } }
  const al = Math.hypot(ax, ay, az) || 1;
  SLIDE.x = x; SLIDE.y = y; SLIDE.z = z; SLIDE.ax = ax / al; SLIDE.ay = ay / al; SLIDE.az = az / al; SLIDE.changed = changed;
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
