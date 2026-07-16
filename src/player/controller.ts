import * as THREE from 'three';
import { GRAPPLE, INPUT, MOVE, TERRAIN } from '../core/constants.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../core/types.ts';
import { drainStamina, initialMoveState, stepMovement } from './movement.ts';
import { resolveCollision, type Obstacle } from './collision.ts';
import type { Input } from './input.ts';
import { fireGrapple, raycastTerrain, stepGrapple, type GrappleState } from './grapple.ts';
import { GrappleVisuals } from './grapple-visuals.ts';
import type { AnchorRegistry } from '../structures/anchors.ts';

// ---------------------------------------------------------------------------
// Bridges raw input → pure movement core → camera. Owns the MoveState and the
// ability unlock set, masks input flags the player hasn't earned, resolves
// obstacle collisions, handles surface swimming, and drives the first-person
// camera each fixed step.
//
// Unlock gating (masks applied here so the core stays ability-agnostic):
//   'glider'  → enables the jumpHeld glide flag
//   'rocket'  → enables the rocket edge
//   'boots'   → grants one extra mid-air jump (re-fired by opening a coyote
//               window for exactly one step, spent until the next landing)
//   'grapple' → (RMB gating handled by later grapple task)
// Walk / sprint / jump / dash are available from spawn — never gated.
// ---------------------------------------------------------------------------

/**
 * Did the core's landing block run during this step? True for a plain landing
 * (grounded flips on) and also for a *buffered-jump* landing, where the core
 * touches down and immediately re-fires a jump, returning grounded=false for
 * that same step. That path is identified by its unique signature: the landing
 * block runs after gravity + integration, so the re-fired jump leaves vy at
 * exactly MOVE.jumpVel with the buffer consumed; the air dash/rocket charge
 * resets (also landing-block-only) are checked as additional signals. Pure —
 * unit-tested in tests/controller.test.ts.
 */
export function landedDuringStep(prev: MoveState, next: MoveState): boolean {
  if (prev.grounded) return false;
  if (next.grounded) return true;
  return (
    (prev.airDashUsed && !next.airDashUsed) ||
    (prev.airRocketUsed && !next.airRocketUsed) ||
    (prev.jumpBuffer > 0 && next.jumpBuffer === 0 && next.vel.y === MOVE.jumpVel)
  );
}

export class PlayerController {
  readonly unlocks = new Set<string>();

  private state: MoveState;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: Input;
  private readonly ground: GroundQuery;

  /** Trees/rocks pushout cylinders — wired empty until Task 6 supplies them. */
  obstacles: Obstacle[] = [];

  /** Spent once a mid-air (boots) jump is used; reset on landing. */
  private usedAirJump = false;

