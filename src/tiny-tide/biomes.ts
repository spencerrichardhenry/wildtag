import { EDGE_REACH, EDGE_SOFT_START } from './edge';
import { SPECIES, tierSpecies, type FoodKind, type Species } from './species';

// Physical sizes in one persistent world. The camera stays close while the
// entire habitat shrinks continuously as the creature grows.
export const SIZES = [1, 4, 16, 64, 256] as const;
export const WATER_LEVEL = 85;
/** The player's hard bound (admission), in tier-local units. A soft current pushes back before it (edge.ts). */
export const PLAYER_HALF = 50;
/** Food and creatures roam (and flee and hunt) inside this square, in tier-local units: the edge's reach bound (44). */
export const WORLD_HALF = EDGE_REACH * PLAYER_HALF;
/** New food and creatures are placed inside this square (tier-local), outside the edge's push zone. */
export const SPAWN_HALF = EDGE_SOFT_START * PLAYER_HALF;
export function seabedHeight(x: number, z: number) {
  return Math.sin(x * .075) * Math.cos(z * .055) * 2.4 + Math.sin((x + z) * .018) * 4.5 + Math.sin(x * .006) * Math.sin(z * .009) * 13;
}
export function random(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export type Decor = 'coral' | 'kelp' | 'rock' | 'sand';
export interface BiomeType { name: string; weights: Partial<Record<FoodKind, number>>; decor: Decor; tint: string }
export interface Biome extends BiomeType { tier: number; x: number; z: number }
const TYPES: readonly (readonly BiomeType[])[] = [
  [{ name: 'Sprout meadow', weights: { plant: 3, lettuce: 2 }, decor: 'kelp', tint: '#2f8a7c' },
   { name: 'Copepod cloud', weights: { copepod: 4 }, decor: 'sand', tint: '#2b7f93' },
   { name: 'Wormy sands', weights: { worm: 4, plant: .5 }, decor: 'sand', tint: '#3b7f86' },
   { name: 'Grape garden', weights: { seagrape: 3, kelp_snack: 2 }, decor: 'coral', tint: '#2e7a8c' }],
  [{ name: 'Coral garden', weights: { seagrape: 2, shrimp: 2 }, decor: 'coral', tint: '#2a7e8e' },
   { name: 'Jelly drift', weights: { jellyfish: 4 }, decor: 'sand', tint: '#30708f' },
   { name: 'Crab flats', weights: { crab: 4, snail: 2 }, decor: 'rock', tint: '#3a7a80' },
   { name: 'Lettuce beds', weights: { lettuce: 4 }, decor: 'kelp', tint: '#2f8577' }],
  [{ name: 'Kelp forest', weights: { kelp_snack: 4, fish: 1.5 }, decor: 'kelp', tint: '#2a7a6c' },
   { name: 'Open blue', weights: { fish: 3, bird: 2 }, decor: 'sand', tint: '#246f92' },
   { name: 'Squid deep', weights: { squid: 4 }, decor: 'rock', tint: '#22587a' },
   { name: 'Ray shallows', weights: { ray: 4, plant: 2 }, decor: 'coral', tint: '#2f8790' }],
  [{ name: 'Island chain', weights: { tree: 3, lighthouse: 3 }, decor: 'sand', tint: '#88bbcb' },
   { name: 'Shipping lane', weights: { boat: 4 }, decor: 'sand', tint: '#80b4c9' },
   { name: 'Sky road', weights: { plane: 3, balloon: 3 }, decor: 'sand', tint: '#93c2d6' }],
  [{ name: 'Inner system', weights: {}, decor: 'sand', tint: '#141a36' },
   { name: 'Outer dark', weights: {}, decor: 'sand', tint: '#10142c' }],
];
export const BIOME_TYPES = TYPES;

/** Seeded biome centers, in tier-local units. Each run has its own layout. */
export function makeBiomes(seed: number, tier: number): Biome[] {
  const rand = random(seed * 31 + tier * 977 + 5);
  const types = TYPES[tier]!, count = types.length + 1 + Math.floor(rand() * 2), start = Math.floor(rand() * types.length);
  const offset = rand() * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const type = types[(start + i) % types.length]!, a = offset + i / count * Math.PI * 2 + (rand() - .5) * .6, r = 12 + rand() * 26;
    return { ...type, tier, x: Math.cos(a) * r, z: Math.sin(a) * r };
  });
}
export function biomeAt(biomes: readonly Biome[], x: number, z: number): Biome {
  let best = biomes[0]!, distance = Infinity;
  for (const biome of biomes) { const d = (biome.x - x) ** 2 + (biome.z - z) ** 2; if (d < distance) { distance = d; best = biome; } }
  return best;
}

