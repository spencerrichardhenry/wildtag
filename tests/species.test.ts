import { describe, expect, it } from 'vitest';
import { SPECIES, speciesById } from '../src/critters/species.ts';

// The binding species table (design spec §4 / Task 8 brief). These tracking
// params, awareness radii and flee styles are the contract other systems
// (tracking, AI, spawns) build on, so they are pinned verbatim here.
const TABLE = [
  { id: 'puffle', bold: false, rideable: false, awareness: 8, fleeStyle: 'none', trackRadius: 12, trackTime: 8, rewardRP: 8, rewardSparks: 1, farmRole: { kind: 'produce', resource: 'fiber', amount: 2 } },
  { id: 'skitterling', bold: false, rideable: false, awareness: 14, fleeStyle: 'sprint', trackRadius: 10, trackTime: 10, rewardRP: 10, rewardSparks: 1, farmRole: { kind: 'produce', resource: 'resin', amount: 2 } },
  { id: 'bellowbuck', bold: false, rideable: false, awareness: 10, fleeStyle: 'none', trackRadius: 15, trackTime: 14, rewardRP: 14, rewardSparks: 2, farmRole: { kind: 'produce', resource: 'fiber', amount: 4 } },
  { id: 'mirefin', bold: true, rideable: false, awareness: 12, fleeStyle: 'swim', trackRadius: 14, trackTime: 12, rewardRP: 12, rewardSparks: 2, farmRole: { kind: 'aura', auraPct: 25 } },
  { id: 'craghorn', bold: false, rideable: false, awareness: 16, fleeStyle: 'ledge', trackRadius: 14, trackTime: 16, rewardRP: 18, rewardSparks: 3, farmRole: { kind: 'produce', resource: 'shard', amount: 2 } },
  { id: 'zephyrfinch', bold: true, rideable: false, awareness: 20, fleeStyle: 'fly', trackRadius: 18, trackTime: 15, rewardRP: 20, rewardSparks: 3, farmRole: { kind: 'produce', resource: 'spark', amount: 1 } },
  { id: 'emberpup', bold: false, rideable: false, awareness: 13, fleeStyle: 'zigzag', trackRadius: 11, trackTime: 14, rewardRP: 16, rewardSparks: 2, farmRole: { kind: 'aura', auraPct: 25 } },
  { id: 'lumenstag', bold: false, rideable: false, awareness: 35, fleeStyle: 'sprint', trackRadius: 20, trackTime: 25, rewardRP: 40, rewardSparks: 6, farmRole: { kind: 'produce', resource: 'spark', amount: 2 } },
  { id: 'prismhorse', bold: true, rideable: true, awareness: 22, fleeStyle: 'sprint', trackRadius: 16, trackTime: 18, rewardRP: 34, rewardSparks: 5, farmRole: { kind: 'none' } },
  { id: 'bumblewhale', bold: true, rideable: false, awareness: 10, fleeStyle: 'fly', trackRadius: 14, trackTime: 20, rewardRP: 24, rewardSparks: 4, farmRole: { kind: 'aura', special: 'hopperCap' } },
  { id: 'snickerdoodle', bold: false, rideable: false, awareness: 12, fleeStyle: 'zigzag', trackRadius: 10, trackTime: 8, rewardRP: 9, rewardSparks: 1, farmRole: { kind: 'produce', resource: 'fiber', amount: 1, special: 'adjacencyDouble' } },
  { id: 'gloomgobbler', bold: false, rideable: false, awareness: 15, fleeStyle: 'sprint', trackRadius: 12, trackTime: 14, rewardRP: 17, rewardSparks: 3, farmRole: { kind: 'produce', resource: 'resin', amount: 3 } },
] as const;

describe('SPECIES roster', () => {
  it('has exactly 12 species', () => {
    expect(SPECIES).toHaveLength(12);
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
      expect(s.bold).toBe(row.bold);
      expect(s.rideable).toBe(row.rideable);
      expect(s.farmRole).toEqual(row.farmRole);
    });
  }
});

describe('farm roles + rideable (spec §4/§5)', () => {
  it('every species has a farmRole with a valid kind', () => {
    for (const s of SPECIES) {
      expect(s.farmRole).toBeDefined();
      expect(['produce', 'aura', 'none']).toContain(s.farmRole.kind);
    }
  });

  it('produce roles carry a resource + positive amount; none/aura do not produce', () => {
    for (const s of SPECIES) {
      if (s.farmRole.kind === 'produce') {
        expect(s.farmRole.resource).toBeDefined();
        expect(s.farmRole.amount).toBeGreaterThan(0);
      }
    }
  });

  it('exactly one rideable species (the prismhorse)', () => {
    const rideable = SPECIES.filter((s) => s.rideable);
    expect(rideable.map((s) => s.id)).toEqual(['prismhorse']);
  });

  it('the sole rideable species has no farm job', () => {
    expect(speciesById('prismhorse')?.farmRole.kind).toBe('none');
  });

  it('exactly one hopperCap-aura species (the bumblewhale)', () => {
    const hopper = SPECIES.filter((s) => s.farmRole.special === 'hopperCap');
    expect(hopper.map((s) => s.id)).toEqual(['bumblewhale']);
  });

  it('exactly one adjacencyDouble producer (the snickerdoodle)', () => {
    const adj = SPECIES.filter((s) => s.farmRole.special === 'adjacencyDouble');
    expect(adj.map((s) => s.id)).toEqual(['snickerdoodle']);
  });
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
