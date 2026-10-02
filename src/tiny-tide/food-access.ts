// Food approach for each way of moving, and the peaceful food budget of a plan (spec §3 "Food access").
// A food item counts as approachable when some pose near it is admitted, is one the plan's locomotion can hold,
// and passes the unchanged bite rule (`inReach` on stage-local positions). Approach never vetoes a real bite.
import { PLAYER_HALF, SIZES } from './biomes';
import { EDGE_REACH } from './edge';
import type { Actor, AdmissionContext, LegalityContext, MovementMode, MutVec3, Orientation, TraversalPermit } from './combat-types';
import { Ecosystem } from './ecosystem';
import { derive, effectiveStats, starterFor } from './genome';
import { playerActor } from './mount';
import type { Diet } from './parts';
import type { BodyPlan } from './plans';
import { BREACH_RISE, breachPermit, movement, movementCapabilities } from './profiles';
import { inReach, mealDna, dietCanEat, STAGES } from './state';
import { hullExtents, stageWorldQueries, supportHeight } from './world-queries';

export type Traversal = { kind: 'none' } | { kind: 'active'; permit: TraversalPermit; now: number } | { kind: 'hypothetical-breach'; now: number };
export interface FoodPoint { x: number; y: number; z: number; radius: number }
export interface BiteRule { stage: number; growth: number; reach: number }

const FREE_MODES: readonly MovementMode[] = ['swim', 'fly', 'glide', 'space'];

/** True when some admitted, maintainable pose for this movement mode can bite the food. */
export function canApproachFood(actor: Actor, mode: MovementMode, food: FoodPoint, bite: BiteRule, ctx: LegalityContext & { traversal?: Traversal }): boolean {
  const { stage, growth, reach } = bite, size = SIZES[stage]!, spec = STAGES[stage]!;
  const R = (spec.radius * growth + .5 + reach) * size + food.radius;
  const V = ((stage === 0 ? 2 : 2.2) + reach / 2) * size + food.radius;
  const q = ctx.queries, t = q.terrain, hab = actor.habitat, L = actor.bodyLength, eps = .01 * L;
  // The edge current keeps the player away from food past the reach bound (edge.ts), so it is not approachable.
  if (ctx.bounds && Math.max(Math.abs(food.x), Math.abs(food.z)) > EDGE_REACH * ctx.bounds.half) return false;

  // Traversal: the admission time and permit, and the breach ceiling.
  const trav = ctx.traversal ?? { kind: 'none' };
  const actx: AdmissionContext = { time: 0, permit: null, bounds: ctx.bounds };
  let ceiling = Infinity;
  if (trav.kind === 'active') { actx.time = trav.now; actx.permit = trav.permit; }
  else if (trav.kind === 'hypothetical-breach') { actx.time = trav.now; actx.permit = breachPermit(trav.now); ceiling = t.surface + BREACH_RISE * size; }

  // The bite rule on stage-local positions.
  const local = { x: food.x / size, y: food.y / size, z: food.z / size }, foodR = food.radius / size;
  const P: MutVec3 = { x: 0, y: 0, z: 0 }, stageP: MutVec3 = { x: 0, y: 0, z: 0 };
  const free = FREE_MODES.includes(mode), lo = food.y - V, hi = food.y + V;
  const clamp = (y: number) => Math.min(hi, Math.max(lo, y));

  const tryAt = (x: number, z: number): boolean => {
    const o: Orientation = { yaw: x === food.x && z === food.z ? 0 : Math.atan2(food.x - x, food.z - z), pitch: 0 };
    const { top, bottom } = hullExtents(actor, o);
    const heights: number[] = [];
    if (mode === 'ground' || mode === 'burrow') {
      if (!t.space) heights.push(supportHeight(actor, x, z, o, t) + eps);
    } else if (mode === 'surface') {
      if (!t.space) {
        heights.push(t.surface - top - eps, t.surface + bottom + eps);
        if (hab.surfaceBandBodyLengths !== null) heights.push(t.surface + hab.surfaceBandBodyLengths * L - top - eps);
      }
    } else if (free) {
      const raw = [food.y, food.y + .9 * V, food.y - .9 * V];
      if (!t.space) {
        const G = t.groundAt(x, z);
        raw.push(supportHeight(actor, x, z, o, t) + eps);
        if (hab.maxFloorGapBodyLengths !== null) raw.push(G + hab.maxFloorGapBodyLengths * L + bottom - eps);
        if (hab.wadingSupportBodyLengths !== null) raw.push(G + hab.wadingSupportBodyLengths * L + bottom - eps);
        raw.push(t.surface - top - eps, t.surface + bottom + eps);
        if (hab.surfaceBandBodyLengths !== null) raw.push(t.surface + hab.surfaceBandBodyLengths * L - top - eps);
      }
      for (const y of raw) heights.push(clamp(y));
    }
    for (const y of heights) {
      if (!Number.isFinite(y) || y > ceiling) continue;
      stageP.x = x / size; stageP.y = y / size; stageP.z = z / size;
      if (!inReach(stage, stageP, local, growth, reach, foodR)) continue;
      P.x = x; P.y = y; P.z = z;
      if (q.overlapHull(actor, P, o, actx).ok) return true;
    }
    return false;
  };

  if (tryAt(food.x, food.z)) return true;
  for (const f of [.45, .9]) for (let j = 0; j < 8; j++) {
    const a = j * Math.PI / 4;
    if (tryAt(food.x + f * R * Math.cos(a), food.z + f * R * Math.sin(a))) return true;
  }
  return false;
}

/** The DNA of the installed own-tier food a fresh starter of this plan can approach and eat (peaceful species only, when asked). */
export function reachableFoodDna(plan: BodyPlan, diet: Diet, seed: number, opts: { peacefulOnly: boolean }): number {
  const size = plan.size, starter = starterFor(plan), caps = movementCapabilities(plan);
  const actor = playerActor(plan, starter, size, 1), mode = movement(plan.movement).mode;
  const bite: BiteRule = { stage: size, growth: 1, reach: derive(effectiveStats(starter, plan)).reach };
  const ctx: LegalityContext & { traversal: Traversal } = {
    queries: stageWorldQueries(size, seed), bounds: { half: PLAYER_HALF * SIZES[size]! },
    traversal: caps.breach ? { kind: 'hypothetical-breach', now: 0 } : { kind: 'none' },
  };
  let total = 0;
  for (const e of new Ecosystem(seed).entities) {
    const spec = e.spec;
    if (e.eaten || spec.tier !== size || !dietCanEat(diet, spec.tag)) continue;
    if (opts.peacefulOnly && (spec.hunts.includes(size) || spec.stingsStages.includes(size) || spec.fights)) continue;
    if (canApproachFood(actor, mode, { x: e.x, y: e.y, z: e.z, radius: 0 }, bite, ctx)) total += mealDna(plan, diet, spec);
  }
  return total;
}
