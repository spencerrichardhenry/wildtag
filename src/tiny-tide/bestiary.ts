// Species attacks, species behaviours, the size rosters and the minimum wind-ups (spec §11). Pure data.
import type { AttackSpec } from './combat-types';
import type { Species } from './species';

export interface AttackChoice { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }
/** `patternAttackId`: the attack of a burrow or laps pattern. */
export interface BehaviourPhase { aboveHpFraction: number; attacks: readonly AttackChoice[]; speedFactor: number; gapSeconds: number; pattern: 'normal' | 'burrow' | 'laps'; patternAttackId?: string }
export type BehaviourType = 'prey-flee' | 'prey-school' | 'prey-fighter' | 'hunter' | 'hunter-ambush' | 'alpha';
export interface SpeciesBehaviour {
  id: string; type: BehaviourType;
  reactionSeconds: number; poise: number; staggerResist: number; knockbackResistance: number; grabbable: boolean;
  attacks: readonly AttackChoice[]; gapSeconds: number;
  repositionSeconds: readonly [number, number]; repositionSpeedFactor: number;
  flee?: { seconds: number; restSeconds: number; speedFactor: number };
  school?: { radiusBodyLengths: number; groupSize: number };
  /** prey-fighter "cornered" */
  trigger?: { radiusBodyLengths: number; seconds: number };
  /** hunter-ambush */
  den?: { triggerBodyLengths: number; outSeconds: number; attackId: string };
  lair?: { radiusBodyLengths: number; resetOutsideFactor: number; resetDelaySeconds: number; healPerSecond: number };
  /** alpha; ordered by aboveHpFraction, descending */
  phases?: readonly BehaviourPhase[];
}
export const BEHAVIOUR_TYPES: readonly BehaviourType[] = ['prey-flee', 'prey-school', 'prey-fighter', 'hunter', 'hunter-ambush', 'alpha'];

/** Minimum wind-ups before director extensions (spec §11.1), by player size. Sizes 2 and up use the size-1 row until 3b retunes them. */
export const MIN_WINDUP: readonly { fighter: number; alpha: number }[] = [{ fighter: .45, alpha: .55 }, { fighter: .40, alpha: .55 }];
export const minWindup = (size: number, alpha: boolean): number => { const row = MIN_WINDUP[Math.min(size, MIN_WINDUP.length - 1)]!; return alpha ? row.alpha : row.fighter; };
/** The player sizes at which a species is hostile (spec §11.1): it hunts that size, or it fights and is of that tier; an alpha only at its own size. */
export function hostileSizes(spec: Pick<Species, 'hunts' | 'fights' | 'tier' | 'alpha'>): number[] {
  if (spec.alpha) return [spec.alpha.size];
  const out = new Set<number>(spec.hunts);
  if (spec.fights) out.add(spec.tier);
  return [...out].sort((a, b) => a - b);
}

/** Species attacks (spec §11.5). Filled by Task 14. */
export const SPECIES_ATTACKS: Record<string, AttackSpec> = {};
/** Species behaviours (spec §11.4). Filled by Task 14. */
export const BEHAVIOURS: Record<string, SpeciesBehaviour> = {};
