// Species attacks, species behaviours, the size rosters and the minimum wind-ups (spec §11). Pure data.
import type { AttackShape, AttackSpec } from './combat-types';
import type { Species } from './species';

export interface AttackChoice { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }
/** `patternAttackId`: the attack of a burrow or laps pattern. `lairFraction`: the phase keeps the alpha within this share of its lair radius
 *  (the Reef Tyrant's lair bites; plan decision: the spec says "within 0.6 × lair radius" but its type has no field). */
export interface BehaviourPhase { aboveHpFraction: number; attacks: readonly AttackChoice[]; speedFactor: number; gapSeconds: number; pattern: 'normal' | 'burrow' | 'laps'; patternAttackId?: string; lairFraction?: number }
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

const DEG = Math.PI / 180;
type Row = { shape: AttackShape; windup: number; lock: number; track: number; active: number; recovery: number; cooldown: number; damage: number; impulse: number; stagger: number;
  block: boolean; parry: boolean; int: boolean; telegraph: string } & Partial<AttackSpec>;
/** One species attack (spec §11.5): half-hearts, same-medium, terrain-and-cover, one target, the `centre` socket, shape numbers in L_e.
 *  The attacker stands still while it winds up (moveSpeedFactor 0; plan decision); a lunge moves through resolveMotion. */
