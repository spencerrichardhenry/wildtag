// tests/tiny-tide-core/camera.test.ts — owner 2026-10-03 (combat 3a follow-up F1): the play camera follows 20 % farther at sizes 0 and 1.
import { describe, expect, it } from 'vitest';
import { EARLY_FOLLOW_SCALE, followDistance, followScaleStep, followScaleTarget } from '../../src/tiny-tide/biomes';

describe('play camera follow distance', () => {
  it('is 20 % farther at sizes 0 and 1 and unchanged at sizes 2 to 4', () => {
    expect(EARLY_FOLLOW_SCALE).toBe(1.2);
    for (const stage of [0, 1]) expect(followScaleTarget(stage)).toBe(1.2);
    for (const stage of [2, 3, 4]) expect(followScaleTarget(stage)).toBe(1);
  });
  it('keeps the old base distances (desktop 9, portrait 10.5) times the scale', () => {
    expect(followDistance(16 / 9, 1)).toBe(9);
    expect(followDistance(320 / 568, 1)).toBe(10.5);
    expect(followDistance(16 / 9, 1.2)).toBeCloseTo(10.8, 10);
    expect(followDistance(320 / 568, 1.2)).toBeCloseTo(12.6, 10);
  });
  it('a QA override (`?qaFollowScale=<n>`) replaces the size target', () => {
    expect(followScaleTarget(0, 1)).toBe(1); expect(followScaleTarget(3, 1.5)).toBe(1.5); expect(followScaleTarget(0, null)).toBe(1.2);
  });
  it('eases the scale when the size changes (no jump), and reaches the target', () => {
    let s = 1.2; const xs: number[] = [];
    for (let i = 0; i < 240; i++) { s = followScaleStep(s, followScaleTarget(2), 1 / 60); xs.push(s); }
    expect(xs[0]!).toBeGreaterThan(1.19);                      // one frame moves a little
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1]! - xs[i]!).toBeLessThan(.01);
    expect(xs.at(-1)!).toBeCloseTo(1, 2);                     // within 4 s
    expect(followScaleStep(1, 1.2, 0)).toBe(1);                // no time, no change
  });
});
