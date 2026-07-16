import * as THREE from 'three';
import { INPUT, MOVE, TERRAIN } from '../core/constants.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../core/types.ts';
import { initialMoveState, stepMovement } from './movement.ts';
import { resolveCollision, type Obstacle } from './collision.ts';
import type { Input } from './input.ts';

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

  constructor(
    camera: THREE.PerspectiveCamera,
    input: Input,
    ground: GroundQuery,
    spawn: Vec3,
  ) {
    this.camera = camera;
    this.input = input;
    this.ground = ground;
    this.state = initialMoveState(spawn);
    this.syncCamera();
  }

  /** Advance one fixed sim step, then place the camera. */
  update(dt: number): void {
    const raw = this.input.state();

    // --- Mask abilities the player hasn't unlocked -------------------------
    const masked: MoveInput = { ...raw };
    if (!this.unlocks.has('glider')) masked.jumpHeld = false;
    if (!this.unlocks.has('rocket')) masked.rocket = false;

    // --- Swim mode: set from the terrain column under the feet -------------
    // heightAt < sea level → the ground here is submerged, so we surface-swim.
    if (this.state.mode !== 'zipline') {
      const submerged =
        this.ground.heightAt(this.state.pos.x, this.state.pos.z) < TERRAIN.seaLevel;
      const desired = submerged ? 'swim' : 'normal';
      if (this.state.mode !== desired) {
        this.state = { ...this.state, mode: desired };
      }
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
    const next = stepMovement(prev, masked, dt, this.ground);

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

    this.state = next;
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
