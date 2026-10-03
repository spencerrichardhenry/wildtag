import type { SpeciesCombatFields } from './combat-types';
// Everything that lives (or floats, or sails) in the Tiny Tide universe.
export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet'
  /** Combat species of sizes 0, 1 and 2 (spec §11.3); each draws an existing GLB through `model`. */
  | 'drifter' | 'spiny_snail' | 'clawmother' | 'sardine' | 'puffer' | 'eel' | 'reef_tyrant';
export type FoodTag = 'plant' | 'meat' | 'any';
export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
export interface Species extends SpeciesCombatFields {
  key: string; kind: FoodKind; tier: number; tag: FoodTag; label: string; behavior: Behavior;
  /** Population in this tier. */
  count: number; dna: number; hp: number;
  /** Speed in tier-local units per second. */
  speed: number;
  /** Player stages this species hunts. */
  hunts: readonly number[];
  /** Player stages this species stings on contact. */
  stingsStages: readonly number[];
  /** Fights back when bitten. */
  fights: boolean;
  /** Body size factor (default 1): the hull, the body length and the model scale. */
  bodyScale?: number;
  /** The food GLB this species draws (default `kind`). */
  model?: FoodKind;
  /** A material colour multiply on the model. */
  tint?: string;
  /** An alpha: present only while the player's size equals `size`; defeating it unlocks `rewardPartId` and pays `rewardDna`. */
  alpha?: { size: number; rewardPartId: string; rewardDna: number };
}
const habitatOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-air' : behavior === 'still' || behavior === 'graze' ? 'sp-seabed' : 'sp-water';
const movementOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-fly' : behavior === 'still' ? 'sp-still' : behavior === 'graze' ? 'sp-ground' : 'sp-swim';
const s = (tier: number, kind: FoodKind, tag: FoodTag, label: string, behavior: Behavior, count: number, dna: number, extra: Partial<Species> = {}): Species =>
  ({ key: `${tier}:${kind}`, kind, tier, tag, label, behavior, count, dna, hp: 1, speed: 0, hunts: [], stingsStages: [], fights: false,
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
  s(1, 'crab', 'meat', 'Peach crab', 'graze', 8, 24, { hp: 30, speed: 1.3, hunts: [0], fights: true, pursuitId: 'hunter', behaviourId: 'crab', attackIds: ['crab-pinch', 'crab-lunge', 'crab-sweep'] }),
  s(1, 'jellyfish', 'meat', 'Moon jelly', 'drift', 8, 14, { stingsStages: [1], contactHazardId: 'jelly-sting' }),
  s(1, 'snail', 'meat', 'Sea snail', 'graze', 8, 13, { speed: .5 }),
  s(2, 'kelp_snack', 'plant', 'Kelp frond', 'still', 10, 16),
  s(2, 'plant', 'plant', 'Sprout grove', 'still', 9, 16),
  s(2, 'fish', 'meat', 'Silver tuna', 'school', 13, 20, { speed: 3 }),
  s(2, 'squid', 'meat', 'Berry squid', 'skittish', 8, 30, { hp: 52, speed: 1.1, hunts: [1, 2], fights: true, pursuitId: 'hunter', behaviourId: 'squid', attackIds: ['squid-ink', 'squid-grab', 'squid-lunge'] }),
  s(2, 'ray', 'meat', 'Little ray', 'graze', 8, 22, { hp: 2, stingsStages: [1, 2], contactHazardId: 'ray-sting', pursuitId: 'retaliate', speed: 1.4, fights: true }),
  s(2, 'bird', 'meat', 'Seagull', 'flyer', 8, 20, { speed: 2 }),
  s(3, 'tree', 'any', 'Palm tree', 'still', 9, 16, { habitatProfileId: 'sp-prop' }),
  s(3, 'boat', 'any', 'Sailboat', 'drift', 9, 20, { habitatProfileId: 'sp-surface', movementProfileId: 'sp-surface' }),
  s(3, 'plane', 'any', 'Seaplane', 'flyer', 9, 32, { hp: 4, speed: 2.6, hunts: [3], fights: true, contactHazardId: 'plane-buzz', pursuitId: 'hunter' }),
  s(3, 'balloon', 'any', 'Hot-air balloon', 'drift', 8, 22, { habitatProfileId: 'sp-air', movementProfileId: 'sp-fly' }),
  s(3, 'lighthouse', 'any', 'Lighthouse', 'still', 7, 26, { habitatProfileId: 'sp-prop' }),
  s(4, 'planet', 'any', 'Planet', 'still', 12, 30, { habitatProfileId: 'sp-space', movementProfileId: 'sp-still' }),
  // Combat species (spec §11.3), after every legacy row so the legacy spawns of each tier keep their seeded places.
  s(0, 'drifter', 'meat', 'Drifter shrimp', 'skittish', 8, 14, { hp: 3, speed: 3.0, model: 'shrimp', tint: '#f6b58f', behaviourId: 'drifter' }),
  s(0, 'spiny_snail', 'meat', 'Spiny snail', 'graze', 6, 16, { hp: 6, speed: .5, model: 'snail', tint: '#c9a3e6', behaviourId: 'spiny-snail', attackIds: ['snail-poke'], fights: true, pursuitId: 'retaliate' }),
  s(1, 'clawmother', 'meat', 'Old Clawmother', 'graze', 1, 0, { hp: 80, speed: 1.0, model: 'crab', tint: '#9c3b2e', bodyScale: 1.8, behaviourId: 'clawmother', hunts: [0], fights: true, pursuitId: 'hunter',
    attackIds: ['mother-pinch', 'mother-pinch-2', 'mother-lunge', 'mother-emerge', 'mother-sweep', 'mother-pinch-rage'], alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 } }),
  // Size-1 combat species (T18, spec §11.3, D26, D36): sardine schools of 4, the puffer, and the Moray eel at its den beside a reef solid.
  s(1, 'sardine', 'meat', 'Sunny sardine', 'school', 12, 15, { hp: 4, speed: 3.2, model: 'fish', tint: '#ffd36e', bodyScale: .55, behaviourId: 'sardine' }),
  s(1, 'puffer', 'meat', 'Puffer', 'drift', 6, 20, { hp: 10, speed: .9, model: 'fish', tint: '#f2c94c', bodyScale: .75, behaviourId: 'puffer', attackIds: ['puffer-burst'], fights: true, pursuitId: 'retaliate' }),
  s(2, 'eel', 'meat', 'Moray eel', 'skittish', 4, 28, { hp: 33, speed: 1.4, model: 'worm', tint: '#3d6b4f', behaviourId: 'eel', attackIds: ['eel-ambush', 'eel-bite', 'eel-wrap'], hunts: [1], fights: true, pursuitId: 'ambusher' }),
  // The size-1 alpha (T19, spec §11.3, §11.6), last in tier 2: no spawn of tiers 0–2 changes; tier 3 and 4 ids move up by one, and their
  // places stay (each tier has its own random stream, and a reef fallback is seeded by the legacy key).
  s(2, 'reef_tyrant', 'meat', 'Reef Tyrant', 'skittish', 1, 0, { hp: 110, speed: 1.5, model: 'worm', tint: '#4b2f5e', bodyScale: 1.6, behaviourId: 'reef-tyrant', hunts: [1], fights: true, pursuitId: 'hunter',
    attackIds: ['tyrant-bite', 'tyrant-den-lunge', 'tyrant-charge', 'tyrant-whirl'], alpha: { size: 1, rewardPartId: 'mouth_tyrant', rewardDna: 60 } }),
];
/** The index of the first row appended by combat sub-project 3a: earlier rows keep the reef-fallback RNG of their spawns (populate). */
export const APPENDED_FROM = SPECIES.findIndex(spec => spec.key === '0:drifter');
const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
export const tierSpecies = (tier: number) => SPECIES.filter(spec => spec.tier === tier);
/** Food kinds with a GLB (`public/tiny-tide/models/<kind>.glb`); planets use `planet_XX`. */
export const FOOD_GLBS: readonly FoodKind[] = ['plant', 'kelp_snack', 'seagrape', 'lettuce', 'copepod', 'worm', 'shrimp', 'crab', 'jellyfish', 'snail', 'fish', 'squid', 'ray', 'bird', 'tree', 'boat', 'plane', 'balloon', 'lighthouse'];
/** The food GLBs to load: each species' model (default its kind), once. */
export const FOOD_MODEL_KINDS = [...new Set(SPECIES.filter(spec => spec.kind !== 'planet').map(spec => spec.model ?? spec.kind))];
