import { describe, expect, it } from 'vitest';
import { SPECIES, speciesById } from '../src/critters/species.ts';

// The binding species table (design spec §4 / Task 8 brief). These tracking
// params, awareness radii and flee styles are the contract other systems
// (tracking, AI, spawns) build on, so they are pinned verbatim here.
const TABLE = [
  { id: 'puffle', awareness: 8, fleeStyle: 'none', trackRadius: 12, trackTime: 8, rewardRP: 8, rewardSparks: 1 },
  { id: 'skitterling', awareness: 14, fleeStyle: 'sprint', trackRadius: 10, trackTime: 10, rewardRP: 10, rewardSparks: 1 },
  { id: 'bellowbuck', awareness: 10, fleeStyle: 'none', trackRadius: 15, trackTime: 14, rewardRP: 14, rewardSparks: 2 },
  { id: 'mirefin', awareness: 12, fleeStyle: 'swim', trackRadius: 14, trackTime: 12, rewardRP: 12, rewardSparks: 2 },
  { id: 'craghorn', awareness: 16, fleeStyle: 'ledge', trackRadius: 14, trackTime: 16, rewardRP: 18, rewardSparks: 3 },
  { id: 'zephyrfinch', awareness: 20, fleeStyle: 'fly', trackRadius: 18, trackTime: 15, rewardRP: 20, rewardSparks: 3 },
  { id: 'emberpup', awareness: 13, fleeStyle: 'zigzag', trackRadius: 11, trackTime: 14, rewardRP: 16, rewardSparks: 2 },
  { id: 'lumenstag', awareness: 35, fleeStyle: 'sprint', trackRadius: 20, trackTime: 25, rewardRP: 40, rewardSparks: 6 },
] as const;

describe('SPECIES roster', () => {
  it('has exactly 8 species', () => {
    expect(SPECIES).toHaveLength(8);
  });

  it('has unique ids', () => {
    const ids = SPECIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains exactly the roster ids', () => {
    expect(new Set(SPECIES.map((s) => s.id))).toEqual(new Set(TABLE.map((t) => t.id)));
  });

  it('speciesById returns the matching def, undefined for unknown', () => {
    for (const s of SPECIES) {
      expect(speciesById(s.id)).toBe(s);
    }
    expect(speciesById('nope')).toBeUndefined();
  });
});

describe('binding tracking params (spec §4 table)', () => {
  for (const row of TABLE) {
    it(`${row.id} matches the table`, () => {
      const s = speciesById(row.id);
      expect(s).toBeDefined();
      if (!s) return;
      expect(s.awareness).toBe(row.awareness);
      expect(s.fleeStyle).toBe(row.fleeStyle);
      expect(s.trackRadius).toBe(row.trackRadius);
      expect(s.trackTime).toBe(row.trackTime);
      expect(s.rewardRP).toBe(row.rewardRP);
      expect(s.rewardSparks).toBe(row.rewardSparks);
    });
  }
});

describe('data sanity', () => {
  it('all weights, times, radii and rewards are positive', () => {
    for (const s of SPECIES) {
      expect(s.rarity).toBeGreaterThan(0);
      expect(s.trackRadius).toBeGreaterThan(0);
      expect(s.trackTime).toBeGreaterThan(0);
      expect(s.rewardRP).toBeGreaterThan(0);
      expect(s.rewardSparks).toBeGreaterThan(0);
      expect(s.awareness).toBeGreaterThan(0);
    }
  });

  it('every species has at least one biome', () => {
    for (const s of SPECIES) {
      expect(s.biomes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('sizes are in (0, 3]', () => {
    for (const s of SPECIES) {
      expect(s.size).toBeGreaterThan(0);
      expect(s.size).toBeLessThanOrEqual(3);
    }
  });

  it('speeds are sane (walk positive, flee >= walk)', () => {
    for (const s of SPECIES) {
      expect(s.walkSpeed).toBeGreaterThan(0);
      expect(s.fleeSpeed).toBeGreaterThanOrEqual(s.walkSpeed);
    }
  });
});
