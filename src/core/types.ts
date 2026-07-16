// Shared plain-data types for the pure simulation core.
// Pure modules must not import three — vectors are plain { x, y, z } objects.

export type Vec3 = { x: number; y: number; z: number };
export type Biome = 'meadow' | 'forest' | 'wetland' | 'crags' | 'highlands' | 'water';
export type ResourceKind = 'fiber' | 'resin' | 'shard' | 'spark';

// ---------------------------------------------------------------------------
// Crafting tree (Task 7). Recipe ids/tiers/RP gates are exact per the design
// spec §5's crafting table; shared here (not craft/recipes.ts) because later
// tasks (hotbar slots, structure placement) reference `RecipeId` too.
// ---------------------------------------------------------------------------

/** Ids of the 8 craftable recipes across all 3 tiers. */
export type RecipeId =
  | 'dart'
  | 'grapple'
  | 'boots'
  | 'glider'
  | 'zipline'
  | 'beacon'
  | 'rocket'
  | 'drone';

/** Placeable structures that accumulate as held "kits" until Task 13 spends them. */
export type DeployableId = 'zipline' | 'beacon' | 'drone';

export type RecipeKind = 'consumable' | 'unlock' | 'deployable';

export interface Recipe {
  id: RecipeId;
  name: string;
  tier: 0 | 1 | 2 | 3;
  /** Research points required to unlock this tier (gate only — never spent). */
  rpRequired: 0 | 25 | 75 | 180;
  cost: Partial<Record<ResourceKind, number>>;
  kind: RecipeKind;
  /** Units produced per craft for consumables (e.g. darts craft in batches of 4). */
  batch?: number;
}

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
  /**
   * Randomized dwell (s) for the timed states (idle/wander/calm): stateTime
   * counts up and the critter transitions once it reaches stateDur. Re-rolled
   * (via ctx.rand) on each entry so a herd doesn't move in lockstep.
   */
  stateDur: number;
  /** Seconds the player has stayed beyond awareness×calmDistFactor while fleeing. */
  farTime: number;
}
