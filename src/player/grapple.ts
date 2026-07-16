import { GRAPPLE } from '../core/constants.ts';
import type { MoveState, Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure grapple core — Terraria-style projectile hook (Task 16 rework). No
// `three`, no randomness: plain { x, y, z } math on injected queries so it
// stays unit-testable and the controller owns all the three.js wiring.
//
// Lifecycle (a single serializable `HookState`):
//   idle → flying → latched → (hang) → done
//
//   flying   the hook is a ballistic projectile: it integrates `hookGravity`
//            at `hookSpeed`, and `stepHook` sweeps its travel segment against
//            terrain / props / drones each step. Timeout at `hookMaxFlight`
//            with no contact → phase 'done' (a miss; zero impulse to anyone).
//   latched  contact found. `stepAttached` pulls the player toward the anchor
//            with CONSTANT ACCELERATION `zipAccel` (Terraria-style; no reel,
//            no stamina), damping perpendicular velocity so the flight curves
//            onto the anchor, speed capped at `zipMaxSpeed` while attached.
//            Momentum survives release — jump/boost mid-zip, re-fire in air.
//   hang     rope reached `hangLength`: the player is PINNED at
//            anchor − hangLength along the current radial, velocity zeroed,
//            gravity suspended by the controller (anchored to real geometry,
//            not flight). Broken by jump / dash / a re-fire (RMB).
//
// The constraint model (applied only when TAUT, dist > length):
//   1. Kill any *outward* radial velocity — the rope can't lengthen (tension,
//      only ever removes energy).
//   2. Damp the remaining (inward) radial velocity by `radialDamping`.
//   3. Add a capped inward spring accel = stiffness × overstretch (the only
//      energy-adding term, bounded by steps 1–2 into a small steady overstretch).
// When SLACK (dist ≤ length) velocity passes through untouched.
// ---------------------------------------------------------------------------

/** A grappleable vertical cylinder (tree/rock/post): trunk radius + y-band. */
export interface GrappleCollider {
  x: number;
  z: number;
  r: number;
  yBase: number;
  yTop: number;
}

/** Injected world queries for the flying-hook sweep (keeps the core pure). */
export interface HookQueries {
  /** Ground height at a world column (terrain latch when the hook drops below). */
  heightAt: (x: number, z: number) => number;
  /** Grappleable prop cylinders near a query point (trees/rocks). */
  getGrappleColliders: (x: number, z: number) => GrappleCollider[];
  /** Drone-sphere sweep of the segment a→b; returns the live anchor id on a hit. */
  raycastDrones?: (a: Vec3, b: Vec3) => { point: Vec3; anchorId: string } | null;
}

export interface HookState {
  /** 'flying' projectile, 'latched' (zipping or hanging), or 'done' (missed). */
  phase: 'flying' | 'latched' | 'done';
  /** Hook position — the projectile head while flying, the anchor once latched. */
  pos: Vec3;
  /** Hook velocity while flying (unused once latched). */
  vel: Vec3;
  /** Fixed world anchor point once latched (null while flying). */
  anchor: Vec3 | null;
  /** Drone anchor id when latched to a drone (the controller tracks it live). */
  anchorDrone: string | null;
  /** Rope length (m): the constraint-sphere radius once latched (0 while flying). */
  length: number;
  /** True once the zip has finished and the player is pinned to the anchor. */
  hang: boolean;
  /** Seconds the hook has been in flight (for the `hookMaxFlight` timeout). */
  flightTime: number;
}

/** Launch a hook from `origin` along `dir` (need not be unit) at `hookSpeed`. */
export function fireHook(origin: Vec3, dir: Vec3): HookState {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const s = GRAPPLE.hookSpeed / len;
  return {
    phase: 'flying',
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: { x: dir.x * s, y: dir.y * s, z: dir.z * s },
    anchor: null,
    anchorDrone: null,
    length: 0,
    hang: false,
    flightTime: 0,
  };
}

/** Build a latched hook directly (debug/instant-attach path — no flight). */
export function latchedHook(anchor: Vec3, playerPos: Vec3): HookState {
  const length = Math.hypot(
    anchor.x - playerPos.x,
    anchor.y - playerPos.y,
    anchor.z - playerPos.z,
  );
  return {
    phase: 'latched',
    pos: { ...anchor },
    vel: { x: 0, y: 0, z: 0 },
    anchor: { ...anchor },
    anchorDrone: null,
    length,
    hang: false,
    flightTime: 0,
  };
}

/**
 * Swept hit of the segment `prev`→`next` against a vertical cylinder. Returns
 * the parametric entry `t` in [0,1] and the world contact point (pushed to the
 * cylinder surface radius `r + 0.15` so the rope end doesn't clip inside), or
 * null when the segment never crosses the cylinder inside its y-band.
 */
function hitCylinder(prev: Vec3, next: Vec3, c: GrappleCollider): { t: number; point: Vec3 } | null {
  const R = c.r + 0.15;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dz = next.z - prev.z;
  const fx = prev.x - c.x;
  const fz = prev.z - c.z;

  // Horizontal interval [tLo, tHi] where the point lies within radius R.
  const a = dx * dx + dz * dz;
  let tLo: number;
  let tHi: number;
  if (a < 1e-12) {
    // No horizontal travel: either always inside the disk or never.
    if (fx * fx + fz * fz > R * R) return null;
    tLo = 0;
    tHi = 1;
  } else {
    const b = 2 * (fx * dx + fz * dz);
    const cc = fx * fx + fz * fz - R * R;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tLo = (-b - sq) / (2 * a);
    tHi = (-b + sq) / (2 * a);
  }
  let lo = Math.max(tLo, 0);
  let hi = Math.min(tHi, 1);
  if (lo > hi) return null;

  // Intersect with the t-interval where y is within the cylinder's band.
  if (Math.abs(dy) < 1e-12) {
    if (prev.y < c.yBase || prev.y > c.yTop) return null;
  } else {
    const tA = (c.yBase - prev.y) / dy;
    const tB = (c.yTop - prev.y) / dy;
    lo = Math.max(lo, Math.min(tA, tB));
    hi = Math.min(hi, Math.max(tA, tB));
    if (lo > hi) return null;
  }

  const t = Math.max(lo, 0);
  const px = prev.x + t * dx;
  const py = prev.y + t * dy;
  const pz = prev.z + t * dz;
  // Push the anchor just outside the trunk toward the hook so the rope end
  // reads on the surface rather than buried in the cylinder.
  let ox = px - c.x;
  let oz = pz - c.z;
  let oh = Math.hypot(ox, oz);
  if (oh < 1e-6) {
    // Dropped straight onto the axis: push back toward where the hook came from.
    ox = prev.x - c.x;
    oz = prev.z - c.z;
    oh = Math.hypot(ox, oz) || 1;
  }
  const scale = (c.r + 0.15) / oh;
  return { t, point: { x: c.x + ox * scale, y: py, z: c.z + oz * scale } };
}

/**
 * Advance a flying hook one step: integrate gravity, sweep the travel segment
 * against props → drones → terrain (earliest contact wins, so a hook zipping
 * through a tree canopy latches on the way), and time out at `hookMaxFlight`.
 * On latch, `length` is set to the fire-time player→anchor distance so the rope
 * starts just taut. Pure: `h` is never mutated. `playerPos` is only read to set
 * that initial length.
 */
export function stepHook(h: HookState, playerPos: Vec3, q: HookQueries, dt: number): HookState {
  if (h.phase !== 'flying') return h;

  const vy = h.vel.y + GRAPPLE.hookGravity * dt;
  const prev = h.pos;
  const nextPos: Vec3 = {
    x: h.pos.x + h.vel.x * dt,
    y: h.pos.y + vy * dt,
    z: h.pos.z + h.vel.z * dt,
  };
  const flightTime = h.flightTime + dt;

  const latch = (anchor: Vec3, drone: string | null): HookState => ({
    phase: 'latched',
    pos: { ...anchor },
    vel: { x: 0, y: 0, z: 0 },
    anchor: { ...anchor },
    anchorDrone: drone,
    length: Math.hypot(anchor.x - playerPos.x, anchor.y - playerPos.y, anchor.z - playerPos.z),
    hang: false,
    flightTime,
  });

  // Earliest contact along prev→nextPos wins (first collider on the path).
  let bestT = Infinity;
  let bestAnchor: Vec3 | null = null;
  let bestDrone: string | null = null;

  // (a) Props: swept vertical cylinders near the segment end.
  for (const c of q.getGrappleColliders(nextPos.x, nextPos.z)) {
    const hit = hitCylinder(prev, nextPos, c);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestAnchor = hit.point;
      bestDrone = null;
    }
  }

  // (b) Drones: sphere sweep of the same segment (live-tracked anchor id).
  if (q.raycastDrones) {
    const dhit = q.raycastDrones(prev, nextPos);
    if (dhit) {
      const segLen = Math.hypot(nextPos.x - prev.x, nextPos.y - prev.y, nextPos.z - prev.z) || 1;
      const t = Math.hypot(dhit.point.x - prev.x, dhit.point.y - prev.y, dhit.point.z - prev.z) / segLen;
      if (t < bestT) {
        bestT = t;
        bestAnchor = dhit.point;
        bestDrone = dhit.anchorId;
      }
    }
  }

  // (c) Terrain: endpoint drop below the ground (t≈1, so props/drones on the
  // path always win over the ground the hook would eventually reach).
  const groundY = q.heightAt(nextPos.x, nextPos.z);
  if (nextPos.y <= groundY && 1 < bestT) {
    bestAnchor = { x: nextPos.x, y: groundY + GRAPPLE.anchorLift, z: nextPos.z };
    bestDrone = null;
    bestT = 1;
  }

  if (bestAnchor) return latch(bestAnchor, bestDrone);

  if (flightTime >= GRAPPLE.hookMaxFlight) {
    return { ...h, pos: nextPos, vel: { x: h.vel.x, y: vy, z: h.vel.z }, phase: 'done', flightTime };
  }
  return { ...h, pos: nextPos, vel: { x: h.vel.x, y: vy, z: h.vel.z }, flightTime };
}