/** The physical height of a species at a physical position. */
export function spawnHeight(spec: Species, x: number, z: number, rand: () => number): number {
  const ground = seabedHeight(x, z), size = SIZES[spec.tier]!;
  switch (spec.kind) {
    case 'copepod': return ground + .6 + rand() * 1.8;
    case 'worm': return ground + .1;
    case 'shrimp': return Math.max(ground + 3, 5 + rand() * 13);
    case 'crab': case 'snail': return ground + 1;
    case 'jellyfish': return 12 + rand() * 24;
    case 'ray': return ground + 6;
    case 'fish': case 'squid': return 22 + rand() * 40;
    case 'bird': return WATER_LEVEL + 20 + rand() * 16;
    case 'boat': return WATER_LEVEL + 4;
    case 'tree': case 'lighthouse': return WATER_LEVEL + 8;
    case 'plane': return WATER_LEVEL + 170 + rand() * 76;
    case 'balloon': return WATER_LEVEL + 220 + rand() * 80;
    case 'planet': return 650 + rand() * 690;
    default: return ground + .15 * size;
  }
}
/** A physical position for one creature of a species, biased toward its biomes. `blocked` (physical position) rejects a point, for
 *  example one inside a reef solid (owner playtest P4); the last fallback is not checked (installation recovers it). */
export function spawnPoint(spec: Species, biomes: readonly Biome[], rand: () => number, avoid?: { x: number; z: number; radius: number }, blocked?: (x: number, y: number, z: number) => boolean) {
  const size = SIZES[spec.tier]!, best = Math.max(1, ...biomes.map(b => b.weights[spec.kind] ?? 1));
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = (rand() * 2 - 1) * SPAWN_HALF, z = (rand() * 2 - 1) * SPAWN_HALF;
    if (Math.hypot(x, z) < 4) continue;
    if (avoid && Math.hypot(x * size - avoid.x, z * size - avoid.z) < avoid.radius) continue;
    const weight = biomeAt(biomes, x, z).weights[spec.kind] ?? 1;
    if (attempt < 59 && rand() * best > weight) continue;
    const y = spawnHeight(spec, x * size, z * size, rand);
    if (blocked && blocked(x * size, y, z * size)) continue;
    return { x: x * size, y, z: z * size };
  }
  return { x: SPAWN_HALF * size * .8, y: spawnHeight(spec, 0, 0, rand), z: 0 };
}
export interface Spawn { id: number; spec: Species; x: number; y: number; z: number; phase: number }
/** The opening population of every tier. The ids are stable for a seed. A point that `blocked(tier, x, y, z)` rejects (a reef solid,
 *  owner playtest P4) is replaced by a spawnPoint search with its own RNG, so every other spawn of the seed stays where it was. */
export function populate(seed: number, blocked?: (tier: number, x: number, y: number, z: number) => boolean): Spawn[] {
  const out: Spawn[] = []; let id = 0;
  for (let tier = 0; tier < SIZES.length; tier++) {
    const rand = random(seed * 7 + tier * 119 + 8721), biomes = makeBiomes(seed, tier), block = (x: number, y: number, z: number) => !!blocked?.(tier, x, y, z);
    const firsts = new Set<string>();
    for (const spec of tierSpecies(tier)) for (let i = 0; i < spec.count; i++) {
      let point = spec.kind === 'planet' ? planetPoint(i, rand) : spawnPoint(spec, biomes, rand);
      if (spec.kind !== 'planet' && block(point.x, point.y, point.z)) point = spawnPoint(spec, biomes, random(seed * 977 + id * 31 + 5), undefined, block);
      // A few landmarks are placed where the opening camera can see them.
      if (!firsts.has(spec.key)) {
        firsts.add(spec.key);
        if (spec.key === '2:fish') Object.assign(point, { x: 12, y: 19, z: -21 });
        if (spec.key === '2:ray') Object.assign(point, { x: -35, y: 34, z: -27 });
        if (spec.key === '3:boat') Object.assign(point, { x: 63, y: WATER_LEVEL + 4, z: -50 });
        if (spec.key === '3:tree') Object.assign(point, { x: -175, y: WATER_LEVEL + 8, z: -235 });
      }
      out.push({ id: id++, spec, ...point, phase: rand() * Math.PI * 2 });
    }
  }
  return out;
}
/** Planet 0 is the home world below the ocean. The others orbit above it. */
function planetPoint(index: number, rand: () => number) {
  if (index === 0) return { x: 0, y: -345, z: 0 };
  const angle = index * 2.39996 + rand() * .5, r = (7 + Math.sqrt(index) * 5) * SIZES[4];
  return { x: Math.cos(angle) * r, y: 650 + index % 4 * 230, z: Math.sin(angle) * r };
}
export const PLANET_COUNT = SPECIES.find(spec => spec.kind === 'planet')!.count;
