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
 * Lerp two 0xRRGGBB hex colors channel-independently, t clamped to [0,1].
 * Pure integer math (no `three` dependency) so it's cheap to unit-test and
 * safe to import from non-jsdom vitest runs; `world/environment.ts` re-uses
 * it to blend the sky dome / fog / sun+hemi colors toward the night palette.
 */
export function lerpColorHex(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.floor(ar + (br - ar) * u);
  const g = Math.floor(ag + (bg - ag) * u);
  const bl = Math.floor(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | bl;
}

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
