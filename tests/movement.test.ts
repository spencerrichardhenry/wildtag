import { describe, expect, it } from 'vitest';
import { MOVE } from '../src/core/constants.ts';
import type { GroundQuery, MoveInput, MoveState, Vec3 } from '../src/core/types.ts';
import { drainStamina, initialMoveState, stepMovement } from '../src/player/movement.ts';

// Yaw convention (three.js camera): yaw = 0 faces -Z.
// facing = (-sin yaw, 0, -cos yaw); right = (cos yaw, 0, -sin yaw).

const DT = 1 / 60;

const flat: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

/** Ground with a bottomless hole everywhere — used to knock a grounded state airborne. */
const hole: GroundQuery = {
  heightAt: () => -1000,
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

function steps(
  s: MoveState,
  partial: Partial<MoveInput>,
  n: number,
  g: GroundQuery = flat,
): MoveState {
  const inp = input(partial);
  for (let i = 0; i < n; i++) s = stepMovement(s, inp, DT, g);
  return s;
}

function planarSpeed(s: MoveState): number {
  return Math.hypot(s.vel.x, s.vel.z);
}

/** A state standing on flat ground at the origin. */
function groundedState(pos: Vec3 = { x: 0, y: 0, z: 0 }): MoveState {
  // Settle one step so grounding is established by the sim itself.
  return steps(initialMoveState(pos), {}, 1);
}

describe('initialMoveState', () => {
  it('starts with full stamina, normal mode, zero velocity', () => {
    const s = initialMoveState({ x: 1, y: 2, z: 3 });
    expect(s.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(s.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.stamina).toBe(MOVE.staminaMax);
    expect(s.exhausted).toBe(false);
    expect(s.mode).toBe('normal');
    expect(s.airDashUsed).toBe(false);
    expect(s.airRocketUsed).toBe(false);
  });
});

describe('purity', () => {
  it('does not mutate the input state', () => {
    const s = groundedState();
    const snapshot = JSON.parse(JSON.stringify(s));
    stepMovement(s, input({ forward: 1, sprint: true, jump: true, dash: true }), DT, flat);
    expect(s).toEqual(snapshot);
  });

  it('returns a new object with fresh vectors', () => {
    const s = groundedState();
    const out = stepMovement(s, input(), DT, flat);
    expect(out).not.toBe(s);
    expect(out.pos).not.toBe(s.pos);
    expect(out.vel).not.toBe(s.vel);
  });
});

describe('walking / sprint / stamina', () => {
  it('accelerates toward walk speed and caps there', () => {
    let s = groundedState();
    s = steps(s, { forward: 1 }, 60);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.walk, 3);
    // Yaw 0, forward → -Z.
    expect(s.vel.z).toBeCloseTo(-MOVE.walk, 3);
    expect(Math.abs(s.vel.x)).toBeLessThan(1e-9);
  });

  it('ramps up at accelGround (not instantly)', () => {
    let s = groundedState();
    s = steps(s, { forward: 1 }, 1);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.accelGround * DT, 3);
    expect(planarSpeed(s)).toBeLessThan(MOVE.walk);
  });

  it('normalizes diagonal intent (no speed boost)', () => {
    let s = groundedState();
    s = steps(s, { forward: 1, strafe: 1 }, 60);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.walk, 3);
  });

  it('moves along yaw-rotated intent', () => {
    let s = groundedState();
    // yaw = -PI/2 faces +X in the three.js convention.
    s = steps(s, { forward: 1, yaw: -Math.PI / 2 }, 60);
    expect(s.vel.x).toBeCloseTo(MOVE.walk, 3);
    expect(Math.abs(s.vel.z)).toBeLessThan(1e-6);
  });

  it('applies ground friction toward zero when there is no intent', () => {
    let s = groundedState();
    s = steps(s, { forward: 1 }, 60);
    s = steps(s, {}, 60);
    expect(planarSpeed(s)).toBeCloseTo(0, 3);
  });

  it('sprint reaches 9.5 and drains stamina at 10/s', () => {
    let s = groundedState();
    s = steps(s, { forward: 1, sprint: true }, 60);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.sprint, 3);
    expect(s.stamina).toBeCloseTo(MOVE.staminaMax - MOVE.sprintDrain * 1, 1);
  });

  it('does not drain stamina when sprint is held but not moving', () => {
    let s = groundedState();
    s = steps(s, { sprint: true }, 60);
    expect(s.stamina).toBe(MOVE.staminaMax);
  });

  it('regens at 22/s only after the 0.8s delay', () => {
    let s = groundedState();
    s = steps(s, { forward: 1, sprint: true }, 180); // 3s sprint → ~70
    const afterSprint = s.stamina;
    expect(afterSprint).toBeCloseTo(70, 1);
    // During the regen delay nothing comes back.
    s = steps(s, {}, Math.round(MOVE.regenDelay / DT) - 1);
    expect(s.stamina).toBeCloseTo(afterSprint, 1);
    // One second after the delay, ~22 has regenerated.
    s = steps(s, {}, 60 + 1);
    expect(s.stamina).toBeCloseTo(afterSprint + MOVE.regenRate, 0);
  });

  it('regen caps at staminaMax', () => {
    let s = groundedState();
    s = steps(s, { forward: 1, sprint: true }, 30);
    s = steps(s, {}, 600);
    expect(s.stamina).toBe(MOVE.staminaMax);
  });
});

