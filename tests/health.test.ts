import { describe, expect, it } from 'vitest';
import { createHealth, applyHit, stepHealth, isDazed } from '../src/player/health.ts';
import { HEALTH } from '../src/core/constants.ts';

describe('health', () => {
  it('starts full and undazed', () => {
    const h = createHealth();
    expect(h.hp).toBe(HEALTH.max); expect(isDazed(h)).toBe(false);
  });
  it('hits subtract and reset regen delay', () => {
    let h = applyHit(createHealth(), 25);
    expect(h.hp).toBe(HEALTH.max - 25);
    h = stepHealth(h, HEALTH.regenDelayS - 0.1);
    expect(h.hp).toBe(HEALTH.max - 25);            // still waiting
    h = stepHealth(h, 1.1);                         // past delay, 1s of regen
    expect(h.hp).toBeGreaterThan(HEALTH.max - 25);
    expect(h.hp).toBeLessThanOrEqual(HEALTH.max);
  });
  it('regen clamps at max', () => {
    let h = applyHit(createHealth(), 5);
    h = stepHealth(h, HEALTH.regenDelayS + 100);
    expect(h.hp).toBe(HEALTH.max);
  });
  it('reaching 0 triggers daze; daze end refills to full', () => {
    let h = applyHit(createHealth(), HEALTH.max);
    expect(h.hp).toBe(0); expect(isDazed(h)).toBe(true);
    h = stepHealth(h, HEALTH.dazedS / 2);
    expect(isDazed(h)).toBe(true);
    h = stepHealth(h, HEALTH.dazedS);                // daze over
    expect(isDazed(h)).toBe(false); expect(h.hp).toBe(HEALTH.max);
  });
  it('hits during daze are ignored', () => {
    let h = applyHit(createHealth(), HEALTH.max);
    const before = h;
    h = applyHit(h, 25);
    expect(h).toEqual(before);
  });
});
