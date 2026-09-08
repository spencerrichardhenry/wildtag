export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet';
export interface Stage {
  name: string; nickname: string; biome: string; size: string; description: string;
  diet: string; goal: number; speed: number; radius: number; color: string; action: string;
}
export const STAGES: readonly Stage[] = [
  { name: 'Little shrimp', nickname: 'Small beginnings.', biome: 'THE SUNLIT SHALLOWS', size: '2 cm', description: 'A tiny tummy with enormous dreams. Scuttle along the seabed and nibble sea sprouts, tender kelp, sea grapes and lettuce.', diet: 'Sprouts, kelp, grapes & lettuce', goal: 10, speed: 5.8, radius: 1.7, color: '#ffad92', action: '' },
  { name: 'Happy fish', nickname: 'Go with the grow.', biome: 'THE CORAL GARDEN', size: '30 cm', description: 'Look at those fins! Find shrimp and moon jellies in the water, or dive for crabs and snails. Hold Rise to swim up.', diet: 'Shrimp, crabs, jellies & snails', goal: 12, speed: 6.5, radius: 2, color: '#ffc769', action: 'Rise' },
  { name: 'Pocket orca', nickname: 'Make a splash.', biome: 'THE OPEN OCEAN', size: '8 m', description: 'A big smile and an even bigger splash. Eat fish, then use Breach to leap out of the water for a bird snack!', diet: 'Tuna, squid, rays & gulls', goal: 14, speed: 7.5, radius: 2.5, color: '#b4e7ed', action: 'Breach' },
  { name: 'Cuddlethulhu', nickname: 'An adorable calamity.', biome: 'THE WHOLE WIDE WORLD', size: '120 m', description: 'Behold, the flying cuddle-fortress! Munch trees and boats below, or hold Rise to catch a passing plane.', diet: 'Palms, boats, planes & more', goal: 16, speed: 7, radius: 2.7, color: '#d4b1f5', action: 'Rise' },
  { name: 'Cosmic cutie', nickname: 'One last little snack.', biome: 'THE FINAL FRONTIER', size: '∞', description: 'Your appetite is out of this world. Float through the stars and eat all 12 planets. The whole universe is your picnic.', diet: 'Every last planet', goal: 12, speed: 8, radius: 3, color: '#bfc0ff', action: 'Rise' },
];
export const DIETS: readonly (readonly FoodKind[])[] = [['plant', 'kelp_snack', 'seagrape', 'lettuce'], ['shrimp', 'crab', 'jellyfish', 'snail'], ['fish', 'squid', 'ray', 'bird'], ['tree', 'boat', 'plane', 'balloon', 'lighthouse'], ['planet']];
export const FOOD_LABELS: Record<FoodKind, string> = { plant: 'Sea sprout', kelp_snack: 'Tender kelp', seagrape: 'Sea grapes', lettuce: 'Sea lettuce', shrimp: 'Little shrimp', crab: 'Peach crab', jellyfish: 'Moon jelly', snail: 'Sea snail', fish: 'Silver tuna', squid: 'Berry squid', ray: 'Little ray', bird: 'Seagull', tree: 'Palm tree', boat: 'Sailboat', plane: 'Seaplane', balloon: 'Hot-air balloon', lighthouse: 'Lighthouse', planet: 'Planet' };
export const PLANET_COUNT = 12;
// Physical sizes in one persistent world. The camera stays close while the
// entire habitat shrinks continuously as the creature grows.
export const SIZES = [1, 4, 16, 64, 256] as const;
export const WATER_LEVEL = 85;
export interface Food { id: number; kind: FoodKind; x: number; y: number; z: number; eaten: boolean; phase: number }
export interface Run { stage: number; bites: number; total: number; elapsed: number; eatenPlanets: number[]; completed: boolean }
export const freshRun = (): Run => ({ stage: 0, bites: 0, total: 0, elapsed: 0, eatenPlanets: [], completed: false });
export const canEat = (stage: number, player: { x: number; y: number; z: number }, food: Food, growth = 1): boolean => {
  const spec = STAGES[stage];
  if (!spec || food.eaten || !DIETS[stage]?.includes(food.kind)) return false;
  return Math.hypot(player.x - food.x, player.z - food.z) < spec.radius * growth + .5 && Math.abs(player.y - food.y) < (stage === 0 ? 2 : 2.2);
};
export function eat(run: Run, food: Food): 'bite' | 'evolve' | 'win' {
  if (food.eaten || run.completed || !DIETS[run.stage]?.includes(food.kind)) return 'bite';
  food.eaten = true;
  run.bites++; run.total++;
  if (run.stage === 4) run.eatenPlanets.push(food.id);
  if (run.bites < STAGES[run.stage]!.goal) return 'bite';
  if (run.stage === 4) { run.completed = true; return 'win'; }
  return 'evolve';
}
export function parseSave(raw: string | null): Run | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Run;
    if (!Number.isInteger(v.stage) || v.stage < 0 || v.stage >= STAGES.length ||
        !Number.isInteger(v.bites) || v.bites < 0 || v.bites > STAGES[v.stage]!.goal ||
        !Number.isInteger(v.total) || v.total < v.bites || !Number.isFinite(v.elapsed) || v.elapsed < 0 ||
        typeof v.completed !== 'boolean' || !Array.isArray(v.eatenPlanets) ||
        v.eatenPlanets.some(id => !Number.isInteger(id) || id < 0 || id >= PLANET_COUNT) ||
        new Set(v.eatenPlanets).size !== v.eatenPlanets.length ||
        (v.stage === 4 && v.eatenPlanets.length !== v.bites) ||
        (v.stage !== 4 && v.eatenPlanets.length !== 0) ||
        (v.completed && (v.stage !== 4 || v.bites !== PLANET_COUNT))) return null;
    return { stage: v.stage, bites: v.bites, total: v.total, elapsed: v.elapsed, eatenPlanets: [...v.eatenPlanets], completed: v.completed };
  } catch { return null; }
}
export function random(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function makeFood(stage: number): Food[] {
  const rand = random(stage * 119 + 8721);
  const count = stage === 4 ? PLANET_COUNT : 38;
  return Array.from({ length: count }, (_, id) => {
    const kind = DIETS[stage]![id % DIETS[stage]!.length]!;
    const angle = id * 2.39996;
    const r = stage === 4 ? 7 + Math.sqrt(id) * 5 : 4 + Math.sqrt(id) * 3.1;
    return { id, kind, x: Math.cos(angle) * r, z: Math.sin(angle) * r,
      y: kind === 'bird' ? 8 : kind === 'plane' ? 6.5 : kind === 'fish' ? 2.2 : kind === 'shrimp' ? 1.3 + rand() * 2.3 : kind === 'planet' ? 2 + rand() * 3.5 : .7,
      eaten: false, phase: rand() * Math.PI * 2 };
  });
}
