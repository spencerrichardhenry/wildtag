import { describe, expect, it } from 'vitest';
import { addResource, createInventory, spend, type Inventory } from '../src/craft/inventory.ts';
import { canCraft, craft, RECIPES } from '../src/craft/recipes.ts';
import type { RecipeId } from '../src/core/types.ts';

function grant(inv: Inventory, amounts: Partial<Record<'fiber' | 'resin' | 'shard' | 'spark', number>>): void {
  for (const [kind, n] of Object.entries(amounts)) {
    addResource(inv, kind as 'fiber' | 'resin' | 'shard' | 'spark', n!);
  }
}

describe('spend', () => {
  it('subtracts an exact cost and returns a new object', () => {
    const inv = createInventory();
    grant(inv, { fiber: 5, resin: 2 });
    const result = spend(inv, { fiber: 3, resin: 1 });
    expect(result).not.toBeNull();
    expect(result!.fiber).toBe(2);
    expect(result!.resin).toBe(1);
    expect(result).not.toBe(inv); // new object
  });

  it('returns null when any single resource is insufficient', () => {
    const inv = createInventory();
    grant(inv, { fiber: 2 });
    expect(spend(inv, { fiber: 3 })).toBeNull();
    expect(spend(inv, { fiber: 1, resin: 1 })).toBeNull(); // resin: 0 < 1
  });

  it('is pure — the input inventory is never mutated, on success or failure', () => {
    const inv = createInventory();
    grant(inv, { fiber: 5 });
    const before = { ...inv, kits: { ...inv.kits } };

    spend(inv, { fiber: 3 }); // affordable
    expect(inv).toEqual(before);

    spend(inv, { fiber: 999 }); // unaffordable
    expect(inv).toEqual(before);
  });
});

describe('canCraft — RP gating', () => {
  it('gates a tier-1 recipe on RP even when resources are sufficient', () => {
    const inv = createInventory();
    grant(inv, { fiber: 8, resin: 4, shard: 6 }); // exact grapple cost
    inv.rp = 24; // one below the 25 RP gate
    expect(canCraft(inv, 'grapple', new Set())).toEqual({ ok: false, reason: 'rp' });
  });

  it('passes at exactly the RP threshold', () => {
    const inv = createInventory();
    grant(inv, { fiber: 8, resin: 4, shard: 6 });
    inv.rp = 25;
    expect(canCraft(inv, 'grapple', new Set())).toEqual({ ok: true });
  });

  it('tier-0 dart requires no RP', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, resin: 1 });
    expect(canCraft(inv, 'dart', new Set()).ok).toBe(true);
  });
});

describe('canCraft — cost math', () => {
  it('reports insufficient cost when short by even one resource', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3 }); // resin missing entirely
    expect(canCraft(inv, 'dart', new Set())).toEqual({ ok: false, reason: 'cost' });
  });

  it('ok is true only once every cost resource is met', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, resin: 1 });
    expect(canCraft(inv, 'dart', new Set())).toEqual({ ok: true });
  });
});

describe('craft — dart batching', () => {
  it('spends the exact recipe cost and grants darts in a batch of 10', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, resin: 1 });
    const result = craft(inv, 'dart', new Set());
    expect(result.inv.fiber).toBe(0);
    expect(result.inv.resin).toBe(0);
    expect(result.inv.darts).toBe(10);
    expect(result.unlocked).toBeUndefined();
    expect(result.kits).toBeUndefined();
  });

  it('crafting twice yields 20 darts total (each craft pays its own cost)', () => {
    const inv = createInventory();
    grant(inv, { fiber: 6, resin: 2 });
    const first = craft(inv, 'dart', new Set());
    const second = craft(first.inv, 'dart', new Set());
    expect(second.inv.darts).toBe(20);
    expect(second.inv.fiber).toBe(0);
  });

  it('throws if craft is called when unaffordable (UI must gate on canCraft)', () => {
    const inv = createInventory();
    expect(() => craft(inv, 'dart', new Set())).toThrow();
  });
});

