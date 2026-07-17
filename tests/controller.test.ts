import { describe, expect, it } from 'vitest';
import { MOVE } from '../src/core/constants.ts';
import type { GroundQuery, MoveInput, MoveState } from '../src/core/types.ts';
import { initialMoveState, stepMovement } from '../src/player/movement.ts';
import { landedDuringStep } from '../src/player/controller.ts';

// The controller resets its boots double-jump charge on landing. "Landing" must
// include the buffered-jump case, where the core's landing block immediately
// re-fires a jump and returns grounded=false for that same step.

const DT = 1 / 60;

const flat: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

function input(partial: Partial<MoveInput> = {}): MoveInput {
  return {
    forward: 0,
    strafe: 0,
    yaw: 0,
    sprint: false,
    jump: false,
    jumpHeld: false,
    dash: false,
    rocket: false,
    ...partial,
  };
}

/** An airborne state falling just above flat ground. */
function fallingState(y = 0.05): MoveState {
  const s = initialMoveState({ x: 0, y, z: 0 });
  return { ...s, vel: { x: 0, y: -5, z: 0 } };
}

describe('landedDuringStep', () => {
  it('detects a plain landing (airborne → grounded)', () => {
    const prev = fallingState();
    const next = stepMovement(prev, input(), DT, flat);
    expect(next.grounded).toBe(true);
    expect(landedDuringStep(prev, next)).toBe(true);
  });

  it('detects a buffered-jump landing even though grounded stays false', () => {
    // Buffer a jump while falling, then step across the ground: the core's
    // landing block fires the buffered jump, returning grounded=false.
    const prev = { ...fallingState(), jumpBuffer: MOVE.jumpBufferTime };
    const next = stepMovement(prev, input(), DT, flat);
    expect(next.grounded).toBe(false); // the trap this predicate exists for
    expect(next.vel.y).toBe(MOVE.jumpVel);
    expect(landedDuringStep(prev, next)).toBe(true);
  });

  it('is false while remaining airborne', () => {
    const prev = fallingState(50);
    const next = stepMovement(prev, input(), DT, flat);
    expect(next.grounded).toBe(false);
    expect(landedDuringStep(prev, next)).toBe(false);
  });

  it('is false while remaining airborne with a decaying, unfired jump buffer', () => {
    const prev = { ...fallingState(50), jumpBuffer: MOVE.jumpBufferTime };
    const next = stepMovement(prev, input(), DT, flat);
    expect(next.grounded).toBe(false);
    expect(landedDuringStep(prev, next)).toBe(false);
  });

  it('is false while staying grounded', () => {
    const grounded = stepMovement(fallingState(), input(), DT, flat);
    const next = stepMovement(grounded, input(), DT, flat);
    expect(landedDuringStep(grounded, next)).toBe(false);
  });

  it('detects a buffered-jump landing under float drift (epsilon compare)', () => {
    // A vy that differs from jumpVel by sub-epsilon float noise still counts as
    // the buffered-jump landing signature (guards against exact-equality drift).
    const prev = { ...fallingState(), jumpBuffer: MOVE.jumpBufferTime };
    const next: MoveState = { ...prev, grounded: false, jumpBuffer: 0, vel: { x: 0, y: MOVE.jumpVel + 1e-9, z: 0 } };
    expect(landedDuringStep(prev, next)).toBe(true);
  });

  it('detects landing via the air-dash reset signal', () => {
    // Synthetic pair mirroring the core's landing block: an air-dash charge
    // returning while both states read airborne.
    const prev = { ...fallingState(), airDashUsed: true };
    const next = { ...prev, airDashUsed: false };
    expect(landedDuringStep(prev, next)).toBe(true);
  });
});
