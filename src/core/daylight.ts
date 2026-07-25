import { DAYLIGHT } from './constants.ts';

/** Day phase identifier. */
export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

/** Sample of the day/night cycle at a moment in time. */
export interface DaylightSample {
  /** Current phase of the day/night cycle. */
  phase: DayPhase;
  /** Darkness level: 0 during day, smoothly ramping 0→1 during dusk, 1 during night, 1→0 during dawn. */
  darkness: number;
  /** Fractional position through the full cycle in [0,1). */
  cycleT: number;
}

/**
 * Smoothstep function: smooth Hermite interpolation from 0 to 1 as t goes from 0 to 1.
 * Matches the terrain.ts shape.
 */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Total seconds in one complete day/night cycle.
 */
export function cycleLength(): number {
  return DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS;
}

/**
 * Sample the day/night clock at time t (seconds since world start).
 * Returns the current phase, darkness level (0→1), and cycle fraction [0,1).
 * Time wraps automatically across cycles.
 */
export function daylightAt(t: number): DaylightSample {
  const len = cycleLength();
  const u = ((t % len) + len) % len;
  const cycleT = u / len;
  const d = DAYLIGHT;

  if (u < d.dayS) return { phase: 'day', darkness: 0, cycleT };
  if (u < d.dayS + d.duskS)
    return { phase: 'dusk', darkness: smooth((u - d.dayS) / d.duskS), cycleT };
  if (u < d.dayS + d.duskS + d.nightS) return { phase: 'night', darkness: 1, cycleT };
  return { phase: 'dawn', darkness: 1 - smooth((u - d.dayS - d.duskS - d.nightS) / d.dawnS), cycleT };
}