describe('craft — unlock once-only', () => {
  it('crafting an unlock recipe returns its id in `unlocked` and does not mutate the unlocks set', () => {
    const inv = createInventory();
    grant(inv, { fiber: 8, resin: 4, shard: 6 });
    inv.rp = 25;
    const unlocks = new Set<string>();
    const result = craft(inv, 'grapple', unlocks);
    expect(result.unlocked).toBe('grapple');
    expect(unlocks.size).toBe(0); // craft() is pure — caller must add it
  });

  it('a second craft attempt after the caller adds the unlock reports reason "owned"', () => {
    const inv = createInventory();
    grant(inv, { fiber: 8, resin: 4, shard: 6 });
    inv.rp = 25;
    const unlocks = new Set<string>();
    const first = craft(inv, 'grapple', unlocks);
    unlocks.add(first.unlocked!);

    grant(inv, { fiber: 8, resin: 4, shard: 6 }); // pretend resources replenished
    expect(canCraft(inv, 'grapple', unlocks)).toEqual({ ok: false, reason: 'owned' });
    expect(() => craft(inv, 'grapple', unlocks)).toThrow();
  });
});

describe('craft — deployable kits', () => {
  it('increments the matching kit count and can be crafted repeatedly (no once-only gate)', () => {
    const inv = createInventory();
    inv.rp = 75;
    grant(inv, { fiber: 8, shard: 4 }); // two zipline kits' worth
    const unlocks = new Set<string>();

    const first = craft(inv, 'zipline', unlocks);
    expect(first.kits).toEqual({ zipline: 1, beacon: 0, drone: 0 });
    expect(first.inv.kits).toEqual({ zipline: 1, beacon: 0, drone: 0 });

    const second = craft(first.inv, 'zipline', unlocks);
    expect(second.kits).toEqual({ zipline: 2, beacon: 0, drone: 0 });
    expect(second.inv.fiber).toBe(0);
    expect(second.inv.shard).toBe(0);
  });
});

describe('craft — Bond Charm (Haven V2)', () => {
  it('is a tier-1 recipe gated at 25 RP with cost {fiber:3, shard:1, spark:1}', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, shard: 1, spark: 1 });
    inv.rp = 24;
    expect(canCraft(inv, 'charm', new Set())).toEqual({ ok: false, reason: 'rp' });
    inv.rp = 25;
    expect(canCraft(inv, 'charm', new Set())).toEqual({ ok: true });
  });

  it('grants charms in a batch of 2 (not darts) and spends the exact cost', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, shard: 1, spark: 1 });
    inv.rp = 25;
    const result = craft(inv, 'charm', new Set());
    expect(result.inv.charms).toBe(2);
    expect(result.inv.darts).toBe(0); // grants target is 'charms', not 'darts'
    expect(result.inv.fiber).toBe(0);
    expect(result.inv.shard).toBe(0);
    expect(result.inv.spark).toBe(0);
    expect(result.unlocked).toBeUndefined();
    expect(result.kits).toBeUndefined();
  });

  it('the dart recipe still grants darts (grants target is honoured per-recipe)', () => {
    const inv = createInventory();
    grant(inv, { fiber: 3, resin: 1 });
    const result = craft(inv, 'dart', new Set());
    expect(result.inv.darts).toBe(10);
    expect(result.inv.charms).toBe(0);
  });
});

