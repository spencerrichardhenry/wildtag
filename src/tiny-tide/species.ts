import type { SpeciesCombatFields } from './combat-types';
// Everything that lives (or floats, or sails) in the Tiny Tide universe.
export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet';
export type FoodTag = 'plant' | 'meat' | 'any';
export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
export interface Species extends SpeciesCombatFields {
  key: string; kind: FoodKind; tier: number; tag: FoodTag; label: string; behavior: Behavior;
  /** Population in this tier. */
  count: number; dna: number; hp: number; damage: number;
  /** Speed in tier-local units per second. */
  speed: number;
  /** Player stages this species hunts. */
  hunts: readonly number[];
  /** Player stages this species stings on contact. */
  stingsStages: readonly number[];
  /** Fights back when bitten. */
  fights: boolean;
}
const habitatOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-air' : behavior === 'still' || behavior === 'graze' ? 'sp-seabed' : 'sp-water';
const movementOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-fly' : behavior === 'still' ? 'sp-still' : behavior === 'graze' ? 'sp-ground' : 'sp-swim';
const s = (tier: number, kind: FoodKind, tag: FoodTag, label: string, behavior: Behavior, count: number, dna: number, extra: Partial<Species> = {}): Species =>
  ({ key: `${tier}:${kind}`, kind, tier, tag, label, behavior, count, dna, hp: 1, damage: 0, speed: 0, hunts: [], stingsStages: [], fights: false,
    habitatProfileId: habitatOf(behavior), movementProfileId: movementOf(behavior), hullProfileId: 'sphere', attackMountProfileId: 'root', attackIds: [], pursuitId: 'none', ...extra });
export const SPECIES: readonly Species[] = [
  s(0, 'plant', 'plant', 'Sea sprout', 'still', 9, 8),
  s(0, 'kelp_snack', 'plant', 'Tender kelp', 'still', 8, 8),
  s(0, 'seagrape', 'plant', 'Sea grapes', 'still', 8, 9),
  s(0, 'lettuce', 'plant', 'Sea lettuce', 'still', 8, 8),
  s(0, 'copepod', 'meat', 'Copepod', 'skittish', 10, 12, { speed: 3.6 }),
  s(0, 'worm', 'meat', 'Bristle worm', 'graze', 8, 10, { speed: .8 }),
  s(1, 'seagrape', 'plant', 'Grape cluster', 'still', 9, 12),
  s(1, 'lettuce', 'plant', 'Lettuce bed', 'still', 9, 12),
  s(1, 'shrimp', 'meat', 'Little shrimp', 'skittish', 10, 16, { speed: 3.4 }),
  s(1, 'crab', 'meat', 'Peach crab', 'graze', 8, 24, { hp: 3, damage: 2, speed: 2.2, hunts: [0], fights: true, contactHazardId: 'crab-pinch', pursuitId: 'hunter' }),
  s(1, 'jellyfish', 'meat', 'Moon jelly', 'drift', 8, 14, { stingsStages: [0, 1], contactHazardId: 'jelly-sting', damage: 1 }),
  s(1, 'snail', 'meat', 'Sea snail', 'graze', 8, 13, { speed: .5 }),
  s(2, 'kelp_snack', 'plant', 'Kelp frond', 'still', 10, 16),
  s(2, 'plant', 'plant', 'Sprout grove', 'still', 9, 16),
  s(2, 'fish', 'meat', 'Silver tuna', 'school', 10, 20, { speed: 3 }),
  s(2, 'squid', 'meat', 'Berry squid', 'skittish', 8, 30, { hp: 4, damage: 2, speed: 3.2, hunts: [1, 2], fights: true, contactHazardId: 'squid-grab', pursuitId: 'hunter' }),
  s(2, 'ray', 'meat', 'Little ray', 'graze', 8, 22, { hp: 2, stingsStages: [1, 2], contactHazardId: 'ray-sting', pursuitId: 'retaliate', damage: 1, speed: 1.4, fights: true }),
  s(2, 'bird', 'meat', 'Seagull', 'flyer', 8, 20, { speed: 2 }),
  s(3, 'tree', 'any', 'Palm tree', 'still', 9, 16, { habitatProfileId: 'sp-prop' }),
  s(3, 'boat', 'any', 'Sailboat', 'drift', 9, 20, { habitatProfileId: 'sp-surface', movementProfileId: 'sp-surface' }),
  s(3, 'plane', 'any', 'Seaplane', 'flyer', 9, 32, { hp: 4, damage: 2, speed: 2.6, hunts: [3], fights: true, contactHazardId: 'plane-buzz', pursuitId: 'hunter' }),
  s(3, 'balloon', 'any', 'Hot-air balloon', 'drift', 8, 22, { habitatProfileId: 'sp-air', movementProfileId: 'sp-fly' }),
  s(3, 'lighthouse', 'any', 'Lighthouse', 'still', 7, 26, { habitatProfileId: 'sp-prop' }),
  s(4, 'planet', 'any', 'Planet', 'still', 12, 30, { habitatProfileId: 'sp-space', movementProfileId: 'sp-still' }),
];
const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
export const tierSpecies = (tier: number) => SPECIES.filter(spec => spec.tier === tier);
export const FOOD_MODEL_KINDS = [...new Set(SPECIES.filter(spec => spec.kind !== 'planet').map(spec => spec.kind))];
