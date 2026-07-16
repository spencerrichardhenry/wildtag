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
  /** Research points (gates crafting tiers — never spent). */
  rp: number;
  /** Tracker darts on hand (Task 10). */
  darts: number;
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
    rp: 0,
    darts: 0,
    kits: { zipline: 0, beacon: 0, drone: 0 },
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