/** The pinned position for a hang: `hangLength` down the current radial. */
export function hangPin(anchor: Vec3, pos: Vec3): Vec3 {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const dz = pos.z - anchor.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return { x: anchor.x, y: anchor.y - GRAPPLE.hangLength, z: anchor.z };
  const s = GRAPPLE.hangLength / d;
  return { x: anchor.x + dx * s, y: anchor.y + dy * s, z: anchor.z + dz * s };
}

/**
 * Per-step hang pin with a soft approach + ground clamp. Instead of snapping
 * straight to `hangLength` (a visible teleport when the zip crosses hangLength
 * while the player is still lagging far/overstretched behind), the pin closes
 * half the remaining radial gap per step — converging in ~2 steps from any
 * realistic entry distance. When `heightAt` is supplied, the pinned y is
 * clamped to the surface + 0.1 so a terrain-anchored hang (anchor only
 * anchorLift = 0.45 above ground, hangLength = 1.2) never buries the player
 * (mirrors the zipline ride's ground clamp).
 */
function approachPin(anchor: Vec3, pos: Vec3, heightAt?: (x: number, z: number) => number): Vec3 {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const dz = pos.z - anchor.z;
  const d = Math.hypot(dx, dy, dz);
  let pin: Vec3;
  if (d < 1e-6) {
    pin = { x: anchor.x, y: anchor.y - GRAPPLE.hangLength, z: anchor.z };
  } else {
    const target = Math.max(GRAPPLE.hangLength, d * 0.5);
    const s = target / d;
    pin = { x: anchor.x + dx * s, y: anchor.y + dy * s, z: anchor.z + dz * s };
  }
  if (heightAt) pin.y = Math.max(pin.y, heightAt(pin.x, pin.z) + 0.1);
  return pin;
}