describe('exhaustion', () => {
  it('sets exhausted below 1 stamina and blocks sprint bonus until 20', () => {
    let s: MoveState = { ...groundedState(), stamina: 0.5 };
    s = steps(s, { forward: 1 }, 1);
    expect(s.exhausted).toBe(true);
    // Walk still allowed while exhausted; sprint bonus is not.
    // (30 steps keeps regen below the 20-stamina exit threshold.)
    s = steps(s, { forward: 1, sprint: true }, 30);
    expect(s.exhausted).toBe(true);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.walk, 3);
    // No sprint drain while exhausted → regen has been running.
    expect(s.stamina).toBeGreaterThan(0.5);
  });

  it('clears exhausted only once stamina reaches 20', () => {
    let s: MoveState = { ...groundedState(), stamina: 0.5 };
    s = steps(s, {}, 1);
    expect(s.exhausted).toBe(true);
    // Regen up to just below the exit threshold: still exhausted.
    while (s.stamina < MOVE.exhaustExitAbove - 1) s = steps(s, {}, 1);
    expect(s.exhausted).toBe(true);
    while (s.stamina < MOVE.exhaustExitAbove) s = steps(s, {}, 1);
    s = steps(s, {}, 1);
    expect(s.exhausted).toBe(false);
  });

  it('exhausted blocks dash and rocket (ability check reads incoming flag)', () => {
    const s: MoveState = { ...groundedState(), stamina: 50, exhausted: true };
    const afterDash = stepMovement(s, input({ dash: true }), DT, flat);
    expect(afterDash.dashTime).toBe(0);
    expect(planarSpeed(afterDash)).toBeLessThan(1);
    const afterRocket = stepMovement(s, input({ rocket: true }), DT, flat);
    expect(afterRocket.vel.y).toBeLessThanOrEqual(0);
    expect(afterRocket.stamina).toBeGreaterThanOrEqual(50);
  });
});

describe('dash', () => {
  it('sets planar speed 18 along facing, costs 25, starts cooldown', () => {
    let s = groundedState();
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBeGreaterThan(0);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.dashSpeed, 3);
    expect(s.vel.z).toBeCloseTo(-MOVE.dashSpeed, 3); // yaw 0 → -Z
    expect(s.stamina).toBeCloseTo(MOVE.staminaMax - MOVE.dashCost, 1);
    expect(s.dashCooldown).toBeGreaterThan(0);
  });

  it('holds dash speed for the duration, then decays toward walk target', () => {
    let s = groundedState();
    s = steps(s, { dash: true }, 1);
    // Still dashing partway through the 0.18s window.
    s = steps(s, {}, 8);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.dashSpeed, 3);
    // Well past the window: friction has pulled speed below dash speed.
    s = steps(s, {}, 30);
    expect(s.dashTime).toBe(0);
    expect(planarSpeed(s)).toBeLessThan(MOVE.dashSpeed - 1);
  });

  it('rejects a second dash during cooldown, allows it after', () => {
    let s = groundedState();
    s = steps(s, { dash: true }, 1);
    s = steps(s, {}, 12); // ~0.2s: dash over, cooldown (0.6s) still running
    const during = s.stamina;
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBe(0); // rejected
    expect(s.stamina).toBeGreaterThanOrEqual(during); // no second cost
    s = steps(s, {}, 40); // past 0.6s total
    const before = s.stamina;
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBeGreaterThan(0); // accepted
    expect(s.stamina).toBeCloseTo(before - MOVE.dashCost, 1);
  });

  it('rejects dash when stamina < cost', () => {
    let s: MoveState = { ...groundedState(), stamina: 10 };
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBe(0);
    expect(planarSpeed(s)).toBeLessThan(1);
  });

  it('skips gravity while dashing', () => {
    // Airborne dash: y must not drop during the dash window.
    let s: MoveState = { ...initialMoveState({ x: 0, y: 50, z: 0 }) };
    s = steps(s, { dash: true }, 1);
    const y0 = s.pos.y;
    s = steps(s, {}, 8);
    expect(s.pos.y).toBeCloseTo(y0, 6);
    expect(s.vel.y).toBeCloseTo(0, 6);
  });

  it('allows air dash once per airtime; landing resets it', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 30, z: 0 });
    s = steps(s, {}, 1);
    expect(s.grounded).toBe(false);
    s = steps(s, { dash: true }, 1);
    expect(s.airDashUsed).toBe(true);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.dashSpeed, 3);
    s = steps(s, {}, 60); // dash + cooldown elapse, still falling afterwards
    expect(s.grounded).toBe(false);
    const before = s.stamina;
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBe(0); // second air dash blocked
    expect(s.stamina).toBeGreaterThanOrEqual(before);
    // Fall to ground → reset.
    while (!s.grounded) s = steps(s, {}, 1);
    expect(s.airDashUsed).toBe(false);
    const beforeGround = s.stamina;
    s = steps(s, { dash: true }, 1);
    expect(s.dashTime).toBeGreaterThan(0);
    expect(s.stamina).toBeCloseTo(beforeGround - MOVE.dashCost, 1);
  });
});

