import type { DeployableId, ResourceKind } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Inventory: resource counts + progression currency (RP) + consumables
// (darts) + held deployable "kits" (zipline/beacon/drone — placed by Task 13,
// crafted here). `createInventory`/`addResource` keep the exact signatures
// from the Task 6 stub (main.ts and props.ts already call them); `spend` is
// new — the pure affordability primitive the crafting tree builds on. This
// module never imports three.
// ---------------------------------------------------------------------------

export interface Inventory {
  fiber: number;
  resin: number;
  shard: number;
  spark: number;
  /** Amber honey gathered from Nectar Wisps; ingredient for Slowing Darts. */
  honey: number;
  /** Foraged glow mushrooms (Cursed Castle) — later spent on purifying darts. */
  mushroom: number;
  /** Farm-only material (Inventory+Building Task 1): timberchomp produce. */
  wood: number;
  /** Farm-only material (Inventory+Building Task 1): pebbleshrew produce. */
  stone: number;
  /** Shell fragments dropped by defeated clam guards. */
  shell: number;
  /** Crocodile scales ("croc hide") dropped by underwater crocodiles. */
  scale: number;
  /** Cragdrake horns — farm produce (Bounce Wave). */
  horn: number;
  /** Research points (gates crafting tiers — never spent). */
  rp: number;
  /** Tracker darts on hand (Task 10). */
  darts: number;
  /** Slowing Darts on hand — reduce a hit critter's speed for 20 seconds. */
  slowDarts: number;
  /** Tide Darts on hand — fast, nearly weightless, and stronger underwater. */
  tideDarts: number;
  /** Bond Charms on hand (Haven V2) — consumed to bond a Linked critter. */
  charms: number;
  /** Purifying Darts on hand (Cursed Castle) — Task 12 spends them on fire. */
  purifiers: number;
  /** Wall panels on hand (Inventory+Building Task 5) — BuildSystem places/reclaims them. */
  walls: number;
  /** Ramp wedges on hand (Inventory+Building Task 5) — BuildSystem places/reclaims them. */
  ramps: number;
  /** Cube blocks on hand (Inventory+Building playtest Task 8) — BuildSystem places/reclaims them. */
  cubes: number;
  /** Held-but-not-yet-placed deployable structure counts (Task 13 consumes). */
  kits: Record<DeployableId, number>;
}

/** A fresh, fully-zeroed inventory. */
export function createInventory(): Inventory {
  return {
    fiber: 0,
    resin: 0,
    shard: 0,
    spark: 0,
    honey: 0,
    mushroom: 0,
    wood: 0,
    stone: 0,
    shell: 0,
    horn: 0,
    scale: 0,
    rp: 0,
    darts: 0,
    slowDarts: 0,
    tideDarts: 0,
    charms: 0,
    purifiers: 0,
    walls: 0,
    ramps: 0,
    cubes: 0,
    kits: { zipline: 0, beacon: 0, drone: 0, trampoline: 0, skytramp: 0 },
  };
}

/** Add `n` of a harvested resource kind to `inv` (mutates in place). */
export function addResource(inv: Inventory, kind: ResourceKind, n: number): void {
  inv[kind] += n;
}

/**
 * Attempt to pay a resource `cost` out of `inv`. Pure: never mutates `inv`.
 * Returns a brand-new `Inventory` with the cost subtracted, or `null` if any
 * resource in `cost` exceeds what `inv` holds (in which case `inv` is
 * returned untouched to the caller, i.e. nothing changes).
 */
export function spend(
  inv: Inventory,
  cost: Partial<Record<ResourceKind, number>>,
): Inventory | null {
  for (const key of Object.keys(cost) as ResourceKind[]) {
    const need = cost[key] ?? 0;
    if (inv[key] < need) return null;
  }
  const next: Inventory = { ...inv, kits: { ...inv.kits } };
  for (const key of Object.keys(cost) as ResourceKind[]) {
    const need = cost[key] ?? 0;
    next[key] -= need;
  }
  return next;
}
