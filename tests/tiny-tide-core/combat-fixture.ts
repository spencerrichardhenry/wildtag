// A small, valid combat catalog for contract and engine tests: one player attack, two species attacks (a strike and a grab), one alpha
// attack, one guard of each kind, one evasion, abilities of four kinds, three behaviours, a hunter species, an alpha species and its rare part.
import type { AbilitySpec, AttackSpec, EvasionProfile, GuardProfile } from '../../src/tiny-tide/combat-types';
import type { SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
import { defaultCatalogs, type Catalogs } from '../../src/tiny-tide/registries';
import type { PartSpec } from '../../src/tiny-tide/parts';
import type { Species } from '../../src/tiny-tide/species';
import { syntheticAttack } from './helpers';

const species = (over: Partial<AttackSpec> & Pick<AttackSpec, 'id'>): AttackSpec => ({ ...syntheticAttack, damageUnit: 'half-heart', aimMode: 'input', telegraphProfileId: 'amber-rear',
  windupSeconds: .5, aimLockAtSeconds: .3, activeSeconds: .12, recoverySeconds: .8, cooldownSeconds: 2.5, damage: 2, impulse: 4, staggerSeconds: .3, parryable: true, ...over });
export const POKE: AttackSpec = species({ id: 'poke', shape: { kind: 'cone', range: 1.2, halfAngle: 50 * Math.PI / 180 } });
export const WRAP: AttackSpec = species({ id: 'wrap', shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: .6 }, radius: .2 }, windupSeconds: .6, aimLockAtSeconds: .35, blockable: false,
  telegraphProfileId: 'red-coil', damage: 1, impulse: 0, staggerSeconds: 0, hold: { seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 } });
export const SMASH: AttackSpec = species({ id: 'smash', windupSeconds: .6, aimLockAtSeconds: .35, interruptible: false, telegraphProfileId: 'amber-crouch' });
export const FX_BRACE: GuardProfile = { id: 'fx-brace', kind: 'brace', startupSeconds: .1, minActiveSeconds: .25, windowSeconds: null, frontHalfAngle: 70 * Math.PI / 180, blockFraction: .75,
  breakHalfHearts: 4, breakStaggerSeconds: .5, brokenCooldownSeconds: 2, moveSpeedFactor: .45, yawRateFactor: .5, reflectDamage: 0, attackerStaggerSeconds: 0, recoverySeconds: .15, whiffRecoverySeconds: .15, successCooldownSeconds: .4 };
export const FX_COUNTER: GuardProfile = { id: 'fx-counter', kind: 'counter', startupSeconds: .04, minActiveSeconds: 0, windowSeconds: .22, frontHalfAngle: null, blockFraction: 1, breakHalfHearts: null,
  breakStaggerSeconds: 0, brokenCooldownSeconds: 0, moveSpeedFactor: 1, yawRateFactor: 1, reflectDamage: 3, attackerStaggerSeconds: 1, recoverySeconds: 0, whiffRecoverySeconds: .4, successCooldownSeconds: .3 };
export const FX_DASH: EvasionProfile = { id: 'fx-dash', distanceBodyLengths: 1.6, startupSeconds: .03, travelSeconds: .18, recoverySeconds: .12, plane: 'free', endSpeedCarry: .3 };
const ability = (over: Partial<AbilitySpec> & Pick<AbilitySpec, 'id' | 'kind'>): AbilitySpec =>
  ({ cooldownSeconds: 1, allowedMotionModes: ['ground', 'swim'], effectProfileId: 'dash', label: over.id, input: 'press', scaling: {}, pair: null, ...over });