/**
 * Soft-spring rope constraint (taut only): edits velocity, never position.
 * Exported so the pendulum-physics tests can exercise a constant-length rope
 * directly (the auto-zip in `stepAttached` continuously shortens the rope, so a
 * pure fixed-length pendulum is tested here rather than through it).
 */
export function applyRopeConstraint(
  anchor: Vec3,
  length: number,
  pos: Vec3,
  v: Vec3,
  dt: number,
): Vec3 {
  const vel: Vec3 = { ...v };
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const dz = pos.z - anchor.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6 || dist <= length) return vel; // slack: fly free

  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;

  // 1. Kill outward radial (tension).
  const vRad = vel.x * ux + vel.y * uy + vel.z * uz;
  if (vRad > 0) {
    vel.x -= ux * vRad;
    vel.y -= uy * vRad;
    vel.z -= uz * vRad;
  }
  // 2. Damp remaining inward radial.
  const vRadRem = vel.x * ux + vel.y * uy + vel.z * uz;
  const damp = vRadRem * GRAPPLE.radialDamping;
  vel.x -= ux * damp;
  vel.y -= uy * damp;
  vel.z -= uz * damp;
  // 3. Capped inward spring.
  const overstretch = dist - length;
  const springAccel = Math.min(GRAPPLE.stiffness * overstretch, GRAPPLE.springAccelMax);
  const dv = springAccel * dt;
  vel.x -= ux * dv;
  vel.y -= uy * dv;
  vel.z -= uz * dv;
  return vel;
}