describe('jump / coyote / buffer', () => {
  it('jumps from ground with vy = jumpVel', () => {
    let s = groundedState();
    s = steps(s, { jump: true }, 1);
    expect(s.grounded).toBe(false);
    // Takeoff velocity minus one step of gravity.
    expect(s.vel.y).toBeCloseTo(MOVE.jumpVel + MOVE.gravity * DT, 3);
  });

  it('gains coyote time when walking off a ledge and can jump 0.1s later', () => {
    let s = groundedState();
    // Ground vanishes under the player: airborne without jumping.
    s = steps(s, {}, 1, hole);
    expect(s.grounded).toBe(false);
    expect(s.coyote).toBeCloseTo(MOVE.coyoteTime, 5);
    s = steps(s, {}, 5, hole); // +0.083s airborne
    s = steps(s, { jump: true }, 1, hole); // jump at ~0.1s
    expect(s.vel.y).toBeGreaterThan(MOVE.jumpVel - 1);
  });

  it('cannot coyote-jump after 0.15s', () => {
    let s = groundedState();
    s = steps(s, {}, 1, hole);
    s = steps(s, {}, 8, hole); // 9 steps = 0.15s airborne
    s = steps(s, { jump: true }, 1, hole);
    expect(s.vel.y).toBeLessThan(0);
    expect(s.grounded).toBe(false);
  });

  it('does not grant coyote when leaving the ground by jumping', () => {
    let s = groundedState();
    s = steps(s, { jump: true }, 1);
    expect(s.coyote).toBe(0);
  });

  it('buffers a jump pressed ~0.1s before landing and fires it on land', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 1, z: 0 });
    // Free fall from 1m lands at ~0.29s (~17 steps). Press jump at step 13.
    s = steps(s, {}, 13);
    expect(s.grounded).toBe(false);
    s = steps(s, { jump: true }, 1);
    expect(s.grounded).toBe(false);
    expect(s.jumpBuffer).toBeGreaterThan(0);
    // Keep falling; the buffered jump should fire the moment we land.
    for (let i = 0; i < 20 && s.vel.y <= 0; i++) s = steps(s, {}, 1);
    expect(s.vel.y).toBeGreaterThan(0);
    expect(s.grounded).toBe(false);
  });

  it('expires the buffer if landing comes too late', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 3, z: 0 });
    s = steps(s, {}, 1);
    s = steps(s, { jump: true }, 1); // pressed ~0.47s before landing
    for (let i = 0; i < 120 && !s.grounded; i++) s = steps(s, {}, 1);
    expect(s.grounded).toBe(true);
    expect(s.vel.y).toBe(0);
  });
});

