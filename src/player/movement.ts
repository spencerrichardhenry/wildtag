import { MOVE } from '../core/constants.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure first-person movement core — the heart of the game. No `three` import,
// no randomness: plain { x, y, z } math stepped at a fixed dt.
//
// Yaw convention (matches a three.js camera): yaw = 0 faces -Z.
//   facing = (-sin yaw, 0, -cos yaw)   right = (cos yaw, 0, -sin yaw)
//
// Input flags are pre-masked by the controller: `jump`/`dash`/`rocket` are
// edge-triggered (true for exactly one step) and ability unlock gating lives
// upstream — the core assumes an ability is allowed iff its flag is set.
//
// Step ordering (each stage reads the previous stage's output):
//   tick timers → dash trigger → horizontal accel (dash / glide / walk) →
//   jump → rocket impulse → vertical (gravity or glide clamp; skipped while
//   dashing) → integrate → ground resolve (snap / coyote / buffered jump /
//   air-ability reset) → stamina regen → exhaustion latch.
// Ability gates read the *incoming* `exhausted` flag; the latch updates at
// the end of the step.
// ---------------------------------------------------------------------------

/** Fresh spawn state: full stamina, at rest, ungrounded until the first step snaps. */
export function initialMoveState(pos: Vec3): MoveState {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    grounded: false,
    stamina: MOVE.staminaMax,
    exhausted: false,
    coyote: 0,
    jumpBuffer: 0,
    dashCooldown: 0,
    dashTime: 0,
    dashDir: { x: 0, y: 0, z: -1 },
    airDashUsed: false,
    airRocketUsed: false,
    rocketCooldown: 0,
    gliding: false,
    staminaRegenDelay: 0,
    mode: 'normal',
  };
}

/**
 * External stamina drain (e.g. grapple reel, Task 12). Pure: returns a new
 * state with the drain applied, the regen delay reset, and exhaustion latched
 * if the pool dropped below the enter threshold.
 */
export function drainStamina(s: MoveState, amount: number): MoveState {
  const stamina = Math.max(0, s.stamina - amount);
  return {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    dashDir: { ...s.dashDir },
    stamina,
    staminaRegenDelay: MOVE.regenDelay,
    exhausted: stamina < MOVE.exhaustEnterBelow ? true : s.exhausted,
  };
}