/**
 * Advance a latched hook one step — Terraria-style constant acceleration.
 * While attached the player accelerates toward the anchor at `zipAccel`
 * (fighting gravity, which the movement core already integrated), with the
 * perpendicular velocity component damped at `zipPerpDamp`/s so the path
 * converges on the anchor, and total speed capped at `zipMaxSpeed`. Momentum
 * is fully preserved on any release — jump or boost mid-zip and re-fire from
 * the air to chain movement. Within `hangLength` of the anchor the player
 * enters a hang. Pure — `h`/`s` are never mutated.
 */
export function stepAttached(
  h: HookState,
  s: MoveState,
  dt: number,
  heightAt?: (x: number, z: number) => number,
): { h: HookState; vel: Vec3; pin: Vec3 | null } {
  const anchor = h.anchor!;

  if (h.hang) {
    return { h, vel: { x: 0, y: 0, z: 0 }, pin: approachPin(anchor, s.pos, heightAt) };
  }

  const dx = anchor.x - s.pos.x;
  const dy = anchor.y - s.pos.y;
  const dz = anchor.z - s.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= GRAPPLE.hangLength) {
    return {
      h: { ...h, length: GRAPPLE.hangLength, hang: true },
      vel: { x: 0, y: 0, z: 0 },
      pin: approachPin(anchor, s.pos, heightAt),
    };
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;

  // Accelerate toward the anchor.
  const vel: Vec3 = {
    x: s.vel.x + ux * GRAPPLE.zipAccel * dt,
    y: s.vel.y + uy * GRAPPLE.zipAccel * dt,
    z: s.vel.z + uz * GRAPPLE.zipAccel * dt,
  };

  // Damp the perpendicular component so the flight curves onto the anchor
  // instead of orbiting it.
  const vAlong = vel.x * ux + vel.y * uy + vel.z * uz;
  const k = Math.max(0, 1 - GRAPPLE.zipPerpDamp * dt);
  vel.x = ux * vAlong + (vel.x - ux * vAlong) * k;
  vel.y = uy * vAlong + (vel.y - uy * vAlong) * k;
  vel.z = uz * vAlong + (vel.z - uz * vAlong) * k;

  // Cap total speed while attached (release keeps whatever you've built).
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed > GRAPPLE.zipMaxSpeed) {
    const c = GRAPPLE.zipMaxSpeed / speed;
    vel.x *= c;
    vel.y *= c;
    vel.z *= c;
  }

  // `length` tracks the live distance so the rope visual stays taut.
  return { h: { ...h, length: dist }, vel, pin: null };
}

/**
 * Analytic terrain ray-march (retained for `?debug=grapple` and the rope-
 * occlusion check): step out along `dir` sampling `heightAt`, and on the first
 * sample at or below the ground bisect the last segment to refine the hit.
 * Pure — `heightAt` is injected. Returns the world hit point, or null.
 */
export function raycastTerrain(
  origin: Vec3,
  dir: Vec3,
  heightAt: (x: number, z: number) => number,
  maxDist: number,
): Vec3 | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  const dz = dir.z / dl;

  const above = (t: number): number =>
    origin.y + dy * t - heightAt(origin.x + dx * t, origin.z + dz * t);

  let prevT = 0;
  for (let t: number = GRAPPLE.marchStep; t <= maxDist; t += GRAPPLE.marchStep) {
    if (above(t) <= 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < GRAPPLE.marchRefine; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) <= 0) hi = mid;
        else lo = mid;
      }
      const ht = (lo + hi) / 2;
      return { x: origin.x + dx * ht, y: origin.y + dy * ht, z: origin.z + dz * ht };
    }
    prevT = t;
  }
  return null;
}
