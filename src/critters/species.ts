// The game's cast: 12 procedural blocky critters (8 phase-1 + 4 Haven whimsy).
// This module is pure *content*
// (data only) — the tracking params (trackRadius R / trackTime T, awareness,
// fleeStyle) are binding per the design spec §4 and the Task 8 brief and are
// asserted verbatim in tests/species.test.ts. Models/animation live alongside
// in models.ts / animation.ts; the manager (Task 9) consumes `rarity` weights.

import type { SpeciesDef } from '../core/types.ts';

/**
 * All 8 species, ordered by difficulty (meadow starters → endgame trophy).
 *
 * - `walkSpeed` / `fleeSpeed` (m/s): grazing wander vs. panic flight. The
 *   bellowbuck "never flees" — it just strides fast, so its flee == walk.
 *   The zephyrfinch flees by flying; the mirefin by swimming.
 * - `awareness` (m): radius at which a critter notices the player and alerts.
 * - `fleeStyle`: how it escapes once alerted (drives Task 9 steering).
 * - `trackRadius` (m) / `trackTime` (s): the tag ring — stay within R for a
 *   cumulative T seconds to Link it.
 * - `rarity`: relative spawn weight. Meadow starters are common (~1); the
 *   lumenstag is effectively unique world-wide (Task 9 caps concurrency).
 */
