import { MOUNT, MOVE } from '../core/constants.ts';
import { speciesById } from '../critters/species.ts';
import type { RosterEntry, Roster } from '../critters/roster.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../core/types.ts';


// ---------------------------------------------------------------------------
// Prismhorse mount core (Haven V6). Pure, three-free: eligibility gates, the
// single-active-mount roster transition, and the ride kinematics (`mountStep`).
//
// Riding is a stripped-down walker: yaw-driven planar accel toward MOUNT.speed,
// a fixed-impulse jump, gravity + ground snap — but NO stamina/dash/rocket/
// glide/grapple (the controller masks those input flags; `mountStep` never even
// reads or writes stamina). The mount refuses to wade into deep water: any
// per-axis step that would land the feet over terrain below MOUNT.waterBlockDepth
// has that velocity component zeroed (a simple wall, not the critters' steer-
// along avoidance — overkill for a mount).
//
// Yaw convention matches the walker (movement.ts): yaw 0 faces -Z, so
//   facing = (-sin yaw, 0, -cos yaw)   right = (cos yaw, 0, -sin yaw).
// ---------------------------------------------------------------------------

/**
 * Can `entry` be set as the active mount? Requires the Saddle reward AND a
 * rideable species (only the prismhorse) AND the entry not being on farm duty
 * (unassign it from its plot first — the two statuses are exclusive).
 * `undefined` entry (nothing selected) is never mountable. Pure — `rewards` is
 * the owned-reward id set.
 */
export function canMount(rewards: Set<string>, entry: RosterEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.status.kind === 'farm') return false;
  if (!rewards.has('saddle')) return false;
  return speciesById(entry.speciesId)?.rideable === true;
}

/** Can the player summon a distant mount to their side? Requires the Whistle. */
export function canSummon(rewards: Set<string>): boolean {
  return rewards.has('whistle');
}

/**
 * Can `entry` be sent to a farm plot? Refuses an entry currently on mount duty
 * (unset it as a mount first — farm and mount statuses are exclusive). This is
 * the symmetric guard to `canMount`'s farm-status check. `undefined` (nothing
 * selected) is never assignable. Pure.
 */
export function canAssignToFarm(entry: RosterEntry | undefined): boolean {
  if (!entry) return false;
  return entry.status.kind !== 'mount';
}

/**
 * Set the roster entry `id` as the single active mount: it becomes
 * status 'mount' and any OTHER entry currently on mount duty reverts to idle
 * (only one mount at a time). Pure — returns a NEW roster; if `id` isn't on the
 * roster, or the entry is on farm duty (statuses are exclusive — unassign
 * first), the input is returned unchanged (never silently drops an existing
 * mount or a plot assignment).
 */
export function setActiveMount(roster: Roster, id: number): Roster {
  const target = roster.find((e) => e.id === id);
  if (!target || target.status.kind === 'farm') return roster;
  return roster.map((e) => {
    if (e.id === id) {
      return e.status.kind === 'mount' ? e : { ...e, status: { kind: 'mount' } };
    }
    if (e.status.kind === 'mount') return { ...e, status: { kind: 'idle' } };
    return e;
  });
}

/**
 * Dismount launch velocity (pure): keep the ride's PLANAR momentum and add an
 * upward hop so hopping off flows into a leap instead of a dead stop. `rideVel`
 * is the mount's velocity at the instant of dismount; `hop` is the vertical
 * kick (m/s). The vertical component of the ride velocity is dropped (a mount
 * is grounded/near-grounded) — only the hop drives Y.
 */
export function dismountVelocity(rideVel: Vec3, hop: number): Vec3 {
  return { x: rideVel.x, y: hop, z: rideVel.z };
}

/**
 * Remaining mounted-eye-height bonus (m) `elapsed` seconds after a dismount,
 * lerping linearly from `bonus` down to 0 over `duration`. Clamped: `elapsed`
 * ≤ 0 → full bonus, ≥ duration → 0. Pure — drives the controller's post-
 * dismount camera-height decay so the eye eases down instead of popping.
 */
export function dismountEyeOffset(elapsed: number, duration: number, bonus: number): number {
  if (duration <= 0 || elapsed >= duration) return 0;
  if (elapsed <= 0) return bonus;
  return bonus * (1 - elapsed / duration);
}

/** Move the planar (x, z) velocity toward a target by at most `maxDelta`. */
function drivePlanar(vel: { x: number; z: number }, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - vel.x;
  const dz = tz - vel.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDelta) {
    vel.x = tx;
    vel.z = tz;
  } else {
    vel.x += (dx / dist) * maxDelta;
    vel.z += (dz / dist) * maxDelta;
  }
}

/**
 * Advance the ride one fixed step. Pure: `s` is not mutated (a fresh MoveState
 * is returned, its stamina/dash/rocket bookkeeping copied through untouched —
 * riding never drains stamina). Planar velocity accelerates toward MOUNT.speed
 * along the yaw-relative move intent; a grounded jump edge launches at
 * MOUNT.jumpVel; gravity (shared with the walker) integrates and the feet snap
 * to `ground`. Deep water is a wall: a per-axis look-ahead zeroes any velocity
 * component that would carry the feet over terrain below MOUNT.waterBlockDepth.
 */
export function mountStep(s: MoveState, input: MoveInput, dt: number, g: GroundQuery): MoveState {
  const n: MoveState = {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    dashDir: { ...s.dashDir },
  };

  // --- Yaw-relative move intent (camera-yaw driven, exactly like walking) ---
  const fx = -Math.sin(input.yaw);
  const fz = -Math.cos(input.yaw);
  const rxx = Math.cos(input.yaw);
  const rzz = -Math.sin(input.yaw);
  let ix = input.forward * fx + input.strafe * rxx;
  let iz = input.forward * fz + input.strafe * rzz;
  const ilen = Math.hypot(ix, iz);
  if (ilen > 1) {
    ix /= ilen;
    iz /= ilen;
  }

  // --- Planar accel toward the ride target (friction to zero with no intent) -
  drivePlanar(n.vel, ix * MOUNT.speed, iz * MOUNT.speed, MOUNT.accel * dt);

  // --- Jump (edge): grounded only — no coyote/buffer/air-jump on a mount ----
  if (input.jump && n.grounded) {
    n.vel.y = MOUNT.jumpVel;
    n.grounded = false;
  }

  // --- Gravity (shared with the walker) -------------------------------------
  n.vel.y += MOVE.gravity * dt;

  // --- Deep-water block: zero any into-water horizontal velocity component ---
  if (n.vel.x !== 0 && g.heightAt(n.pos.x + n.vel.x * dt, n.pos.z) < MOUNT.waterBlockDepth) {
    n.vel.x = 0;
  }
  if (n.vel.z !== 0 && g.heightAt(n.pos.x, n.pos.z + n.vel.z * dt) < MOUNT.waterBlockDepth) {
    n.vel.z = 0;
  }

  // --- Integrate + ground resolve -------------------------------------------
  n.pos.x += n.vel.x * dt;
  n.pos.y += n.vel.y * dt;
  n.pos.z += n.vel.z * dt;

  const h = g.heightAt(n.pos.x, n.pos.z);
  if (n.pos.y <= h) {
    n.pos.y = h;
    n.vel.y = 0;
    n.grounded = true;
  } else {
    n.grounded = false;
  }

  return n;
}
