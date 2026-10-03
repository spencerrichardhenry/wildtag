// Feeding (spec §8.3): today's chomp, moved out of main.ts, on physical positions. Bite targets: own-tier food, or a bigger creature that
// is attacking; the chomp eats, or damages and provokes a fighter. Pure: it changes the run and the entities it is given.
import { DROPS } from './parts';
import { entityRadius, provoke, type Entity } from './ecosystem';
import { SIZES } from './biomes';
import { dietCanEat, eat, inReach, reward, unlock, type Run } from './state';
import { dietOf, type Derived } from './genome';
import type { Capsule, Vec3, WorldShape } from './combat-types';
import { hurtboxesHit } from './combat-shapes';

/** Seconds between chomps (main.ts `cooldown`). */
export const CHOMP_COOLDOWN = .24;
export interface BiteTarget { entity: Entity; edible: boolean; distance: number }
/** main.ts `biteTargets`, in physical units: positions are divided by the stage size exactly as the scene did (stage-local units). */
export function biteTargets(run: Run, entities: readonly Entity[], player: Vec3, growth: number, derived: Pick<Derived, 'reach'>): { targets: BiteTarget[]; wrongDiet: string | null } {
  const size = SIZES[run.stage]!, p = { x: player.x / size, y: player.y / size, z: player.z / size }, diet = dietOf(run.genome);
  const out: BiteTarget[] = []; let wrongDiet: string | null = null;
  for (const e of entities) {
    if (e.eaten || e.spec.behaviourId) continue;   // combat species are never chomp targets (spec §8.3)
    const tier = e.spec.tier, attacking = e.mode === 'hunt' || e.mode === 'angry';
    if (tier !== run.stage && !(attacking && tier === run.stage + 1)) continue;
    const radius = tier > run.stage ? entityRadius(e) / size : 0, food = { x: e.x / size, y: e.y / size, z: e.z / size };
    if (!inReach(run.stage, p, food, growth, derived.reach, radius)) continue;
    const edible = tier === run.stage && dietCanEat(diet, e.spec.tag);
    // A mouth that can not eat it can still bite back at something that fights.
    if (!edible && !attacking && !e.spec.fights) { wrongDiet = e.spec.label; continue; }
    out.push({ entity: e, edible, distance: Math.hypot(food.x - p.x, food.y - p.y, food.z - p.z) });
  }
  return { targets: out.sort((a, b) => a.distance - b.distance), wrongDiet };
}
export type ChompResult =
  | { kind: 'miss'; wrongDiet: string | null }
  | { kind: 'bitten'; entity: Entity; damage: number }
  | { kind: 'ate'; entity: Entity; dna: number; won: boolean; drop: string | null };
/** main.ts `chomp` without its presentation. The caller has checked the mode and the chomp cooldown. */
export function chomp(run: Run, eco: { readonly entities: readonly Entity[]; consume(e: Entity): void; planetIndex(e: Entity): number }, player: Vec3, growth: number,
  derived: Pick<Derived, 'reach' | 'bite'>, now: number, hull: readonly Capsule[]): ChompResult {
  const { targets, wrongDiet } = biteTargets(run, eco.entities, player, growth, derived), hit = targets[0];
  if (!hit) return { kind: 'miss', wrongDiet };
  const e = hit.entity, bigger = e.spec.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
  if (e.spec.hp > 1 || bigger) {
    e.hp -= damage; provoke(e, player, now, hull);
    if (e.hp > 0) return { kind: 'bitten', entity: e, damage };
  }
  const candidate = DROPS[e.spec.kind], drop = candidate && unlock(run, candidate) ? candidate : null;
  let dna: number, won = false;
  if (hit.edible) { const result = eat(run, e.spec, e.spec.kind === 'planet' ? eco.planetIndex(e) : e.id); dna = result.dna; won = result.win; }
  else { dna = Math.round(e.spec.dna * .5); reward(run, dna, e.spec.tier === run.stage); }
  eco.consume(e);
  return { kind: 'ate', entity: e, dna, won, drop };
}
/** The basic dispatch rule (spec §8.3): the first combat species that is not eaten, of the player's tier or one above, with a hurtbox in the
 *  Bite cone (the resolved Bite shape with the current aim, range × 1.25). `isCombat` also applies the herbivore rule (review R17).
 *  Null: today's chomp runs. */
export function biteDispatch(cone: WorldShape, entities: readonly Entity[], stage: number, isCombat: (e: Entity) => boolean, hurtboxesOf: (e: Entity) => readonly Capsule[]): Entity | null {
  for (const e of entities) {
    if (e.eaten || !e.active || (e.spec.tier !== stage && e.spec.tier !== stage + 1) || !isCombat(e)) continue;
    if (hurtboxesHit(hurtboxesOf(e), [cone])) return e;
  }
  return null;
}