describe('gravity and ground snap', () => {
  it('integrates gravity and lands on heightAt with grounded=true', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 5, z: 0 });
    s = steps(s, {}, 1);
    expect(s.vel.y).toBeCloseTo(MOVE.gravity * DT, 5);
    expect(s.grounded).toBe(false);
    s = steps(s, {}, 120);
    expect(s.grounded).toBe(true);
    expect(s.pos.y).toBe(0);
    expect(s.vel.y).toBe(0);
  });

  it('snaps to non-zero terrain height', () => {
    const bumpy: GroundQuery = {
      heightAt: () => 2.5,
      normalAt: () => ({ x: 0, y: 1, z: 0 }),
    };
    let s: MoveState = initialMoveState({ x: 0, y: 10, z: 0 });
    s = steps(s, {}, 180, bumpy);
    expect(s.pos.y).toBe(2.5);
    expect(s.grounded).toBe(true);
  });
});

describe('glide', () => {
  it('clamps vy to the sink rate and never rises across 3s of glide', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 500, z: 0 });
    s = steps(s, {}, 60); // fall 1s: vy ≈ -24, well below sink rate
    expect(s.vel.y).toBeLessThan(MOVE.glideSink);
    const eps = 1e-6;
    const inp = input({ jumpHeld: true });
    for (let i = 0; i < 180; i++) {
      s = stepMovement(s, inp, DT, flat);
      expect(s.gliding).toBe(true);
      expect(s.vel.y).toBeLessThanOrEqual(MOVE.glideSink + eps);
      expect(s.vel.y).toBeLessThan(0);
    }
  });

  it('converges down to the sink rate on slow-fall entry, never above it after', () => {
    let s: MoveState = { ...initialMoveState({ x: 0, y: 500, z: 0 }), vel: { x: 0, y: -0.1, z: 0 } };
    const inp = input({ jumpHeld: true });
    let prev = s.vel.y;
    for (let i = 0; i < 60; i++) {
      s = stepMovement(s, inp, DT, flat);
      expect(s.vel.y).toBeLessThanOrEqual(prev + 1e-9); // never increases
      expect(s.vel.y).toBeGreaterThanOrEqual(MOVE.glideSink - 1e-9); // floored at sink
      prev = s.vel.y;
    }
    expect(s.vel.y).toBeCloseTo(MOVE.glideSink, 5);
  });

  it('drives horizontal speed toward glideForward along facing', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 500, z: 0 });
    s = steps(s, {}, 30);
    s = steps(s, { jumpHeld: true, forward: 1 }, 180);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.glideForward, 1);
    expect(s.vel.z).toBeLessThan(0); // yaw 0 faces -Z
  });

  it('ends glide on release and on landing', () => {
    let s: MoveState = initialMoveState({ x: 0, y: 100, z: 0 });
    s = steps(s, {}, 30);
    s = steps(s, { jumpHeld: true }, 30);
    expect(s.gliding).toBe(true);
    const released = steps(s, {}, 1);
    expect(released.gliding).toBe(false);
    expect(released.vel.y).toBeLessThan(MOVE.glideSink); // gravity resumes
    let landing = s;
    while (!landing.grounded) landing = steps(landing, { jumpHeld: true }, 1);
    expect(landing.gliding).toBe(false);
  });

  it('does not glide while rising', () => {
    let s = groundedState();
    s = steps(s, { jump: true, jumpHeld: true }, 1);
    s = steps(s, { jumpHeld: true }, 5);
    expect(s.vel.y).toBeGreaterThan(0);
    expect(s.gliding).toBe(false);
  });
});

describe('rocket', () => {
  it('adds +14 vy and +4 forward, costs 40, starts 4s cooldown', () => {
    let s = groundedState();
    s = steps(s, { rocket: true }, 1);
    expect(s.vel.y).toBeGreaterThan(MOVE.rocketImpulseY - 1);
    expect(s.vel.z).toBeCloseTo(-MOVE.rocketImpulseFwd, 1); // facing -Z at yaw 0
    expect(s.stamina).toBeCloseTo(MOVE.staminaMax - MOVE.rocketCost, 1);
    expect(s.rocketCooldown).toBeGreaterThan(3.9);
    expect(s.grounded).toBe(false);
  });

  it('blocks a second rocket during the 4s cooldown even after landing', () => {
    let s = groundedState();
    s = steps(s, { rocket: true }, 1);
    while (!s.grounded) s = steps(s, {}, 1);
    const stam = s.stamina;
    s = steps(s, { rocket: true }, 1); // cooldown still running
    expect(s.stamina).toBeGreaterThanOrEqual(stam); // no drain (regen may add)
    expect(s.vel.y).toBeLessThanOrEqual(0);
    expect(s.rocketCooldown).toBeGreaterThan(0);
  });

  it('allows at most one rocket per airtime', () => {
    let s: MoveState = { ...initialMoveState({ x: 0, y: 200, z: 0 }), rocketCooldown: 0 };
    s = steps(s, {}, 1);
    s = steps(s, { rocket: true }, 1);
    expect(s.airRocketUsed).toBe(true);
    const stam = s.stamina;
    // Force cooldown elapsed while still airborne, second rocket still blocked.
    s = { ...s, rocketCooldown: 0, stamina: 100 };
    s = steps(s, { rocket: true }, 1);
    expect(s.stamina).toBeCloseTo(100, 1);
    expect(stam).toBeCloseTo(MOVE.staminaMax - MOVE.rocketCost, 1);
  });

  it('rejects rocket when stamina < cost', () => {
    let s: MoveState = { ...groundedState(), stamina: 30 };
    s = steps(s, { rocket: true }, 1);
    expect(s.vel.y).toBeLessThanOrEqual(0);
    expect(s.stamina).toBeGreaterThanOrEqual(30); // not drained
    expect(s.stamina).toBeLessThan(31);
  });
});

