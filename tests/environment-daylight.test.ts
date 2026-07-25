import { describe, it, expect } from 'vitest';
import { lerpColorHex } from '../src/core/daylight.ts';

describe('lerpColorHex', () => {
  it('lerps color channels independently', () => {
    expect(lerpColorHex(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(lerpColorHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(lerpColorHex(0xff0000, 0x0000ff, 0.5)).toBe(0x7f007f);
  });

  it('clamps t outside [0,1]', () => {
    expect(lerpColorHex(0x000000, 0xffffff, -1)).toBe(0x000000);
    expect(lerpColorHex(0x000000, 0xffffff, 2)).toBe(0xffffff);
  });

  it('is a no-op when a equals b', () => {
    expect(lerpColorHex(0x336699, 0x336699, 0.5)).toBe(0x336699);
  });
});
