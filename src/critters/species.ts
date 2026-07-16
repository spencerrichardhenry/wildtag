// The game's cast: 8 procedural blocky critters. This module is pure *content*
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
  },
  {
    id: 'skitterling',
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
  },
  {
    id: 'bellowbuck',
    name: 'Bellowbuck',
    biomes: ['forest'],
    size: 2.2,
    walkSpeed: 5.5,
    fleeSpeed: 5.5, // never panics — just strides away fast
    awareness: 10,
    fleeStyle: 'none',
    trackRadius: 15,
    trackTime: 14,
    rarity: 0.5,
    rewardSparks: 2,
    rewardRP: 14,
  },
  {
    id: 'mirefin',
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
  },
  {
    id: 'craghorn',
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
  },
  {
    id: 'zephyrfinch',
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
  },
  {
    id: 'emberpup',
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
  },
  {
    id: 'lumenstag',
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
  },
];

const BY_ID: ReadonlyMap<string, SpeciesDef> = new Map(SPECIES.map((s) => [s.id, s]));

/** Look up a species definition by id, or `undefined` if unknown. */
export function speciesById(id: string): SpeciesDef | undefined {
  return BY_ID.get(id);
}
