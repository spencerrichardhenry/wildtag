import { GRAPPLE } from '../core/constants.ts';
import type { MoveState, Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure grapple rope core — the skill-expression centrepiece of movement. No
// `three` import, no randomness: plain { x, y, z } math. The controller owns
// the raycast that finds an anchor and post-processes the rope constraint onto
// the movement core's velocity AFTER `stepMovement` (the core is rope-agnostic).
//
// The rope is a *soft spring* constraint, not a hard positional projection —
// this is deliberate: it gives the rope a stretchy, weighty feel and lets us
// edit velocity only (never position), which is what the controller pipes back
// into the next `stepMovement` integration.
//
// Constraint model, applied only when the rope is TAUT (dist > length):
//   1. Decompose velocity into radial (along the rope) + tangential.
//   2. Kill any *outward* radial component — the rope cannot lengthen; this is
//      the tension impulse and only ever REMOVES energy.
//   3. Damp the remaining (inward) radial velocity by `radialDamping` so the
//      rope doesn't bounce. Also energy-removing.
//   4. Add a capped inward spring accel = stiffness × overstretch. This is the
//      ONLY term that adds energy, and only in proportion to how far the rope
//      is stretched past its length; steps 2–3 bound it into a small steady
//      overstretch rather than a growing oscillation.
// When SLACK (dist ≤ length) the velocity passes through untouched — you fly
// freely inside the rope's reach.
// ---------------------------------------------------------------------------

export interface GrappleState {
  /** False once released (below minLength, occlusion grace elapsed, controller drop). */
  active: boolean;
  /** World anchor point the rope is fixed to. */
  anchor: Vec3;
  /** Current rope length (m) — the radius of the constraint sphere. */
  length: number;
  /** True on the step the rope is being reeled in (shortening). */
  reeling: boolean;
  /** Seconds the controller has seen the rope occluded; it releases at grace. */
  occludedFor: number;
}

/**
 * Fire a grapple from `camPos` along `lookDir` at the pre-computed ray `hit`
 * (the controller casts terrain + anchor registry and passes the nearest).
 * Returns null when there was no hit or the hit is beyond `maxRange` — the
 * initial length is the fire-time distance, so the rope starts just taut.
 */
export function fireGrapple(camPos: Vec3, _lookDir: Vec3, hit: Vec3 | null): GrappleState | null {
  if (!hit) return null;
  const dx = hit.x - camPos.x;
  const dy = hit.y - camPos.y;
  const dz = hit.z - camPos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > GRAPPLE.maxRange || dist < 1e-6) return null;
  return {
    active: true,
    anchor: { x: hit.x, y: hit.y, z: hit.z },
    length: dist,
    reeling: false,
    occludedFor: 0,
  };
}

/**
 * Advance the rope one step. Pure: neither `g` nor `s` is mutated. Returns the
 * next rope state, the post-constraint velocity (the controller writes this
 * back onto the MoveState), and the stamina cost of any reeling this step (the
 * controller applies it via `drainStamina`). `reelHeld` is expected to already
 * be masked off by the controller when the player is exhausted.
 */
export function stepGrapple(
  g: GrappleState,
  s: MoveState,
  reelHeld: boolean,
  dt: number,
): { g: GrappleState; vel: Vec3; staminaCost: number } {
  const vel: Vec3 = { ...s.vel };

  // Already released: pass everything through untouched.
  if (!g.active) return { g: { ...g, anchor: { ...g.anchor } }, vel, staminaCost: 0 };

  // Occlusion auto-release (the controller maintains the timer; this is the
  // pure threshold check). Velocity is preserved on release.
  if (g.occludedFor >= GRAPPLE.occlusionGrace) {
    return { g: { ...g, anchor: { ...g.anchor }, active: false }, vel, staminaCost: 0 };
  }

  // --- Reel: shorten the rope, charge stamina, release below minLength -------
  let length = g.length;
  let staminaCost = 0;
  const reeling = reelHeld;
  if (reeling) {
    length -= GRAPPLE.reelSpeed * dt;
    staminaCost = GRAPPLE.reelCostPerS * dt;
    if (length < GRAPPLE.minLength) {
      // Reel completed: release with a lunge toward the anchor so the player
      // arrives at the target instead of stalling minLength short of it.
      const lx = g.anchor.x - s.pos.x;
      const ly = g.anchor.y - s.pos.y;
      const lz = g.anchor.z - s.pos.z;
      const ld = Math.hypot(lx, ly, lz);
      const lunged =
        ld > 1e-6
          ? {
              x: vel.x + (lx / ld) * GRAPPLE.arrivalLunge,
              y: vel.y + (ly / ld) * GRAPPLE.arrivalLunge,
              z: vel.z + (lz / ld) * GRAPPLE.arrivalLunge,
            }
          : vel;
      return {
        g: { ...g, anchor: { ...g.anchor }, length, reeling: false, active: false },
        vel: lunged,
        staminaCost,
      };
    }
  }

  const outG: GrappleState = { ...g, anchor: { ...g.anchor }, length, reeling };

  // --- Constraint ------------------------------------------------------------
  const dx = s.pos.x - g.anchor.x;
  const dy = s.pos.y - g.anchor.y;
  const dz = s.pos.z - g.anchor.z;
  const dist = Math.hypot(dx, dy, dz);

  // Slack (or degenerate at the anchor): fly free, velocity untouched.
  if (dist < 1e-6 || dist <= length) {
    return { g: outG, vel, staminaCost };
  }

  // Outward unit vector (anchor → player).
  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;

  // 1. Kill the outward radial component (rope tension — energy-removing).
  const vRad = vel.x * ux + vel.y * uy + vel.z * uz;
  if (vRad > 0) {
    vel.x -= ux * vRad;
    vel.y -= uy * vRad;
    vel.z -= uz * vRad;
  }

  // 2. Damp the remaining (now inward, ≤ 0) radial velocity.
  const vRadRem = vel.x * ux + vel.y * uy + vel.z * uz;
  const damp = vRadRem * GRAPPLE.radialDamping;
  vel.x -= ux * damp;
  vel.y -= uy * damp;
  vel.z -= uz * damp;

  // 3. Capped inward spring accel toward the constraint surface.
  const overstretch = dist - length;
  const springAccel = Math.min(GRAPPLE.stiffness * overstretch, GRAPPLE.springAccelMax);
  const dv = springAccel * dt;
  vel.x -= ux * dv;
  vel.y -= uy * dv;
  vel.z -= uz * dv;

  return { g: outG, vel, staminaCost };
}

/**
 * Analytic terrain ray-march: step out along `dir` sampling `heightAt`, and on
 * the first sample at or below the ground bisect the last segment to refine the
 * hit. Pure — `heightAt` is injected so this stays free of the terrain module.
 * Returns the world hit point, or null if the ground isn't struck within
 * `maxDist`.
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
      // Bracket [prevT (above), t (below/at)] — bisect toward the surface.
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
