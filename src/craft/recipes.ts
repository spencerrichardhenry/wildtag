import type { DeployableId, Recipe, RecipeId } from '../core/types.ts';
import { spend, type Inventory } from './inventory.ts';

// ---------------------------------------------------------------------------
// The crafting tree. Ids/tiers/RP gates/costs are exact per the design spec
// §5's crafting table ("Crafting & structures"), with one documented gap
// filled in: the spec marks Field Beacon a *stretch* item and never prices
// it. Priced in-tier (75 RP) between the Zipline Kit's cheap per-unit cost
// and Glider's full unlock cost: 6 Fiber + 2 Resin + 4 Shard — see
// task-7-report.md self-review.
//
// RP is a *gate*, never a spent currency: `canCraft` checks `inv.rp >=
// recipe.rpRequired` but crafting never subtracts it (RP only ever grows,
// via Task 10 critter tracking).
// ---------------------------------------------------------------------------

export const RECIPES: Recipe[] = [
  // --- Tier 0 (start) ------------------------------------------------------
  {
    id: 'dart',
    name: 'Tracker Dart',
    tier: 0,
    rpRequired: 0,
    cost: { fiber: 3, resin: 1 },
    kind: 'consumable',
    batch: 10,
  },
  // --- Tier 1 (25 RP) --------------------------------------------------------
  {
    id: 'grapple',
    name: 'Grapple Hook',
    tier: 1,
    rpRequired: 25,
    cost: { fiber: 8, resin: 4, shard: 6 },
    kind: 'unlock',
  },
  {
    id: 'boots',
    name: 'Sky Boots',
    tier: 1,
    rpRequired: 25,
    cost: { fiber: 6, resin: 8, shard: 2 },
    kind: 'unlock',
  },
  // --- Tier 2 (75 RP) --------------------------------------------------------
  {
    id: 'glider',
    name: 'Glider',
    tier: 2,
    rpRequired: 75,
    cost: { fiber: 12, resin: 6, shard: 4, spark: 2 },
    kind: 'unlock',
  },
  {
    id: 'zipline',
    name: 'Zipline Kit',
    tier: 2,
    rpRequired: 75,
    cost: { fiber: 4, shard: 2 },
    kind: 'deployable',
  },
  {
    id: 'beacon',
    name: 'Field Beacon',
    tier: 2,
    rpRequired: 75,
    cost: { fiber: 6, resin: 2, shard: 4 },
    kind: 'deployable',
  },
  // --- Tier 3 (180 RP) --------------------------------------------------------
  {
    id: 'rocket',
    name: 'Rocket Boost',
    tier: 3,
    rpRequired: 180,
    cost: { shard: 10, spark: 6 },
    kind: 'unlock',
  },
  {
    id: 'drone',
    name: 'Sky Drone',
    tier: 3,
    rpRequired: 180,
    cost: { shard: 8, spark: 8 },
    kind: 'deployable',
  },
];

const BY_ID = new Map<RecipeId, Recipe>(RECIPES.map((r) => [r.id, r]));

function getRecipe(recipeId: RecipeId): Recipe {
  const recipe = BY_ID.get(recipeId);
  if (!recipe) throw new Error(`unknown recipe: ${recipeId}`);
  return recipe;
}

export type CraftReason = 'rp' | 'cost' | 'owned';

export interface CraftCheck {
  ok: boolean;
  reason?: CraftReason;
}

/**
 * Can `recipeId` be crafted right now? Checked in order: already-owned
 * unlock (recipe.kind === 'unlock' and already in `unlocks`) → RP gate →
 * resource cost. `unlocks` is read-only here — `craft` never mutates it;
 * the caller adds the returned `unlocked` id.
 */
export function canCraft(
  inv: Inventory,
  recipeId: RecipeId,
  unlocks: ReadonlySet<string>,
): CraftCheck {
  const recipe = getRecipe(recipeId);
  if (recipe.kind === 'unlock' && unlocks.has(recipe.id)) {
    return { ok: false, reason: 'owned' };
  }
  if (inv.rp < recipe.rpRequired) {
    return { ok: false, reason: 'rp' };
  }
  if (spend(inv, recipe.cost) === null) {
    return { ok: false, reason: 'cost' };
  }
  return { ok: true };
}

export interface CraftResult {
  inv: Inventory;
  /** Set when `recipeId` is an 'unlock' recipe — caller adds this to their unlock set. */
  unlocked?: RecipeId;
  /** Set when `recipeId` is a 'deployable' recipe — the post-craft kit counts. */
  kits?: Inventory['kits'];
}

/**
 * Craft `recipeId`. Pure: never mutates `inv` or `unlocks`; throws if
 * `canCraft` would report `ok: false` (callers — the crafting screen — must
 * gate the Craft button on `canCraft` first, so this should be unreachable
 * in normal play).
 */
export function craft(inv: Inventory, recipeId: RecipeId, unlocks: ReadonlySet<string>): CraftResult {
  const recipe = getRecipe(recipeId);
  const check = canCraft(inv, recipeId, unlocks);
  if (!check.ok) {
    throw new Error(`cannot craft ${recipeId}: ${check.reason}`);
  }
  const paid = spend(inv, recipe.cost);
  // Unreachable: canCraft already confirmed affordability above.
  if (!paid) throw new Error(`cannot craft ${recipeId}: cost`);

  if (recipe.kind === 'consumable') {
    const gained = recipe.batch ?? 1;
    return { inv: { ...paid, darts: paid.darts + gained } };
  }

  if (recipe.kind === 'unlock') {
    return { inv: paid, unlocked: recipe.id };
  }

  // 'deployable' — recipe.id is guaranteed to be a DeployableId by construction.
  const deployableId = recipe.id as DeployableId;
  const kits = { ...paid.kits, [deployableId]: paid.kits[deployableId] + 1 };
  return { inv: { ...paid, kits }, kits };
}