  // --- Grapple (Task 12) ---------------------------------------------------
  /** Optional anchor registry (drones, Task 13) raycast alongside the terrain. */
  private readonly anchors: AnchorRegistry | null;
  /** Optional rope/hook renderer (present only when a scene is supplied). */
  private readonly visuals: GrappleVisuals | null;
  /** Active rope, or null when not grappling. */
  private grapple: GrappleState | null = null;
  /** Previous RMB-held sample, for edge detection (press fires / release drops). */
  private prevRmb = false;
  /** Scratch camera look-direction (allocation-free). */
  private readonly _look = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    input: Input,
    ground: GroundQuery,
    spawn: Vec3,
    scene?: THREE.Scene,
    anchors?: AnchorRegistry,
  ) {
    this.camera = camera;
    this.input = input;
    this.ground = ground;
    this.state = initialMoveState(spawn);
    this.anchors = anchors ?? null;
    this.visuals = scene ? new GrappleVisuals(scene) : null;
    this.syncCamera();
  }

  /** True while a rope is attached — main.ts suppresses dart throws when so. */
  isGrappling(): boolean {
    return this.grapple !== null && this.grapple.active;
  }

  /** Camera look direction as a plain vector (unit). */
  private lookDir(): Vec3 {
    this.camera.getWorldDirection(this._look);
    return { x: this._look.x, y: this._look.y, z: this._look.z };
  }

  /**
   * Raycast terrain + the anchor registry from the eye; return the nearest hit
   * within maxRange, or null. Anchor spheres win ties only if genuinely nearer.
   */
  private grappleTarget(origin: Vec3, dir: Vec3): Vec3 | null {
    const terrain = raycastTerrain(origin, dir, this.ground.heightAt, GRAPPLE.maxRange);
    const anchor = this.anchors?.raycastAnchors(origin, dir, GRAPPLE.maxRange) ?? null;
    if (!terrain) return anchor ? anchor.point : null;
    if (!anchor) return terrain;
    const dt = Math.hypot(terrain.x - origin.x, terrain.y - origin.y, terrain.z - origin.z);
    const da = Math.hypot(
      anchor.point.x - origin.x,
      anchor.point.y - origin.y,
      anchor.point.z - origin.z,
    );
    return da < dt ? anchor.point : terrain;
  }

  /** True if terrain rises above the player→anchor segment (rope occluded). */
  private segmentOccluded(a: Vec3, b: Vec3): boolean {
    const n = GRAPPLE.occlusionSamples;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      if (y < this.ground.heightAt(x, z)) return true;
    }
    return false;
  }

  /** Debug: attach a rope to a fixed world point (used by `?debug=grapple`). */
  debugFireGrapple(anchor: Vec3): void {
    const eye = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    this.grapple = fireGrapple(eye, this.lookDir(), anchor);
    this.updateGrappleVisuals();
  }

  /** Sync the rope renderer to the current grapple state (no-op without a scene). */
  private updateGrappleVisuals(): void {
    if (!this.visuals) return;
    if (this.grapple && this.grapple.active) {
      // Originate the rope from a "hand" just in front of and below the eye so
      // its near end isn't clipped by the camera near plane.
      const eye = this.camera.position;
      const f = this.lookDir();
      const hand = {
        x: eye.x + f.x * 0.6,
        y: eye.y + f.y * 0.6 - 0.35,
        z: eye.z + f.z * 0.6,
      };
      this.visuals.update(hand, this.grapple.anchor, this.grapple.length);
    } else {
      this.visuals.hide();
    }
  }

  // --- Zipline ride (Task 13) ---------------------------------------------
  // While riding, the ZiplineSystem drives pos/vel each step via `rideStep`;
  // the controller skips its entire normal pipeline (no gravity, no movement,
  // no grapple, no swim) but keeps free-look by syncing the camera.
  /** Begin a zipline ride: flip mode and drop any active rope. */
  rideStart(): void {
    this.grapple = null;
    this.state = { ...this.state, mode: 'zipline' };
  }
  /** Set the ride position/velocity for this step (external rider math). */
  rideStep(pos: Vec3, vel: Vec3): void {
    this.state = { ...this.state, pos: { ...pos }, vel: { ...vel } };
    this.syncCamera();
  }
  /** Dismount: return to normal mode airborne, preserving the exit velocity. */
  rideEnd(vel: Vec3): void {
    this.state = { ...this.state, mode: 'normal', vel: { ...vel }, grounded: false };
    this.usedAirJump = false;
  }

  /** Advance one fixed sim step, then place the camera. */
  update(dt: number): void {
    // Riding a zipline: kinematics are owned by the ZiplineSystem (rideStep);
    // the normal pipeline is skipped. Camera was already synced by rideStep.
    if (this.state.mode === 'zipline') {
      this.updateGrappleVisuals();
      return;
    }

    const raw = this.input.state();

    // --- Mask abilities the player hasn't unlocked -------------------------
    const masked: MoveInput = { ...raw };
    if (!this.unlocks.has('glider')) masked.jumpHeld = false;
    if (!this.unlocks.has('rocket')) masked.rocket = false;

    // --- Swim mode: set from the terrain column under the feet -------------
    // heightAt < sea level → the ground here is submerged, so we surface-swim.
    // (Zipline mode already returned above, so `mode` is only 'normal'|'swim'.)
    {
      const submerged =
        this.ground.heightAt(this.state.pos.x, this.state.pos.z) < TERRAIN.seaLevel;
      const desired = submerged ? 'swim' : 'normal';
      if (this.state.mode !== desired) {
        this.state = { ...this.state, mode: desired };
      }
    }

    // --- Grapple: fire / hold / release edges (RMB), reel (LMB) ------------
    // RMB press fires (only with the 'grapple' unlock), stays attached while
    // held, releases on RMB release. LMB held reels while attached.
    const rmb = this.input.rmbHeld && this.state.mode === 'normal';
    if (rmb && !this.prevRmb && this.unlocks.has('grapple') && !this.grapple) {
      const eye = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      };
      const dir = this.lookDir();
      this.grapple = fireGrapple(eye, dir, this.grappleTarget(eye, dir));
    } else if (!rmb && this.grapple) {
      this.grapple = null; // released the button → drop the rope
    }
    this.prevRmb = rmb;

    // Movement-feel guards: gliding conflicts with the rope (wing wins →
    // release); a jump releases with a small upward boost for flow. Dashing is
    // allowed — the dash burst runs in the core, then the rope re-constrains.
    if (
      this.grapple &&
      masked.jumpHeld &&
      this.unlocks.has('glider') &&
      !this.state.grounded
    ) {
      this.grapple = null;
    }
    let jumpRelease = false;
    if (this.grapple && masked.jump) {
      this.grapple = null;
      masked.jump = false; // consume the edge so it doesn't buffer post-release
      jumpRelease = true;
    }

    // --- Double jump (boots): open a coyote window for one air jump --------
    let airJumped = false;
    if (
      masked.jump &&
      this.unlocks.has('boots') &&
      this.state.mode === 'normal' &&
      !this.state.grounded &&
      this.state.coyote <= 0 &&
      !this.usedAirJump
    ) {
      this.state = { ...this.state, coyote: MOVE.coyoteTime };
      airJumped = true;
    }

    // --- Step the pure core ------------------------------------------------
    const prev = this.state;
    let next = stepMovement(prev, masked, dt, this.ground);

    if (airJumped) this.usedAirJump = true;
    // Reset the boots charge on landing — including a buffered-jump landing,
    // where the core re-fires a jump in its landing block and grounded stays
    // false for the step.
    if (landedDuringStep(prev, next)) this.usedAirJump = false;

    // --- Surface swimming holds the player at the water line ---------------
    if (next.mode === 'swim') {
      next.pos.y = TERRAIN.seaLevel;
    }

    // --- Obstacle pushout (XZ only; y untouched) ---------------------------
    if (this.obstacles.length > 0) {
      const resolved = resolveCollision(next.pos, INPUT.playerRadius, this.obstacles);
      next.pos.x = resolved.x;
      next.pos.z = resolved.z;
    }

    // --- Grapple rope constraint (post-processes velocity after the core) --
    if (this.grapple && this.grapple.active) {
      const occluded = this.segmentOccluded(next.pos, this.grapple.anchor);
      this.grapple = {
        ...this.grapple,
        occludedFor: occluded ? this.grapple.occludedFor + dt : 0,
      };
      // Reel while LMB held; masked off when exhausted (no reel on empty tank).
      const reelHeld = this.input.lmbHeld && !next.exhausted;
      const res = stepGrapple(this.grapple, next, reelHeld, dt);
      next.vel = res.vel;
      this.grapple = res.g.active ? res.g : null;
      if (res.staminaCost > 0) next = drainStamina(next, res.staminaCost);
    }

    // Jump-release boost: a bit of lift so the release flows into a leap.
    if (jumpRelease) next.vel.y += GRAPPLE.jumpReleaseBoost;

    this.state = next;
    this.updateGrappleVisuals();
    this.syncCamera();
  }

  /** Place the camera at eye height with the input-owned yaw/pitch. */
  private syncCamera(): void {
    const p = this.state.pos;
    this.camera.position.set(p.x, p.y + INPUT.eyeHeight, p.z);
    // YXZ euler: rotation.y = yaw matches the core facing (-sin yaw, 0, -cos yaw);
    // positive pitch looks up. Roll is always zero.
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
  }

  /** Current feet position (read-only snapshot). */
  get pos(): Vec3 {
    return { ...this.state.pos };
  }

  /** Current stamina / grounded snapshots for the debug HUD. */
  get stamina(): number {
    return this.state.stamina;
  }
  get grounded(): boolean {
    return this.state.grounded;
  }
  get mode(): MoveState['mode'] {
    return this.state.mode;
  }

  /** Debug teleport (Task 14 expands this). Velocity is zeroed on arrival. */
  teleport(x: number, y: number, z: number): void {
    this.state = {
      ...this.state,
      pos: { x, y, z },
      vel: { x: 0, y: 0, z: 0 },
      grounded: false,
    };
    this.usedAirJump = false;
    this.syncCamera();
  }
}
