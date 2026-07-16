import type { ResourceKind } from '../core/types.ts';

// ---------------------------------------------------------------------------
// STUB inventory (Task 6). A flat count of every gatherable + progression
// currency. Task 7 owns the real crafting/inventory system and will replace or
// expand this module — keep the API surface to exactly `createInventory()` and
// `addResource(inv, kind, n)` so callers wired now don't need touching.
// ---------------------------------------------------------------------------

export interface Inventory {
  fiber: number;
  resin: number;
  shard: number;
  spark: number;
  /** Research points (spent on the crafting tree, Task 7). */
  rp: number;
  /** Tracker darts on hand (Task 10). */
  darts: number;
}

/** A fresh, fully-zeroed inventory. */
export function createInventory(): Inventory {
  return { fiber: 0, resin: 0, shard: 0, spark: 0, rp: 0, darts: 0 };
}

/** Add `n` of a harvested resource kind to `inv` (mutates in place). */
export function addResource(inv: Inventory, kind: ResourceKind, n: number): void {
  inv[kind] += n;
}