describe('swim mode', () => {
  it('halves target speed, holds y, and ignores jump/dash/rocket', () => {
    let s: MoveState = { ...initialMoveState({ x: 0, y: -0.5, z: 0 }), mode: 'swim' };
    const deep: GroundQuery = { heightAt: () => -10, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
    s = steps(s, { forward: 1 }, 120, deep);
    expect(planarSpeed(s)).toBeCloseTo(MOVE.walk / 2, 2);
    expect(s.pos.y).toBe(-0.5);
    expect(s.vel.y).toBe(0);
    const stam = s.stamina;
    s = steps(s, { jump: true, dash: true, rocket: true, jumpHeld: true }, 1, deep);
    expect(s.vel.y).toBe(0);
    expect(s.pos.y).toBe(-0.5);
    expect(s.dashTime).toBe(0);
    expect(s.stamina).toBeCloseTo(stam, 1);
  });
});

describe('drainStamina helper', () => {
  it('drains, resets the regen delay, and can trigger exhaustion', () => {
    const s = groundedState();
    const drained = drainStamina(s, 30);
    expect(drained).not.toBe(s);
    expect(drained.stamina).toBeCloseTo(70, 5);
    expect(drained.staminaRegenDelay).toBeCloseTo(MOVE.regenDelay, 5);
    const wiped = drainStamina(s, 100);
    expect(wiped.stamina).toBe(0);
    expect(wiped.exhausted).toBe(true);
  });
});

describe('determinism', () => {
  it('identical state + input sequences produce identical results', () => {
    const script: Partial<MoveInput>[] = [];
    for (let i = 0; i < 600; i++) {
      script.push({
        forward: Math.sin(i * 0.05),
        strafe: Math.cos(i * 0.11),
        yaw: i * 0.01,
        sprint: i % 7 < 3,
        jump: i % 40 === 0,
        jumpHeld: i % 40 < 20,
        dash: i % 90 === 0,
        rocket: i % 130 === 0,
      });
    }
    const run = () => {
      let s = initialMoveState({ x: 0, y: 2, z: 0 });
      for (const p of script) s = stepMovement(s, input(p), DT, flat);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('no-hover property', () => {
  it('airborne jumpHeld + rocket + dash spam cannot sustain altitude: strictly decreasing envelope after apex', () => {
    let s: MoveState = { ...initialMoveState({ x: 0, y: 200, z: 0 }), rocketCooldown: 0 };
    const ys: number[] = [];
    for (let i = 0; i < 600; i++) {
      // Glide held the whole time, rocket edge re-pressed every step, dash
      // edge every ~0.7s (past the 0.6s cooldown) — covers the
      // dash-skips-gravity interaction: only one air dash/rocket can fire
      // per airtime, so nothing sustains altitude after the apex.
      s = stepMovement(
        s,
        input({ jumpHeld: true, rocket: true, forward: 1, dash: i % 42 === 0 }),
        DT,
        flat,
      );
      ys.push(s.pos.y);
      if (s.grounded) break;
    }
    // Find the apex (after the single allowed air rocket). vy passes through
    // exactly 0 for one step at the ballistic peak, so take the LAST sample
    // attaining the max height as the apex.
    let apex = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i] >= ys[apex]) apex = i;
    // … and require strictly decreasing altitude ever after: no hover, no re-ascent.
    for (let i = apex + 1; i < ys.length; i++) {
      expect(ys[i]).toBeLessThan(ys[i - 1]);
    }
    // The envelope actually loses meaningful height over the window.
    expect(ys[ys.length - 1]).toBeLessThan(ys[apex] - 5);
  });
});
