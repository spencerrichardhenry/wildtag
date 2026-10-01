import type { AttackSpec } from '../../src/tiny-tide/combat-types';
export { HAZARDS as REGISTRY_HAZARDS } from '../../src/tiny-tide/registries';

/** The 'pinch' attack of the combat contract test, shared by lifecycle and later tests. */
export const syntheticAttack: AttackSpec = { id: 'pinch', shape: { kind: 'cone', range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
  aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
  hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'basic' };
