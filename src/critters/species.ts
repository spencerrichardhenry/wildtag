// The game's cast: 18 procedural critters (8 phase-1 + 4 Haven whimsy +
// 1 Cursed Castle gargoyle, the sole `biomes: []` fixed-slot-only species + 2
// Inventory+Building farm-only-material producers: timberchomp/pebbleshrew +
// 2 low-flying field species: Shardwing/Nectar Wisp + 1 Cragdrake).
// This module is pure *content*
// (data only) — the tracking params (trackRadius R / trackTime T, awareness,
// fleeStyle) are binding per the design spec §4 and the Task 8 brief and are
// asserted verbatim in tests/species.test.ts. Models/animation live alongside
// in models.ts / animation.ts; the manager (Task 9) consumes `rarity` weights.

import type { SpeciesDef } from '../core/types.ts';

/**
 * All species, ordered broadly by difficulty and release group.
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
    trackTime: 3,
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
    // Butterfly-inspired without borrowing the real animal name: four broad
    // crystal-mosaic wings and a sharply broken, bobbing escape line.
    id: 'shardwing',
    bold: false,
    name: 'Shardwing',
    biomes: ['meadow', 'forest', 'wetland'],
    size: 0.5,
    walkSpeed: 3.4,
    fleeSpeed: 8.8,
    awareness: 11,
    fleeStyle: 'flutter',
    trackRadius: 12,
    trackTime: 7,
    rarity: 0.65,
    rewardSparks: 2,
    rewardRP: 13,
    rideable: false,
    ringHeight: 1.2,
    // Its wingdraft speeds adjacent farm plots without introducing another
    // one-off material economy.
    farmRole: { kind: 'aura', auraPct: 15 },
  },
  {
    // Bee-inspired amber hoverer. It is placid until tagged, then turns and
    // pursues the tracker for contact stings until the Link completes.
    id: 'nectarwisp',
    bold: true,
    name: 'Nectar Wisp',
    biomes: ['meadow', 'forest'],
    size: 0.62,
    walkSpeed: 2.8,
    fleeSpeed: 6.8,
    awareness: 18,
    fleeStyle: 'sting',
    trackRadius: 9,
    trackTime: 9,
    rarity: 0.5,
    rewardSparks: 2,
    rewardRP: 15,
    rewardHoney: 2,
    rideable: false,
    ringHeight: 1.35,
    farmRole: { kind: 'produce', resource: 'honey', amount: 1 },
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
  {
    id: 'shark',
    bold: true,
    name: 'Shark',
    biomes: ['water'],
    size: 1.4,
    walkSpeed: 3.2,
    fleeSpeed: 7.0,
    awareness: 14,
    // Bounce Wave: pack hunter — tagging ANY member aggros the whole pack
    // (manager-level propagation); per-hit damage is nectarwisp-low, the
    // threat is the 3-4 of them (see AI.sharkPack*).
    fleeStyle: 'packhunt',
    trackRadius: 13,
    trackTime: 14,
    rarity: 0.5,
    rewardSparks: 3,
    rewardRP: 22,
    rideable: false,
    farmRole: { kind: 'aura', auraPct: 20 },
  },
  {
    id: 'skywyvern',
    bold: true,
    name: 'Sky Wyvern',
    biomes: ['meadow', 'highlands'],
    size: 1.9,
    walkSpeed: 3.0,
    fleeSpeed: 6.0,
    awareness: 18,
    // Bounce Wave: spawns VERY high and slowly sinks at ~player glide rate —
    // easy to catch once reached, but reaching it needs a drone trampoline
    // (AI.skyglide*). Long serpentine chinese-dragon build (approved concept
    // docs/fidelity/skywyvern-concept.jpg).
    fleeStyle: 'skyglide',
    trackRadius: 16,
    trackTime: 12,
    rarity: 0.25,
    rewardSparks: 5,
    rewardRP: 36,
    rideable: false,
    ringHeight: 2.0,
    farmRole: { kind: 'aura', auraPct: 30 },
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

  // --- Cursed Castle (Task 10) -----------------------------------------------
  {
    // Perches on the castle towers/keep corners (fixed slots, manager.ts
    // addFixedSlots) rather than a procedural biome cell — `biomes: []` keeps
    // it out of the normal cell spawn table entirely. Bold: it sits stock-
    // still until tagged, per the castle's "gargoyles come alive" fantasy.
    id: 'gargoyle',
    bold: true,
    name: 'Gargoyle',
    biomes: [],
    size: 0.9,
    walkSpeed: 2,
    fleeSpeed: 8,
    awareness: 14,
    fleeStyle: 'perch',
    trackRadius: 14,
    trackTime: 16,
    rarity: 0.3,
    rewardSparks: 3,
    rewardRP: 24,
    rideable: false,
    ringHeight: 1.1,
    farmRole: { kind: 'aura', auraPct: 20 },
  },

  // --- Inventory + Building (Task 1) -----------------------------------------
  {
    // Plump beaver-like forest/wetland dam-builder. Skittish; escapes by
    // swimming (fleeStyle 'swim' generically biases its flee toward water in
    // ai.ts, same path the mirefin uses). Farm role: wood.
    id: 'timberchomp',
    bold: false,
    name: 'Timberchomp',
    biomes: ['forest', 'wetland'],
    size: 0.7,
    walkSpeed: 2.4,
    fleeSpeed: 7,
    awareness: 12,
    fleeStyle: 'swim',
    trackRadius: 12,
    trackTime: 12,
    rarity: 0.4,
    rewardSparks: 2,
    rewardRP: 15,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'wood', amount: 2 },
  },
  {
    // Compact sandy sand-shrew-like digger of the crags/highlands, with a
    // plated back ridge and stubby claws. Skittish zigzag flee. Farm role:
    // stone.
    id: 'pebbleshrew',
    bold: false,
    name: 'Pebbleshrew',
    biomes: ['crags', 'highlands'],
    size: 0.5,
    walkSpeed: 2.3,
    fleeSpeed: 8.5,
    awareness: 13,
    fleeStyle: 'zigzag',
    trackRadius: 11,
    trackTime: 12,
    rarity: 0.35,
    rewardSparks: 2,
    rewardRP: 15,
    rideable: false,
    farmRole: { kind: 'produce', resource: 'stone', amount: 2 },
  },
  {
    id: 'cragdrake',
    bold: false,
    name: 'Cragdrake',
    biomes: ['crags'],
    size: 1.15,
    walkSpeed: 2.6,
    fleeSpeed: 8.5,
    awareness: 15,
    // Spencer's spec (fal.ai concept, 2026-08-22): lives in the mountains,
    // flees by diving down the crag faces and back up — lots of vertical
    // travel, little horizontal — and circles one home area instead of
    // fleeing endlessly (fleeStyle 'dive', ai.ts).
    fleeStyle: 'dive',
    trackRadius: 15,
    trackTime: 17,
    rarity: 0.35,
    rewardSparks: 3,
    rewardRP: 20,
    rideable: false,
    ringHeight: 1.7,
    farmRole: { kind: 'produce', resource: 'horn', amount: 1 },
  },
];

const BY_ID: ReadonlyMap<string, SpeciesDef> = new Map(SPECIES.map((s) => [s.id, s]));

/** Look up a species definition by id, or `undefined` if unknown. */
export function speciesById(id: string): SpeciesDef | undefined {
  return BY_ID.get(id);
}