describe('full crafting tree — affordability walk', () => {
  it('every recipe is craftable in tier order once granted its resources + RP, and the final state matches all unlocks/kits/darts/charms', () => {
    const inv = createInventory();
    inv.rp = 200; // clears every tier's RP gate up front
    grant(inv, { fiber: 37, resin: 19, shard: 35, spark: 17 }); // sum of every recipe's cost below (incl. charm, purifier)
    inv.mushroom = 3; // purifier's non-{fiber,resin,shard,spark} cost
    inv.wood = 5; // wall (2) + ramp (3)
    inv.stone = 4; // wall (3) + ramp (1)

    const unlocks = new Set<string>();
    const order: RecipeId[] = RECIPES
      .slice()
      .sort((a, b) => a.tier - b.tier)
      .map((r) => r.id);

    let working = inv;
    for (const id of order) {
      const check = canCraft(working, id, unlocks);
      expect(check).toEqual({ ok: true }); // fails loudly with the recipe id via toEqual diff
      const result = craft(working, id, unlocks);
      working = result.inv;
      if (result.unlocked) unlocks.add(result.unlocked);
    }

    expect(unlocks).toEqual(new Set(['grapple', 'boots', 'glider', 'rocket']));
    expect(working.kits).toEqual({ zipline: 1, beacon: 0, drone: 1 });
    expect(working.darts).toBe(10);
    expect(working.charms).toBe(2);
    expect(working.purifiers).toBe(5);
    expect(working.walls).toBe(4);
    expect(working.ramps).toBe(2);
    expect(working.fiber).toBe(0);
    expect(working.resin).toBe(0);
    expect(working.shard).toBe(0);
    expect(working.spark).toBe(0);
    expect(working.mushroom).toBe(0);
    expect(working.wood).toBe(0);
    expect(working.stone).toBe(0);
  });
});

describe('craft — Purifying Dart (Cursed Castle)', () => {
  it('purifier recipe crafts a batch of 5 into the purifiers counter', () => {
    const inv = createInventory();
    inv.rp = 75;
    inv.mushroom = 3;
    inv.shard = 2;
    inv.fiber = 1;
    expect(canCraft(inv, 'purifier', new Set()).ok).toBe(true);
    const r = craft(inv, 'purifier', new Set());
    expect(r.inv.purifiers).toBe(5);
    expect(r.inv.mushroom).toBe(0);
  });

  it('purifier is RP-gated at 75', () => {
    const inv = createInventory();
    inv.mushroom = 3;
    inv.shard = 2;
    inv.fiber = 1;
    inv.rp = 74;
    expect(canCraft(inv, 'purifier', new Set())).toEqual({ ok: false, reason: 'rp' });
  });
});

describe('craft — wall / ramp (Inventory + Building Task 5)', () => {
  it('wall: tier 1, 25 RP, cost {wood:2, stone:3}, batches 4 into `walls`', () => {
    const inv = createInventory();
    inv.wood = 2;
    inv.stone = 3;
    inv.rp = 24;
    expect(canCraft(inv, 'wall', new Set())).toEqual({ ok: false, reason: 'rp' });
    inv.rp = 25;
    expect(canCraft(inv, 'wall', new Set())).toEqual({ ok: true });
    const r = craft(inv, 'wall', new Set());
    expect(r.inv.walls).toBe(4);
    expect(r.inv.wood).toBe(0);
    expect(r.inv.stone).toBe(0);
    expect(r.inv.ramps).toBe(0);
    expect(r.unlocked).toBeUndefined();
    expect(r.kits).toBeUndefined();
  });

  it('ramp: tier 1, 25 RP, cost {wood:3, stone:1}, batches 2 into `ramps`', () => {
    const inv = createInventory();
    inv.wood = 3;
    inv.stone = 1;
    inv.rp = 25;
    expect(canCraft(inv, 'ramp', new Set())).toEqual({ ok: true });
    const r = craft(inv, 'ramp', new Set());
    expect(r.inv.ramps).toBe(2);
    expect(r.inv.wood).toBe(0);
    expect(r.inv.stone).toBe(0);
    expect(r.inv.walls).toBe(0);
  });

  it('reports insufficient cost when stone is short', () => {
    const inv = createInventory();
    inv.rp = 25;
    inv.wood = 2;
    inv.stone = 1; // wall needs 3
    expect(canCraft(inv, 'wall', new Set())).toEqual({ ok: false, reason: 'cost' });
  });

  it('crafting twice accumulates (batches stack, no once-only gate)', () => {
    const inv = createInventory();
    inv.rp = 25;
    inv.wood = 4;
    inv.stone = 6;
    const first = craft(inv, 'wall', new Set());
    const second = craft(first.inv, 'wall', new Set());
    expect(second.inv.walls).toBe(8);
    expect(second.inv.wood).toBe(0);
    expect(second.inv.stone).toBe(0);
  });
});
