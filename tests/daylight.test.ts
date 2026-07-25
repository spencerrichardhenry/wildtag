import { describe, it, expect } from 'vitest';
import { daylightAt, cycleLength } from '../src/core/daylight.ts';
import { DAYLIGHT } from '../src/core/constants.ts';

describe('daylight clock', () => {
  it('cycle length is the sum of the four phases', () => {
    expect(cycleLength()).toBe(DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS);
  });
  it('starts in full day', () => {
    expect(daylightAt(0)).toMatchObject({ phase: 'day', darkness: 0 });
    expect(daylightAt(DAYLIGHT.dayS - 1).phase).toBe('day');
  });
  it('dusk ramps darkness 0 to 1 monotonically', () => {
    const mid = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS / 2);
    expect(mid.phase).toBe('dusk');
    expect(mid.darkness).toBeGreaterThan(0.3);
    expect(mid.darkness).toBeLessThan(0.7);
    const a = daylightAt(DAYLIGHT.dayS + 5).darkness;
    const b = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS - 5).darkness;
    expect(a).toBeLessThan(b);
  });
  it('night is fully dark, dawn ramps back down', () => {
    expect(daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS + 1)).toMatchObject({ phase: 'night', darkness: 1 });
    const dawnMid = daylightAt(DAYLIGHT.dayS + DAYLIGHT.duskS + DAYLIGHT.nightS + DAYLIGHT.dawnS / 2);
    expect(dawnMid.phase).toBe('dawn');
    expect(dawnMid.darkness).toBeGreaterThan(0.3);
    expect(dawnMid.darkness).toBeLessThan(0.7);
  });
  it('wraps across cycles', () => {
    expect(daylightAt(cycleLength() + 10)).toEqual(daylightAt(10));
    expect(daylightAt(3 * cycleLength()).phase).toBe('day');
  });
  it('cycleT spans [0,1)', () => {
    expect(daylightAt(0).cycleT).toBe(0);
    expect(daylightAt(cycleLength() / 2).cycleT).toBeCloseTo(0.5);
  });
});
