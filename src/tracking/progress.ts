import { TRACKING } from '../core/constants.ts';
import type { SpeciesDef } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure tag-tracking progress accrual (Task 10). Once a critter is tagged, the
// player Links it by keeping it inside the species' trackRadius for a
// cumulative trackTime. Progress accrues at the real rate (+dt) while the
// critter is inside the ring and decays at TRACKING.trackDecayFactor of that
// rate while outside, so a brief loss of proximity is forgiving but a fleeing
// critter slips away. Clamped to [0, trackTime]. No three, no DOM —
// trivially unit-testable.
// ---------------------------------------------------------------------------

/**
 * Advance tracking `progress` (s) by one step. `dist` is the current
 * player↔critter distance (m); inside `sp.trackRadius` progress rises by `dt`,
 * outside it falls by `dt × TRACKING.trackDecayFactor`. Result is clamped to
 * `[0, sp.trackTime]`.
 */
export function stepTracking(
  progress: number,
  dist: number,
  dt: number,
  sp: SpeciesDef,
): number {
  const delta = dist <= sp.trackRadius ? dt : -dt * TRACKING.trackDecayFactor;
  const next = progress + delta;
  if (next < 0) return 0;
  if (next > sp.trackTime) return sp.trackTime;
  return next;
}

/** True once accrued `progress` (s) reaches the species' `trackTime`. */
export function isComplete(progress: number, sp: SpeciesDef): boolean {
  return progress >= sp.trackTime;
}
