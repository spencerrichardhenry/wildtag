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
 * `speed`, so it stays deterministic and stateless across frames.
 */
export function animateCritter(
  parts: CritterParts,
  speed: number,
  t: number,
  _dt?: number,
): void {
  const moving = speed > ANIM.movingThreshold;
  const capped = Math.min(speed, ANIM.speedCap);
  // Gait frequency & swing grow with speed but saturate so a sprint doesn't
  // turn into a blur.
  const freq = moving ? ANIM.gaitFreqBase + capped * ANIM.gaitFreqPerSpeed : ANIM.gaitFreqIdle;
  const swing = moving
    ? Math.min(ANIM.swingBase + speed * ANIM.swingPerSpeed, ANIM.swingMax)
    : 0;
  const phase = t * freq;

  // Legs: alternate diagonal phase (index parity) so it reads as a trot.
  let li = 0;
  for (const leg of parts.legs) {
    const r = rest(leg);
    const p = phase + (li % 2 === 0 ? 0 : Math.PI);
    leg.rotation.x = r.rx + Math.sin(p) * swing;
    li++;
  }

  // Body: vertical bob at stride frequency when moving, a slow breathing bob
  // when idle.
  const b = rest(parts.body);
  if (moving) {
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
    const flapFreq = ANIM.flapFreqBase + capped * ANIM.flapFreqPerSpeed;
    const flapAmp = moving ? ANIM.flapAmpBase + capped * ANIM.flapAmpPerSpeed : ANIM.flapIdleAmp;
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
}
