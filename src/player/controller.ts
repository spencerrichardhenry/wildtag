import * as THREE from 'three';
import { GRAPPLE, INPUT, MOVE, TERRAIN } from '../core/constants.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../core/types.ts';
import { initialMoveState, stepMovement } from './movement.ts';
import { resolveCollision, type Obstacle } from './collision.ts';
import type { Input } from './input.ts';
import {
  fireHook,
  latchedHook,
  stepAttached,
  stepHook,
  type GrappleCollider,
  type HookQueries,
  type HookState,
} from './grapple.ts';
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
  /** Active hook (flying / latched), or null when idle. */
  private hook: HookState | null = null;
  /**
   * Grappleable tree/rock cylinders near a query point. Wired by main.ts from
   * the PropManager; defaults to none so headless/unit use needs no world.
   */
  grappleColliders: (x: number, z: number) => GrappleCollider[] = () => [];
  /** Seconds the latched rope has stayed occluded (auto-releases at grace). */
  private hookOccludedFor = 0;
  /**
   * Sim steps the current hook has spent LATCHED (in the constraint/hang block).
   * Gates the jump-release boost: a hook fired and jump-released before it has
   * ever latched (grappleSteps still 0) gets no free lift, upholding the
   * no-free-flight invariant. Reset to 0 on every fire.
   */
  private grappleSteps = 0;
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

  /** True while a hook is out (flying or latched) — crosshair 'grapple' state. */
  isGrappling(): boolean {
    return this.hook !== null && this.hook.phase !== 'done';
  }

  /** Camera look direction as a plain vector (unit). */
  private lookDir(): Vec3 {
    this.camera.getWorldDirection(this._look);
    return { x: this._look.x, y: this._look.y, z: this._look.z };
  }

  /** Rope originates from a "hand" just ahead of and below the eye. */
  private handPos(f: Vec3): Vec3 {
    const eye = this.camera.position;
    return { x: eye.x + f.x * 0.6, y: eye.y + f.y * 0.6 - 0.35, z: eye.z + f.z * 0.6 };
  }

  /** Launch a fresh hook along the current look; resets latch bookkeeping. */
  private fireNewHook(): void {
    const f = this.lookDir();
    this.hook = fireHook(this.handPos(f), f);
    this.grappleSteps = 0;
    this.hookOccludedFor = 0;
  }

  /** Injected world queries for the flying-hook sweep (terrain/props/drones). */
  private hookQueries(): HookQueries {
    return {
      heightAt: this.ground.heightAt,
      getGrappleColliders: this.grappleColliders,
      raycastDrones: this.anchors
        ? (a, b) => {
            const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
            const len = Math.hypot(dir.x, dir.y, dir.z);
            if (len < 1e-9) return null;
            const hit = this.anchors!.raycastAnchors(a, dir, len);
            return hit ? { point: hit.point, anchorId: hit.anchorId } : null;
          }
        : undefined,
    };
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

  /**
   * Debug: instantly latch a rope to a fixed world point (used by
   * `?debug=grapple` + e2e check f). Skips the flight so the static screenshot
   * always shows an attached rope; `state.grappling` reads true.
   */
  debugFireGrapple(anchor: Vec3): void {
    this.hook = latchedHook(anchor, this.state.pos);
    this.grappleSteps = 1;
    this.hookOccludedFor = 0;
    this.updateGrappleVisuals();
  }

  /** Sync the rope renderer to the current hook (no-op without a scene). */
  private updateGrappleVisuals(): void {
    if (!this.visuals) return;
    const h = this.hook;
    if (!h || h.phase === 'done') {
      this.visuals.hide();
      return;
    }
    const f = this.lookDir();
    const hand = this.handPos(f);
    if (h.phase === 'flying') {
      const d = Math.hypot(h.pos.x - hand.x, h.pos.y - hand.y, h.pos.z - hand.z);
      this.visuals.update(hand, h.pos, d, false); // rope trails the projectile
    } else {
      this.visuals.update(hand, h.anchor!, h.length, true);
    }
  }

  // --- Zipline ride (Task 13) ---------------------------------------------
  // While riding, the ZiplineSystem drives pos/vel each step via `rideStep`;
  // the controller skips its entire normal pipeline (no gravity, no movement,
  // no grapple, no swim) but keeps free-look by syncing the camera.
  /** Begin a zipline ride: flip mode and drop any active hook. */
  rideStart(): void {
    this.hook = null;
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

    // --- Grapple: Terraria-style projectile hook (RMB tap fires) -----------
    // RMB is now an edge, not a hold. Idle → fire; flying → cancel (retract);
    // zipping → plain release (keep momentum); hanging → re-fire a new hook
    // (the climb-chaining loop). Any non-normal mode (swim) drops the hook.
    const rmb = this.input.rmbHeld && this.state.mode === 'normal';
    const rmbEdge = rmb && !this.prevRmb;
    this.prevRmb = rmb;

    if (this.hook && this.state.mode !== 'normal') this.hook = null;

    if (rmbEdge && this.unlocks.has('grapple') && this.state.mode === 'normal') {
      const h = this.hook;
      if (!h) this.fireNewHook();
      else if (h.phase === 'flying') this.hook = null; // cancel a hook in flight
      else if (h.hang) this.fireNewHook(); // re-fire from a hang (climb)
      else this.hook = null; // plain release while zipping (keep momentum)
    }

    // Glide conflicts with the rope (wing wins → release).
    if (this.hook && masked.jumpHeld && this.unlocks.has('glider') && !this.state.grounded) {
      this.hook = null;
    }
    // Jump releases the hook; only a LATCHED hook that has done work on a prior
    // step earns the upward boost (a hang counts as steps). A flying hook or a
    // same-step fire+jump grants nothing — the no-free-flight invariant.
    let jumpRelease = false;
    if (this.hook && masked.jump) {
      const latched = this.hook.phase === 'latched';
      this.hook = null;
      masked.jump = false; // consume the edge so it doesn't buffer post-release
      jumpRelease = latched && this.grappleSteps >= 1;
    }
    // Dash breaks a hang (a hang skips the movement core, so gravity/dash must
    // be released explicitly; dashing while zipping is handled by the core).
    if (this.hook && this.hook.phase === 'latched' && this.hook.hang && masked.dash) {
      this.hook = null;
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

    // --- Grapple hook: fly the projectile, or run the latched zip / hang ---
    if (this.hook) {
      if (this.hook.phase === 'flying') {
        // The hook flies independently; the player keeps moving under gravity
        // (already integrated in `next`). A latch resolves the rope length
        // against the player's new position. A miss/timeout → phase 'done'.
        const stepped = stepHook(this.hook, next.pos, this.hookQueries(), dt);
        this.hook = stepped.phase === 'done' ? null : stepped;
      } else {
        // Latched: track a live drone anchor, auto-release on prolonged
        // occlusion, then auto-zip / hang.
        if (this.hook.anchorDrone && this.anchors) {
          const p = this.anchors.getAnchorPos(this.hook.anchorDrone);
          if (p) {
            this.hook = { ...this.hook, anchor: p };
          } else {
            // Drone recalled/unregistered mid-latch: the anchor no longer
            // exists — release immediately. Keeping the stale point would
            // leave the player hanging on thin air (levitation).
            this.hook = null;
          }
        }
        if (this.hook === null) {
          // Released this step (anchor vanished) — fall through to the common
          // tail below; `next` already carries the free-fall integration.
          this.state = next;
          this.updateGrappleVisuals();
          this.syncCamera();
          return;
        }
        const occluded = this.segmentOccluded(next.pos, this.hook.anchor!);
        this.hookOccludedFor = occluded ? this.hookOccludedFor + dt : 0;
        if (this.hookOccludedFor >= GRAPPLE.occlusionGrace) {
          this.hook = null;
        } else {
          this.grappleSteps++; // latched work done — enables the release boost
          const res = stepAttached(this.hook, next, dt, this.ground.heightAt);
          this.hook = res.h;
          if (res.pin) {
            // Hang: pinned to real geometry, gravity suspended (not flight).
            next.pos = res.pin;
            next.vel = { x: 0, y: 0, z: 0 };
            next.grounded = false;
          } else {
            next.vel = res.vel;
          }
        }
      }
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
  /** True while the movement core's exhaustion latch is set (<1, clears ≥20). */
  get exhausted(): boolean {
    return this.state.exhausted;
  }
  get grounded(): boolean {
    return this.state.grounded;
  }
  get mode(): MoveState['mode'] {
    return this.state.mode;
  }

  /** Debug teleport. Velocity is zeroed on arrival. */
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

  /** Debug-only (Task 14): force the stamina pool to `n`, clamped to [0, staminaMax]. */
  setStamina(n: number): void {
    const clamped = Math.max(0, Math.min(MOVE.staminaMax, n));
    this.state = { ...this.state, stamina: clamped };
  }
}
