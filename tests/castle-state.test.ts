import { describe, expect, it } from 'vitest';
import { purifySequenceSteps } from '../src/castle/state.ts';
import { shouldSpawnGoblins } from '../src/castle/goblins.ts';
import type { Vec3 } from '../src/core/types.ts';

// ---------------------------------------------------------------------------
// Pure castle-purify sequencing (Cursed Castle Task 14). No `three` import,
// no headless Scene needed — these exercise the plain decision/mapping
// functions `CastleSystem` (src/castle/system.ts) builds its effects from.
// ---------------------------------------------------------------------------

describe('purifySequenceSteps', () => {
  it('maps N goblin positions to N elf spawns, in order, at the same positions', () => {
    const positions: Vec3[] = [
      { x: 1, y: 0, z: 2 },
      { x: 3, y: 0, z: 4 },
      { x: 5, y: 0, z: 6 },
    ];
    const { elfSpawns } = purifySequenceSteps(positions);
    expect(elfSpawns.length).toBe(positions.length);
    expect(elfSpawns).toEqual(positions);
  });

  it('zero goblins maps to zero elf spawns', () => {
    expect(purifySequenceSteps([]).elfSpawns).toEqual([]);
  });

  it('returns fresh position objects, not references into the input array', () => {
    const positions: Vec3[] = [{ x: 1, y: 0, z: 2 }];
    const { elfSpawns } = purifySequenceSteps(positions);
    expect(elfSpawns[0]).not.toBe(positions[0]);
    expect(elfSpawns[0]).toEqual(positions[0]);
  });
});

describe('shouldSpawnGoblins', () => {
  it('is false once purified, even at dusk', () => {
    expect(shouldSpawnGoblins(true, 'dusk')).toBe(false);
  });

  it('is true at dusk while not purified', () => {
    expect(shouldSpawnGoblins(false, 'dusk')).toBe(true);
  });

  it('is false during the day while not purified', () => {
    expect(shouldSpawnGoblins(false, 'day')).toBe(false);
  });

  it('is true at night while not purified (presence, not just a dusk edge)', () => {
    expect(shouldSpawnGoblins(false, 'night')).toBe(true);
  });

  it('is false at night once purified', () => {
    expect(shouldSpawnGoblins(true, 'night')).toBe(false);
  });
});