export const FX_ABILITIES: Record<string, AbilitySpec> = Object.fromEntries([
  ability({ id: 'dash', kind: 'dash', evasionProfileId: 'fx-dash', scaling: { 'evasion.distanceBodyLengths': .3, cooldownSeconds: .3 }, pair: { multiply: { 'evasion.distanceBodyLengths': 1.2 }, add: {} } }),
  ability({ id: 'brace', kind: 'brace', input: 'hold', guardProfileId: 'fx-brace', effectProfileId: 'block', cooldownSeconds: .4 }),
  ability({ id: 'counter', kind: 'counter', guardProfileId: 'fx-counter', effectProfileId: 'counter', cooldownSeconds: 1.2 }),
  ability({ id: 'grab', kind: 'grab', attackId: 'pinch', effectProfileId: 'grab', cooldownSeconds: 3, scaling: { 'attack.damage': .5 }, pair: { multiply: { 'attack.damage': 1.5 }, add: {} } }),
].map(a => [a.id, a]));
const behaviour = (over: Partial<SpeciesBehaviour> & Pick<SpeciesBehaviour, 'id' | 'type'>): SpeciesBehaviour =>
  ({ reactionSeconds: .35, poise: 6, staggerResist: 0, knockbackResistance: .2, grabbable: true, attacks: [], gapSeconds: 1, repositionSeconds: [.6, 1.2], repositionSpeedFactor: .6, ...over });
export const FX_BEHAVIOURS: Record<string, SpeciesBehaviour> = Object.fromEntries([
  behaviour({ id: 'fx-hunter', type: 'hunter', attacks: [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1, flankWeight: 2 }] }),
  behaviour({ id: 'fx-fleer', type: 'prey-flee', poise: 99, flee: { seconds: 2, restSeconds: 1.2, speedFactor: 1.3 } }),
  behaviour({ id: 'fx-alpha', type: 'alpha', poise: 14, staggerResist: .5, knockbackResistance: .6, grabbable: false,
    lair: { radiusBodyLengths: 2.5, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [{ aboveHpFraction: .6, attacks: [{ attackId: 'smash', band: [0, .6], weight: 1 }], speedFactor: 1, gapSeconds: 1, pattern: 'normal' },
      { aboveHpFraction: 0, attacks: [{ attackId: 'smash', band: [0, .6], weight: 1 }], speedFactor: 1.3, gapSeconds: .7, pattern: 'normal' }] }),
].map(b => [b.id, b]));
const base = (key: string, extra: Partial<Species>): Species => ({ key, kind: 'crab', tier: 1, tag: 'meat', label: key, behavior: 'graze', count: 1, dna: 10, hp: 20, speed: 1, hunts: [], stingsStages: [], fights: true,
  habitatProfileId: 'sp-seabed', movementProfileId: 'sp-ground', hullProfileId: 'sphere', attackMountProfileId: 'root', attackIds: [], pursuitId: 'hunter', ...extra });
export const FX_HUNTER = base('1:fx_hunter', { count: 4, hunts: [0], behaviourId: 'fx-hunter', attackIds: ['poke', 'wrap'] });
export const FX_ALPHA = base('1:fx_alpha', { bodyScale: 1.8, tint: '#9c3b2e', hunts: [0], behaviourId: 'fx-alpha', attackIds: ['smash'], alpha: { size: 0, rewardPartId: 'fx_rare', rewardDna: 40 } });
export const FX_FLEER = base('0:fx_fleer', { kind: 'shrimp', model: 'shrimp', tier: 0, fights: false, pursuitId: 'none', behaviourId: 'fx-fleer', hp: 3 });
/** A valid catalog: the shipped catalogs plus the fixture rows above. */
export function fixtureCatalogs(): Catalogs {
  const c = defaultCatalogs(), claw = c.parts.find(p => p.id === 'claw_pincer')!;
  const rare: PartSpec = { ...claw, id: 'fx_rare', name: 'Fixture claw', rare: true, model: 'claw_pincer' };
  return { ...c, attacks: { ...c.attacks, pinch: { ...syntheticAttack }, poke: { ...POKE }, wrap: { ...WRAP }, smash: { ...SMASH } }, abilities: { ...c.abilities, ...structuredClone(FX_ABILITIES) },
    guards: { ...c.guards, 'fx-brace': { ...FX_BRACE }, 'fx-counter': { ...FX_COUNTER } }, evasions: { ...c.evasions, 'fx-dash': { ...FX_DASH } }, behaviours: { ...c.behaviours, ...structuredClone(FX_BEHAVIOURS) },
    parts: [...c.parts, rare], species: [...c.species, { ...FX_HUNTER }, { ...FX_ALPHA }, { ...FX_FLEER }] };
}