/** Move the planar (x, z) velocity toward a target by at most `maxDelta`. */
function drivePlanar(vel: Vec3, tx: number, tz: number, maxDelta: number): void {
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

/** Advance the movement simulation one fixed step. Pure: `s` is not mutated. */
export function stepMovement(s: MoveState, input: MoveInput, dt: number, g: GroundQuery): MoveState {
  const n: MoveState = {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    dashDir: { ...s.dashDir },
  };

  // --- Tick timers -------------------------------------------------------
  n.dashCooldown = Math.max(0, n.dashCooldown - dt);
  n.rocketCooldown = Math.max(0, n.rocketCooldown - dt);
  n.staminaRegenDelay = Math.max(0, n.staminaRegenDelay - dt);
  n.coyote = Math.max(0, n.coyote - dt);
  n.jumpBuffer = Math.max(0, n.jumpBuffer - dt);

  // --- Facing + player-relative intent ------------------------------------
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
  const hasIntent = ilen > 1e-9;

  const drain = (amount: number): void => {
    n.stamina = Math.max(0, n.stamina - amount);
    n.staminaRegenDelay = MOVE.regenDelay;
  };

  // --- Swim: halved target speeds, y held by the controller, no abilities --
  if (s.mode === 'swim') {
    const sprinting = input.sprint && !s.exhausted && hasIntent;
    const target = (sprinting ? MOVE.sprint : MOVE.walk) / 2;
    drivePlanar(n.vel, ix * target, iz * target, MOVE.accelGround * dt);
    if (sprinting) drain(MOVE.sprintDrain * dt);
    n.vel.y = 0;
    n.gliding = false;
    n.dashTime = 0;
    n.pos.x += n.vel.x * dt;
    n.pos.z += n.vel.z * dt;
    finishStamina(n, dt);
    return n;
  }

  const wasGrounded = s.grounded;

  // --- Dash trigger (edge) -------------------------------------------------
  if (
    input.dash &&
    n.dashCooldown <= 0 &&
    n.stamina >= MOVE.dashCost &&
    !s.exhausted &&
    (n.grounded || !n.airDashUsed)
  ) {
    n.dashTime = MOVE.dashDuration;
    n.dashDir = { x: fx, y: 0, z: fz };
    n.dashCooldown = MOVE.dashCooldown;
    drain(MOVE.dashCost);
    if (!n.grounded) n.airDashUsed = true;
  }
  const dashing = n.dashTime > 0;

  // Glide intent (finalized after jump/rocket may push vy upward).
  let gliding = !dashing && input.jumpHeld && !n.grounded && n.vel.y < 0;

  // --- Horizontal ----------------------------------------------------------
  if (dashing) {
    n.vel.x = n.dashDir.x * MOVE.dashSpeed;
    n.vel.z = n.dashDir.z * MOVE.dashSpeed;
    n.dashTime = Math.max(0, n.dashTime - dt);
  } else if (gliding) {
    drivePlanar(n.vel, fx * MOVE.glideForward, fz * MOVE.glideForward, MOVE.accelAir * dt);
  } else {
    const sprinting = input.sprint && !s.exhausted && hasIntent;
    const target = sprinting ? MOVE.sprint : MOVE.walk;
    if (n.grounded) {
      // Accelerate toward the target; with no intent this is friction to zero.
      drivePlanar(n.vel, ix * target, iz * target, MOVE.accelGround * dt);
    } else if (hasIntent) {
      drivePlanar(n.vel, ix * target, iz * target, MOVE.accelAir * dt);
    }
    if (sprinting) drain(MOVE.sprintDrain * dt);
  }

  // --- Jump (edge): grounded/coyote fires now, otherwise buffer ------------
  let jumped = false;
  if (input.jump) {
    if (n.grounded || n.coyote > 0) {
      n.vel.y = MOVE.jumpVel;
      n.grounded = false;
      n.coyote = 0;
      jumped = true;
    } else {
      n.jumpBuffer = MOVE.jumpBufferTime;
    }
  }

  // --- Rocket (edge) --------------------------------------------------------
  if (
    input.rocket &&
    n.rocketCooldown <= 0 &&
    n.stamina >= MOVE.rocketCost &&
    !s.exhausted &&
    (n.grounded || !n.airRocketUsed)
  ) {
    n.vel.y += MOVE.rocketImpulseY;
    n.vel.x += fx * MOVE.rocketImpulseFwd;
    n.vel.z += fz * MOVE.rocketImpulseFwd;
    n.rocketCooldown = MOVE.rocketCooldown;
    drain(MOVE.rocketCost);
    if (!n.grounded) n.airRocketUsed = true;
  }

  // --- Vertical -------------------------------------------------------------
  // A jump or rocket this step makes vy >= 0 → the glide never engages, so the
  // clamp can only ever floor a falling vy at glideSink: gliding never yields
  // vy above the sink rate, and can never produce ascent.
  gliding = gliding && n.vel.y < 0;
  if (dashing) {
    // Gravity is skipped for the dash window.
  } else if (gliding) {
    n.vel.y = Math.max(n.vel.y + MOVE.gravity * dt, MOVE.glideSink);
  } else {
    n.vel.y += MOVE.gravity * dt;
  }
  n.gliding = gliding;

  // --- Integrate -------------------------------------------------------------
  n.pos.x += n.vel.x * dt;
  n.pos.y += n.vel.y * dt;
  n.pos.z += n.vel.z * dt;

  // --- Ground resolve ---------------------------------------------------------
  const h = g.heightAt(n.pos.x, n.pos.z);
  if (n.pos.y <= h) {
    n.pos.y = h;
    n.vel.y = 0;
    n.grounded = true;
    n.gliding = false;
    n.airDashUsed = false;
    n.airRocketUsed = false;
    if (n.jumpBuffer > 0) {
      // Buffered jump fires the moment we land.
      n.vel.y = MOVE.jumpVel;
      n.grounded = false;
      n.jumpBuffer = 0;
      n.coyote = 0;
    }
  } else {
    // Leaving the ground without jumping grants the coyote window.
    if (wasGrounded && !jumped) n.coyote = MOVE.coyoteTime;
    n.grounded = false;
  }

  finishStamina(n, dt);
  return n;
}

/** End-of-step stamina regen + exhaustion latch (mutates the working copy). */
function finishStamina(n: MoveState, dt: number): void {
  if (n.staminaRegenDelay <= 0) {
    n.stamina = Math.min(MOVE.staminaMax, n.stamina + MOVE.regenRate * dt);
  }
  if (n.stamina < MOVE.exhaustEnterBelow) {
    n.exhausted = true;
  } else if (n.exhausted && n.stamina >= MOVE.exhaustExitAbove) {
    n.exhausted = false;
  }
}
