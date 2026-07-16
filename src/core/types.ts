// Shared plain-data types for the pure simulation core.
// Pure modules must not import three — vectors are plain { x, y, z } objects.

export type Vec3 = { x: number; y: number; z: number };
export type Biome = 'meadow' | 'forest' | 'wetland' | 'crags' | 'highlands' | 'water';
export type ResourceKind = 'fiber' | 'resin' | 'shard' | 'spark';

export interface MoveInput {
  forward: number;
  strafe: number;
  yaw: number;
  sprint: boolean;
  jump: boolean;
  jumpHeld: boolean;
  dash: boolean;
  rocket: boolean;
}

export interface MoveState {
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  stamina: number;
  exhausted: boolean;
  coyote: number;
  jumpBuffer: number;
  dashCooldown: number;
  dashTime: number;
  dashDir: Vec3;
  airDashUsed: boolean;
  airRocketUsed: boolean;
  rocketCooldown: number;
  gliding: boolean;
  staminaRegenDelay: number;
  mode: 'normal' | 'zipline' | 'swim';
}

export interface GroundQuery {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): Vec3;
}

export interface SpeciesDef {
  id: string;
  name: string;
  biomes: Biome[];
  size: number;
  walkSpeed: number;
  fleeSpeed: number;
  awareness: number;
  fleeStyle: 'sprint' | 'zigzag' | 'fly' | 'swim' | 'ledge' | 'none';
  trackRadius: number;
  trackTime: number;
  rarity: number;
  rewardSparks: number;
  rewardRP: number;
}

export interface CritterState {
  id: number;
  species: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  state: 'idle' | 'wander' | 'alert' | 'flee' | 'calm';
  stateTime: number;
  targetYaw: number;
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
  home: Vec3;
  flightHeight: number;
}