export const SPECIES: SpeciesDef[] = [
  {
    id: 'puffle',
    bold: false,
    name: 'Puffle',
    biomes: ['meadow'],
    size: 0.5,
    walkSpeed: 1.6,
    fleeSpeed: 6,
    awareness: 8,
    fleeStyle: 'none',
    trackRadius: 12,
    trackTime: 8,
    rarity: 1.0,
    rewardSparks: 1,
    rewardRP: 8,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'fiber', amount: 2 },
  },
  {
    id: 'skitterling',
    bold: false,
    name: 'Skitterling',
    biomes: ['meadow', 'forest'],
    size: 0.45,
    walkSpeed: 2.5,
    fleeSpeed: 9,
    awareness: 14,
    fleeStyle: 'sprint',
    trackRadius: 10,
    trackTime: 10,
    rarity: 0.9,
    rewardSparks: 1,
    rewardRP: 10,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'resin', amount: 2 },
  },
  {
    id: 'bellowbuck',
    bold: false,
    name: 'Bellowbuck',
    biomes: ['forest'],
    size: 2.2,
    walkSpeed: 5.5,
    // Intentional exception to the 6-11 flee band: the bellowbuck never
    // panics (fleeStyle 'none'), it just keeps striding at its fast walk.
    fleeSpeed: 5.5,
    awareness: 10,
    fleeStyle: 'none',
    trackRadius: 15,
    trackTime: 14,
    rarity: 0.5,
    rewardSparks: 2,
    rewardRP: 14,
    rideable: false,
    // Tall, proud strider — anchor the ring above the antlered head, not the back.
    ringHeight: 3.4,
    farmRole: { kind: 'produce', resource: 'fiber', amount: 4 },
  },
  {
    id: 'mirefin',
    bold: true,
    name: 'Mirefin',
    biomes: ['wetland', 'water'],
    size: 0.9,
    walkSpeed: 2.2,
    fleeSpeed: 7,
    awareness: 12,
    fleeStyle: 'swim',
    trackRadius: 14,
    trackTime: 12,
    rarity: 0.5,
    rewardSparks: 2,
    rewardRP: 12,
    rideable: false,
    farmRole: { kind: 'aura', auraPct: 25 },
  },
  {
    id: 'craghorn',
    bold: false,
    name: 'Craghorn',
    biomes: ['crags'],
    size: 1.3,
    walkSpeed: 2.4,
    fleeSpeed: 7.5,
    awareness: 16,
    fleeStyle: 'ledge',
    trackRadius: 14,
    trackTime: 16,
    rarity: 0.4,
    rewardSparks: 3,
    rewardRP: 18,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'shard', amount: 2 },
  },
  {
    id: 'zephyrfinch',
    bold: true,
    name: 'Zephyrfinch',
    biomes: ['meadow', 'forest', 'highlands'],
    size: 0.4,
    walkSpeed: 3.5,
    fleeSpeed: 10,
    awareness: 20,
    fleeStyle: 'fly',
    trackRadius: 18,
    trackTime: 15,
    rarity: 0.4,
    rewardSparks: 3,
    rewardRP: 20,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'spark', amount: 1 },
  },
  {
    id: 'emberpup',
    bold: false,
    name: 'Emberpup',
    biomes: ['highlands'],
    size: 0.8,
    walkSpeed: 3.0,
    fleeSpeed: 10.5,
    awareness: 13,
    fleeStyle: 'zigzag',
    trackRadius: 11,
    trackTime: 14,
    rarity: 0.35,
    rewardSparks: 2,
    rewardRP: 16,
    rideable: false,
    farmRole: { kind: 'aura', auraPct: 25 },
  },
  {
    id: 'lumenstag',
    bold: false,
    name: 'Lumen Stag',
    biomes: ['forest', 'highlands', 'crags'],
    size: 2.0,
    walkSpeed: 3.0,
    fleeSpeed: 11,
    awareness: 35,
    fleeStyle: 'sprint',
    trackRadius: 20,
    trackTime: 25,
    rarity: 0.02, // effectively unique — ~1 concurrent world-wide
    rewardSparks: 6,
    rewardRP: 40,
    rideable: false,
    // The living lantern stands tall on long legs with a crown of antlers.
    ringHeight: 3.8,
    farmRole: { kind: 'produce', resource: 'spark', amount: 2 },
  },

  // --- Haven Village whimsy pass (+4, spec §5) -------------------------------
  {
    // THE mount: horse-sized crystal beast, 16 skittering legs, antennae. Bold
    // (ignores you until tagged), rare, fast sprint flee. Transport, not labour.
    id: 'prismhorse',
    bold: true,
    name: 'Prismhorse',
    biomes: ['crags', 'highlands'],
    size: 2.1,
    walkSpeed: 3.2,
    fleeSpeed: 11,
    awareness: 22,
    fleeStyle: 'sprint',
    trackRadius: 16,
    trackTime: 18,
    rarity: 0.08,
    rewardSparks: 5,
    rewardRP: 34,
    rideable: true,
    // Horse-sized crystal beast with a raised dorsal ridge + antennae.
    ringHeight: 3.6,
    farmRole: { kind: 'none' },
  },
  {
    // Placid whale-blimp drifting over the wetland; slow rise flee (reuses the
    // flyer path). Farm role: hovers over plots and raises hopper caps.
    id: 'bumblewhale',
    bold: true,
    name: 'Bumblewhale',
    biomes: ['wetland'],
    size: 2.0,
    walkSpeed: 1.4,
    fleeSpeed: 4,
    awareness: 10,
    fleeStyle: 'fly',
    trackRadius: 14,
    trackTime: 20,
    rarity: 0.15,
    rewardSparks: 4,
    rewardRP: 24,
    rideable: false,
    farmRole: { kind: 'aura', special: 'hopperCap' },
  },
  {
    // Pancake-flat meadow cat that flips itself along. Common, skittish zigzag.
    // Farm role: fiber, doubled when adjacent to another snickerdoodle.
    id: 'snickerdoodle',
    bold: false,
    name: 'Snickerdoodle',
    biomes: ['meadow'],
    size: 0.55,
    walkSpeed: 2.2,
    fleeSpeed: 8,
    awareness: 12,
    fleeStyle: 'zigzag',
    trackRadius: 10,
    trackTime: 8,
    rarity: 0.8,
    rewardSparks: 1,
    rewardRP: 9,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'fiber', amount: 1, special: 'adjacencyDouble' },
  },
  {
    // Round forest shadow-ball on two stilt legs, huge lantern eyes. Skittish
    // sprint. Farm role: resin×3 (a hearty producer).
    id: 'gloomgobbler',
    bold: false,
    name: 'Gloomgobbler',
    biomes: ['forest'],
    size: 1.1,
    walkSpeed: 2.0,
    fleeSpeed: 9,
    awareness: 15,
    fleeStyle: 'sprint',
    trackRadius: 12,
    trackTime: 14,
    rarity: 0.3,
    rewardSparks: 3,
    rewardRP: 17,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'resin', amount: 3 },
  },
];

const BY_ID: ReadonlyMap<string, SpeciesDef> = new Map(SPECIES.map((s) => [s.id, s]));

/** Look up a species definition by id, or `undefined` if unknown. */
export function speciesById(id: string): SpeciesDef | undefined {
  return BY_ID.get(id);
}
