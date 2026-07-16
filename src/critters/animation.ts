import { ANIM } from '../core/constants.ts';
import type { CritterParts } from './models.ts';

// Pure procedural critter animation: sinusoidal leg swing with alternating
// phase, a body bob, occasional idle head tilt, tail sway and wing flap for
// flyers. Everything is math on existing Object3D rotations/positions — no
// per-frame allocation. `t` is absolute time (s); `speed` is current ground
// speed (m/s) so amplitude/frequency scale with how fast the critter moves.
// All tuning coefficients live in constants.ts `ANIM` (project convention).
//
// Baselines captured on first touch (via a stashed __rest) so we offset from
// the model's authored rest pose rather than assuming zero.

interface Rest {
  __rest?: { rx: number; ry: number; rz: number; py: number };
}

function rest(o: { rotation: { x: number; y: number; z: number }; position: { y: number } } & Rest): {
  rx: number;
  ry: number;
  rz: number;
  py: number;
} {
  if (!o.__rest) {
    o.__rest = { rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, py: o.position.y };
  }
  return o.__rest;
}

/**
 * Advance one critter's pose. `dt` is accepted for API symmetry / future
 * spring damping but the current animation is a pure function of `t` and
 * `speed`, so it stays deterministic and stateless across frames. `speciesId`
 * selects per-species specials (the 16-leg prismhorse wave, the snickerdoodle
 * flop, the bumblewhale hover, gloomgobbler's stride); omit it for the generic
 * quadruped gait.
 */
