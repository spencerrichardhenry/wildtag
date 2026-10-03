// Habitat, movement and pursuit profiles, and the registries they live in.
// Plans.ts derives its habitat and movement facts from these rows, so this file imports only types from it.
import type { BodyPlan } from './plans';
import type { HabitatProfile, MovementMode, MovementProfile, PursuitPolicy, TraversalPermit } from './combat-types';

type HabitatRow = [id: string, media: HabitatProfile['media'], maxDepth: number | null, floorGap: number | null, slope: number, surfaceBand: number | null, wading: number | null, isStaticProp?: true];
const habitatRow = ([id, media, maxWaterDepthBodyLengths, maxFloorGapBodyLengths, maxLandSlopeRadians, surfaceBandBodyLengths, wadingSupportBodyLengths, isStaticProp]: HabitatRow): HabitatProfile =>
  ({ id, media, maxWaterDepthBodyLengths, maxFloorGapBodyLengths, maxLandSlopeRadians, surfaceBandBodyLengths, wadingSupportBodyLengths, refugeTags: [], ...(isStaticProp ? { isStaticProp } : {}) });
const habitatRows: HabitatRow[] = [
  ['seabed', ['water'], null, 1.1, .9, null, 1.1], ['open-water', ['water'], null, null, .9, null, null], ['shallow-shore', ['water', 'land'], 2.5, null, .7, null, 1.1],
  ['land', ['land'], null, null, .7, null, null], ['seabed-land', ['water', 'land'], null, 1.1, .8, null, 1.1], ['sky-sea', ['water', 'air'], null, null, .9, null, null],
  ['space', ['space'], null, null, 0, null, null], ['sp-seabed', ['water'], null, 1.6, .9, null, null], ['sp-water', ['water'], null, null, .9, null, null],
  ['sp-air', ['air'], null, null, .9, null, null], ['sp-surface', ['water'], null, null, .9, .6, null], ['sp-prop', ['land'], null, null, 1.5, null, null, true],
  ['sp-space', ['space'], null, null, 0, null, null],
];
export const HABITATS: Record<string, HabitatProfile> = Object.fromEntries(habitatRows.map(r => [r[0], habitatRow(r)]));

type MoveRow = [id: string, mode: MovementMode, speed: number, acceleration: number, braking: number, yaw: number, pitch: number];
const moveRow = ([id, mode, speedMultiplier, acceleration, braking, maxYawRate, maxPitchRate]: MoveRow): MovementProfile => ({ id, mode, speedMultiplier, acceleration, braking, maxYawRate, maxPitchRate, facing: 'move' });
/** Ids of the plan rows (the species rows follow). */
export const PLAN_MOVEMENT_IDS = ['speck', 'swimmer', 'darter', 'bulk', 'crawler', 'shellback', 'burrower', 'shore', 'flyer', 'colossus', 'space', 'space-slow'] as const;
export const PLAN_HABITAT_IDS = ['seabed', 'open-water', 'shallow-shore', 'land', 'seabed-land', 'sky-sea', 'space'] as const;
const moveRows: MoveRow[] = [
  ['speck', 'ground', 1, 30, 30, 10, 0], ['swimmer', 'swim', 1, 24, 18, 8, 3], ['darter', 'swim', 1.15, 40, 30, 12, 5], ['bulk', 'swim', .9, 14, 10, 5, 2],
  ['crawler', 'ground', 1, 26, 26, 9, 0], ['shellback', 'ground', .8, 16, 20, 6, 0], ['burrower', 'ground', .95, 24, 24, 9, 0], ['shore', 'ground', 1, 24, 24, 8, 0],
  ['flyer', 'fly', 1, 20, 14, 6, 3], ['colossus', 'ground', .85, 14, 16, 5, 0], ['space', 'space', 1, 16, 12, 4, 3], ['space-slow', 'space', .85, 12, 10, 3.5, 2.5],
  ['sp-still', 'ground', 0, 0, 0, 0, 0], ['sp-ground', 'ground', 1, 20, 20, 6, 0], ['sp-swim', 'swim', 1, 20, 16, 6, 3], ['sp-fly', 'fly', 1, 16, 12, 4, 2], ['sp-surface', 'surface', 1, 8, 8, 2, 0],
];
export const MOVEMENTS: Record<string, MovementProfile> = Object.fromEntries(moveRows.map(r => [r[0], moveRow(r)]));

const policy = (id: string, memorySeconds: number, blockedWaitSeconds: number, reacquireSeconds: number, leashBodyLengths: number, giveUpBodyLengths: number): PursuitPolicy =>
  ({ id, memorySeconds, blockedWaitSeconds, reacquireSeconds, leashBodyLengths, giveUpBodyLengths });
export const PURSUITS: Record<string, PursuitPolicy> = {
  none: policy('none', 0, 0, 0, 0, 0), hunter: policy('hunter', 6, 3, 2, 30, 12), retaliate: policy('retaliate', 4, 2, 3, 15, 8),
  /** The Moray eel (spec §11.2): its den is its home; a short memory and leash. */
  ambusher: policy('ambusher', 3, 1, 4, 1.5, 3),
};

const ids = (...names: string[]): Record<string, { id: string }> => Object.fromEntries(names.map(id => [id, { id }]));
export const HULLS = ids('sphere', 'spine-capsules'), MOUNTS = ids('root'), POSES = ids('rest');

export const habitat = (id: string): HabitatProfile => HABITATS[id]!;
export const movement = (id: string): MovementProfile => MOVEMENTS[id]!;
export const pursuit = (id: string): PursuitPolicy => PURSUITS[id]!;

export const LAND_BAND = .6;
/** Stage-local units above the surface at the top of today's breach arc (main.ts). */
export const BREACH_RISE = 3.8;
export interface MovementCapabilities { ground: boolean; rise: boolean; dive: boolean; breach: boolean; pitch: boolean }
export function movementCapabilities(p: BodyPlan): MovementCapabilities {
  const mode = movement(p.movement).mode, h = habitat(p.habitat), vertical = mode === 'swim' || mode === 'fly' || mode === 'glide' || mode === 'space';
  return { ground: mode === 'ground' || mode === 'burrow', rise: vertical, dive: vertical,
    breach: p.size === 2 && mode === 'swim' && h.maxFloorGapBodyLengths === null && h.media.includes('water'), pitch: mode === 'swim' || mode === 'glide' || mode === 'fly' || mode === 'space' };
}
export const breachPermit = (now: number): TraversalPermit => ({ id: 'breach', startsAt: now, expiresAt: now + 1.9, media: ['air'], landingRequired: true });