const attack = (id: string, r: Row): AttackSpec => {
  const { shape, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, int, telegraph, ...rest } = r;
  return { id, shape, poseProfileId: 'rest', windupSeconds: windup, activeSeconds: active, recoverySeconds: recovery, cooldownSeconds: cooldown, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: track,
    damage, impulse, staggerSeconds: stagger, blockable: block, parryable: parry, interruptible: int, maxTargets: 1, hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: 0,
    crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: telegraph, damageUnit: 'half-heart', aimMode: 'input', moveSpeedFactor: 0, poiseDamageMultiplier: 1, ...rest };
};
const cone = (range: number, halfDeg: number): AttackShape => ({ kind: 'cone', range, halfAngle: halfDeg * DEG });
const capsule = (z0: number, z1: number, radius: number): AttackShape => ({ kind: 'capsule', start: { x: 0, y: 0, z: z0 }, end: { x: 0, y: 0, z: z1 }, radius });
const ball = (radius: number): AttackShape => capsule(0, 0, radius);
/** Species attacks (spec §11.5). Interruptible: "yes" and "windup" (a lunge: the engine interrupts it in windup only) are `true`. */
export const SPECIES_ATTACKS: Record<string, AttackSpec> = Object.fromEntries([
  attack('snail-poke', { shape: cone(1.2, 50), windup: .50, lock: .30, track: 2.5, active: .12, recovery: .80, cooldown: 2.5, damage: 2, impulse: 4, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('crab-pinch', { shape: cone(.45, 35), windup: .50, lock: .28, track: 2.5, active: .10, recovery: .55, cooldown: 1.6, damage: 2, impulse: 3, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('crab-lunge', { shape: capsule(0, 1.4, .22), lunge: { distanceBodyLengths: 1.2 }, windup: .60, lock: .35, track: 2.0, active: .22, recovery: .75, cooldown: 3.5, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('crab-sweep', { shape: cone(.65, 70), windup: .55, lock: .30, track: 2.5, active: .14, recovery: .70, cooldown: 4.0, damage: 2, impulse: 8, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-spin' }),
  attack('mother-pinch', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .45, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('mother-pinch-2', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .90, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('mother-lunge', { shape: capsule(0, 1.0, .20), lunge: { distanceBodyLengths: .9 }, windup: .65, lock: .40, track: 1.5, active: .22, recovery: .80, cooldown: 4.0, damage: 4, impulse: 8, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('mother-emerge', { shape: ball(.35), aimMode: 'fixed-at-start', origin: 'target', windup: .70, lock: 0, track: 0, active: .15, recovery: 1.10, cooldown: 2.0, damage: 4, impulse: 10, stagger: .40, block: false, parry: true, int: false, telegraph: 'red-burrow' }),
  attack('mother-sweep', { shape: cone(.60, 75), windup: .60, lock: .35, track: 1.5, active: .14, recovery: .40, cooldown: 3.0, damage: 3, impulse: 9, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-spin' }),
  attack('mother-pinch-rage', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .80, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('puffer-burst', { shape: ball(1.6), aimMode: 'centre', windup: .55, lock: 0, track: 0, active: .15, recovery: 1.20, cooldown: 3.0, damage: 3, impulse: 7, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-inflate' }),
  attack('squid-ink', { shape: cone(.90, 30), statusEffectId: 'ink', windup: .45, lock: .25, track: 2.0, active: .30, recovery: .60, cooldown: 6.0, damage: 1, impulse: 0, stagger: 0, block: true, parry: false, int: true, telegraph: 'amber-coil' }),
  attack('squid-grab', { shape: capsule(.1, .75, .12), hold: { seconds: 1.0, sizeFactor: 1.2, startHalfHearts: 2, squeezeHalfHearts: 1, squeezeEverySeconds: .5 }, windup: .55, lock: .30, track: 1.8, active: .12, recovery: .70, cooldown: 4.5, damage: 2, impulse: 0, stagger: 0, block: false, parry: true, int: true, telegraph: 'red-coil' }),
  attack('squid-lunge', { shape: capsule(0, 1.1, .18), lunge: { distanceBodyLengths: 1.0 }, windup: .45, lock: .25, track: 1.8, active: .22, recovery: .80, cooldown: 3.5, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('eel-ambush', { shape: capsule(0, 1.3, .15), lunge: { distanceBodyLengths: 1.2 }, windup: .45, lock: .25, track: 2.0, active: .20, recovery: .70, cooldown: 5.0, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('eel-bite', { shape: cone(.45, 35), windup: .40, lock: .20, track: 2.2, active: .10, recovery: .50, cooldown: 1.5, damage: 2, impulse: 3, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('eel-wrap', { shape: capsule(0, .6, .20), hold: { seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 }, windup: .60, lock: .35, track: 2.0, active: .12, recovery: .80, cooldown: 6.0, damage: 1, impulse: 0, stagger: 0, block: false, parry: true, int: true, telegraph: 'red-coil' }),
  attack('tyrant-bite', { shape: cone(.40, 35), windup: .60, lock: .35, track: 1.5, active: .10, recovery: .60, cooldown: 1.5, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('tyrant-den-lunge', { shape: capsule(0, 1.2, .14), lunge: { distanceBodyLengths: 1.1 }, windup: .70, lock: .45, track: 1.5, active: .25, recovery: .90, cooldown: 4.0, damage: 4, impulse: 8, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('tyrant-charge', { shape: capsule(0, 1.6, .16), lunge: { distanceBodyLengths: 1.5 }, aimMode: 'fixed-at-start', windup: .65, lock: 0, track: 0, active: .30, recovery: .50, cooldown: 2.0, damage: 4, impulse: 10, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('tyrant-whirl', { shape: ball(.55), aimMode: 'centre', maxHitsPerTarget: 2, repeatHitSeconds: .30, windup: .80, lock: 0, track: 0, active: .60, recovery: 1.20, cooldown: 5.0, damage: 3, impulse: 8, stagger: .35, block: false, parry: false, int: false, telegraph: 'red-spin' }),
].map(a => [a.id, a]));

const behaviour = (over: Partial<SpeciesBehaviour> & Pick<SpeciesBehaviour, 'id' | 'type' | 'reactionSeconds' | 'poise'>): SpeciesBehaviour =>
  ({ staggerResist: 0, knockbackResistance: 0, grabbable: true, attacks: [], gapSeconds: 0, repositionSeconds: [0, 0], repositionSpeedFactor: .6, ...over });
const choice = (attackId: string, band: readonly [number, number], weight: number, more: Partial<AttackChoice> = {}): AttackChoice => ({ attackId, band, weight, ...more });
/** T23 probe, plan review R13: the chain gaps are .55 s (were .2 and .1), so the second hit comes after the starter Paddle tail Dash is ready again
 *  (its press-to-ready cycle is 1.57 s; the combo's second active start was 1.30 s after the first). P5 Clawmother: every meat-build trial fainted. */
const PINCH_COMBO = choice('mother-pinch', [0, .4], 3, { chainNextId: 'mother-pinch-2', chainGapSeconds: .55 });
/** Species behaviours (spec §11.4, §11.6). The eel's ambush reaction is 0 (its den rule), its out-of-den reaction .35. */
export const BEHAVIOURS: Record<string, SpeciesBehaviour> = Object.fromEntries([
  behaviour({ id: 'drifter', type: 'prey-flee', reactionSeconds: .2, poise: 99, flee: { seconds: 2.0, restSeconds: 1.2, speedFactor: 1.3 } }),
  behaviour({ id: 'sardine', type: 'prey-school', reactionSeconds: .2, poise: 99, flee: { seconds: 2.5, restSeconds: 1.5, speedFactor: 1.3 }, school: { radiusBodyLengths: 6, groupSize: 4 } }),
  behaviour({ id: 'spiny-snail', type: 'prey-fighter', reactionSeconds: .1, poise: 4, attacks: [choice('snail-poke', [0, 1.2], 1)], gapSeconds: 2.5, trigger: { radiusBodyLengths: 1.2, seconds: 1.0 } }),
  behaviour({ id: 'puffer', type: 'prey-fighter', reactionSeconds: .1, poise: 6, knockbackResistance: .2, attacks: [choice('puffer-burst', [0, 1.35], 1)], gapSeconds: 3.0, trigger: { radiusBodyLengths: 1.1, seconds: .8 } }),
  behaviour({ id: 'crab', type: 'hunter', reactionSeconds: .35, poise: 6, knockbackResistance: .2, gapSeconds: 1.0, repositionSeconds: [.6, 1.2],
    attacks: [choice('crab-pinch', [0, .45], 3), choice('crab-lunge', [.5, 1.4], 2), choice('crab-sweep', [0, .6], 1, { flankWeight: 3 })] }),
  behaviour({ id: 'squid', type: 'hunter', reactionSeconds: .35, poise: 7, knockbackResistance: .3, gapSeconds: .8, repositionSeconds: [.6, 1.2],
    attacks: [choice('squid-ink', [.3, .9], 1), choice('squid-grab', [.2, .75], 2), choice('squid-lunge', [.6, 1.2], 2)] }),
  behaviour({ id: 'eel', type: 'hunter-ambush', reactionSeconds: .35, poise: 6, knockbackResistance: .3, gapSeconds: .8, repositionSeconds: [.5, 1.0],
    attacks: [choice('eel-bite', [0, .45], 3), choice('eel-wrap', [0, .6], 1)], den: { triggerBodyLengths: .9, outSeconds: 4, attackId: 'eel-ambush' } }),
  behaviour({ id: 'clawmother', type: 'alpha', reactionSeconds: .35, poise: 14, staggerResist: .5, knockbackResistance: .6, grabbable: false, gapSeconds: 1.0, repositionSeconds: [.6, 1.0],
    // Plan review R15: lair radius ≤ .25 × PLAYER_HALF × SIZES[0] = 12.5 units; 1.2 L_e = 12.1 units (the spec's 2.5 L_e reached the start anchor).
    lair: { radiusBodyLengths: 1.2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [
      { aboveHpFraction: .6, attacks: [PINCH_COMBO, choice('mother-lunge', [.4, 1.0], 1)], speedFactor: 1.0, gapSeconds: 1.0, pattern: 'normal' },
      { aboveHpFraction: .3, attacks: [PINCH_COMBO], speedFactor: 1.0, gapSeconds: .8, pattern: 'burrow', patternAttackId: 'mother-emerge' },
      { aboveHpFraction: 0, attacks: [choice('mother-sweep', [0, .6], 2, { chainNextId: 'mother-pinch-rage', chainGapSeconds: .55 }), { ...PINCH_COMBO, weight: 1 }], speedFactor: 1.3, gapSeconds: .7, pattern: 'normal' },
    ] }),
  behaviour({ id: 'reef-tyrant', type: 'alpha', reactionSeconds: .35, poise: 16, staggerResist: .5, knockbackResistance: .6, grabbable: false, gapSeconds: 1.0, repositionSeconds: [.6, 1.0],
    // Plan review R15 (T19): lair radius ≤ .25 × PLAYER_HALF × SIZES[1] = 50 units; L_e = 35.84, so 1.4 L_e (50.18) is just over and 1.39 L_e = 49.8 units.
    lair: { radiusBodyLengths: 1.39, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [
      { aboveHpFraction: .66, attacks: [choice('tyrant-bite', [0, .4], 3), choice('tyrant-den-lunge', [.4, 1.2], 2)], speedFactor: 1.0, gapSeconds: 1.0, pattern: 'normal', lairFraction: .6 },
      { aboveHpFraction: .33, attacks: [], speedFactor: 1.4, gapSeconds: .6, pattern: 'laps', patternAttackId: 'tyrant-charge' },
      { aboveHpFraction: 0, attacks: [choice('tyrant-whirl', [0, .3], 2), choice('tyrant-bite', [0, .4], 2)], speedFactor: 1.2, gapSeconds: .8, pattern: 'normal' },
    ] }),
].map(b => [b.id, b]));
/** The Clawmother's burrow (spec §11.6): sink .4 s, travel 1.2 s at × 1.6 under the sand (untargetable), then emerge; two emerges, then one pinch combo.
 *  The Reef Tyrant's laps: a lap radius of .8 × the lair radius, a charge every half lap, two charges, then a 1.5 s rest. */
export const BURROW = { sinkSeconds: .4, travelSeconds: 1.2, speedFactor: 1.6, emerges: 2 } as const;
export const LAPS = { radiusFraction: .8, charges: 2, restSeconds: 1.5 } as const;
