import type { ActionState, AttackSpec, ResolvedMove } from '../../src/tiny-tide/combat-types';
export { HAZARDS as REGISTRY_HAZARDS } from '../../src/tiny-tide/registries';

/** The 'pinch' attack of the combat contract test, shared by lifecycle and later tests (a player attack: hp, no telegraph). */
export const syntheticAttack: AttackSpec = { id: 'pinch', shape: { kind: 'cone', range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
  aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
  hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'none',
  damageUnit: 'hp', aimMode: 'input', moveSpeedFactor: 1, poiseDamageMultiplier: 1 };
/** A species attack resolves to itself. */
export const resolvedOf = (attack: AttackSpec): ResolvedMove => ({ kind: 'species', abilityId: null, label: attack.id, input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: [] });
/** A complete ActionState for tests: windup at clock 0, the synthetic attack. */
export const blankAction = (over: Partial<ActionState> = {}): ActionState => ({ instanceId: 'a1', definitionId: 'pinch', grantId: 'snap', source: { kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' },
  phase: 'windup', startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map(), phaseStartedAt: 0, aimLocked: false,
  resolved: resolvedOf(syntheticAttack), targetId: null, heldTarget: null, windupExtension: 0, released: false, countered: false, connected: false, lungeDone: 0, lockedShapes: null, squeezes: 0,
  cooldownKey: 'player:p5:snap', ...over });