export function animateCritter(
  parts: CritterParts,
  speed: number,
  t: number,
  _dt?: number,
  speciesId?: string,
): void {
  // Snickerdoodle moves by flipping over itself — a fully bespoke pose.
  if (speciesId === 'snickerdoodle') {
    animateSnickerdoodle(parts, speed, t);
    return;
  }

  const moving = speed > ANIM.movingThreshold;
  const capped = Math.min(speed, ANIM.speedCap);
  // Gait frequency & swing grow with speed but saturate so a sprint doesn't
  // turn into a blur.
  const freq = moving ? ANIM.gaitFreqBase + capped * ANIM.gaitFreqPerSpeed : ANIM.gaitFreqIdle;
  const swing = moving
    ? Math.min(ANIM.swingBase + speed * ANIM.swingPerSpeed, ANIM.swingMax)
    : 0;
  const phase = t * freq;

  // Legs.
  if (speciesId === 'prismhorse') {
    // Sixteen legs skitter as a phase-offset wave down each row: the legs array
    // is [left row ×8, right row ×8], so index-within-row drives the wave and
    // the two rows beat in antiphase for a shimmering scuttle.
    const amp = moving ? Math.max(ANIM.prismLegAmp, swing) : ANIM.prismLegAmp * 0.25;
    const wf = moving ? freq : ANIM.gaitFreqIdle;
    let li = 0;
    for (const leg of parts.legs) {
      const r = rest(leg);
      const row = li < 8 ? 0 : 1;
      const withinRow = li % 8;
      const p = t * wf + withinRow * ANIM.prismLegPhaseStep + row * Math.PI;
      leg.rotation.x = r.rx + Math.sin(p) * amp;
      li++;
    }
  } else if (speciesId === 'gloomgobbler') {
    // Two stilt legs take exaggerated, slow strides.
    const amp = moving ? ANIM.gloomStrideAmp : 0.08;
    const p = t * ANIM.gloomStrideFreq;
    let li = 0;
    for (const leg of parts.legs) {
      const r = rest(leg);
      leg.rotation.x = r.rx + Math.sin(p + (li % 2 === 0 ? 0 : Math.PI)) * amp;
      li++;
    }
  } else {
    // Legs: alternate diagonal phase (index parity) so it reads as a trot.
    let li = 0;
    for (const leg of parts.legs) {
      const r = rest(leg);
      const p = phase + (li % 2 === 0 ? 0 : Math.PI);
      leg.rotation.x = r.rx + Math.sin(p) * swing;
      li++;
    }
  }

  // Body: vertical bob at stride frequency when moving, a slow breathing bob
  // when idle. The bumblewhale hovers, so it always bobs gently and lazily.
  const b = rest(parts.body);
  if (speciesId === 'bumblewhale') {
    parts.body.position.y = b.py + Math.sin(t * ANIM.hoverBobFreq) * ANIM.hoverBobAmp;
    parts.body.rotation.z = Math.sin(t * ANIM.hoverBobFreq * 0.6) * 0.04; // faint list
  } else if (moving) {
    parts.body.position.y =
      b.py + Math.abs(Math.sin(phase)) * (ANIM.bobBase + speed * ANIM.bobPerSpeed);
  } else {
    parts.body.position.y = b.py + Math.sin(t * ANIM.idleBobFreq) * ANIM.idleBobAmp;
  }

  // Head: subtle bob while moving; occasional idle tilt/glance when still.
  const h = rest(parts.head);
  if (moving) {
    parts.head.rotation.x = h.rx + Math.sin(phase * 0.5) * ANIM.headBobAmp;
    parts.head.rotation.z = h.rz;
  } else {
    // Slow glance every few seconds.
    parts.head.rotation.z = h.rz + Math.sin(t * ANIM.glanceFreq) * ANIM.glanceAmp;
    parts.head.rotation.x = h.rx + Math.sin(t * ANIM.nodFreq + 1.3) * ANIM.nodAmp;
  }

  // Tail sway (about Y), gentle at rest, livelier while moving.
  if (parts.tail) {
    const ta = rest(parts.tail);
    const amp = moving ? ANIM.tailMoveAmp : ANIM.tailIdleAmp;
    parts.tail.rotation.y = ta.ry + Math.sin(phase * 0.5 + 0.5) * amp;
  }

  // Wings: flap about Z, fast, amplitude scaling with speed. Flyers idling on
  // the ground fold to rest; airborne flap is driven by the (>0) speed the
  // manager feeds in.
  if (parts.wings) {
    // Bumblewhale's flippers flap lazily; other flyers beat fast.
    const whale = speciesId === 'bumblewhale';
    const flapFreq = whale ? ANIM.whaleFlapFreq : ANIM.flapFreqBase + capped * ANIM.flapFreqPerSpeed;
    const flapAmp = whale
      ? ANIM.whaleFlapAmp
      : moving
        ? ANIM.flapAmpBase + capped * ANIM.flapAmpPerSpeed
        : ANIM.flapIdleAmp;
    const f = Math.sin(t * flapFreq) * flapAmp;
    let wi = 0;
    for (const wing of parts.wings) {
      const r = rest(wing);
      // Mirror the flap so left/right wings beat symmetrically upward.
      const side = wi === 0 ? 1 : -1;
      wing.rotation.z = r.rz + f * side;
      wi++;
    }
  }

  // Prismhorse antennae: sway gently and lag/sweep back with movement.
  if (parts.antennae) {
    const lag = -Math.min(speed, ANIM.speedCap) * ANIM.antennaLagPerSpeed;
    let ai = 0;
    for (const ant of parts.antennae) {
      const r = rest(ant);
      const side = ai === 0 ? 1 : -1;
      ant.rotation.x = r.rx + lag + Math.sin(t * ANIM.antennaSwayFreq) * ANIM.antennaSwayAmp;
      ant.rotation.z = r.rz + Math.sin(t * ANIM.antennaSwayFreq * 0.7 + ai) * ANIM.antennaSwayAmp * side;
      ai++;
    }
  }
}

/**
 * Snickerdoodle: a pancake cat that flops end-over-end to travel. Rotate the
 * whole body about X (perpendicular to +Z travel) by 180° each `flipPeriod`
 * while moving, with an eased tumble so each flop lands with a satisfying
 * settle; idle, it rests flat with a soft breathing bob.
 */
function animateSnickerdoodle(parts: CritterParts, speed: number, t: number): void {
  const b = rest(parts.body);
  const moving = speed > ANIM.movingThreshold;
  if (moving) {
    const phase = t / ANIM.flipPeriod;
    const n = Math.floor(phase);
    const frac = phase - n;
    // Ease the flip (smoothstep) so it snaps over then settles.
    const eased = frac * frac * (3 - 2 * frac);
    parts.body.rotation.x = b.rx + (n + eased) * Math.PI;
    // Little hop as it flips.
    parts.body.position.y = b.py + Math.sin(frac * Math.PI) * 0.12;
  } else {
    // Settle flat (nearest full rotation) with a gentle breathing bob.
    parts.body.rotation.x = b.rx;
    parts.body.position.y = b.py + Math.sin(t * ANIM.idleBobFreq) * ANIM.idleBobAmp;
  }
}
