import { describe, expect, it } from 'vitest';
import {
  assign,
  createHotbar,
  itemCount,
  migrateLegacy,
  select,
  selectStep,
  type HotbarState,
  type ItemId,
} from '../src/craft/hotbar.ts';
import { createInventory } from '../src/craft/inventory.ts';

describe('createHotbar', () => {
  it('starts with darts in slot 0, the rest null, and slot 0 selected', () => {
    const h = createHotbar();
    expect(h.slots).toEqual(['darts', null, null, null, null, null]);
    expect(h.slots).toHaveLength(6);
    expect(h.selected).toBe(0);
  });
});

describe('assign', () => {
  it('places an item into an empty slot, returning a new object', () => {
    const h = createHotbar();
    const next = assign(h, 2, 'charms');
    expect(next.slots[2]).toBe('charms');
    expect(next).not.toBe(h);
    // pure: original untouched
    expect(h.slots[2]).toBeNull();
  });

  it('clears a slot when assigning null', () => {
    const h = createHotbar();
    const next = assign(h, 0, null);
    expect(next.slots[0]).toBeNull();
  });

  it('MOVES an item already assigned elsewhere rather than duplicating it', () => {
    const h = createHotbar(); // darts in slot 0
    const next = assign(h, 3, 'darts');
    expect(next.slots[3]).toBe('darts');
    expect(next.slots[0]).toBeNull();
    // no dupes anywhere
    expect(next.slots.filter((s) => s === 'darts')).toHaveLength(1);
  });

  it('overwrites whatever previously occupied the destination slot', () => {
    const h = createHotbar();
    const withCharms = assign(h, 1, 'charms');
    const next = assign(withCharms, 1, 'purifiers');
    expect(next.slots[1]).toBe('purifiers');
  });

  it('does not mutate selected', () => {
    const h = select(createHotbar(), 4);
    const next = assign(h, 2, 'kit:drone');
    expect(next.selected).toBe(4);
  });
});

describe('select', () => {
  it('sets selected to the given slot', () => {
    const h = createHotbar();
    expect(select(h, 3).selected).toBe(3);
  });

  it('is pure', () => {
    const h = createHotbar();
    const next = select(h, 5);
    expect(h.selected).toBe(0);
    expect(next).not.toBe(h);
  });
});

describe('selectStep', () => {
  it('steps forward by 1', () => {
    const h = select(createHotbar(), 2);
    expect(selectStep(h, 1).selected).toBe(3);
  });

  it('steps backward by 1', () => {
    const h = select(createHotbar(), 2);
    expect(selectStep(h, -1).selected).toBe(1);
  });

  it('wraps forward past the last slot (5 -> 0)', () => {
    const h = select(createHotbar(), 5);
    expect(selectStep(h, 1).selected).toBe(0);
  });

  it('wraps backward past the first slot (0 -> 5)', () => {
    const h = select(createHotbar(), 0);
    expect(selectStep(h, -1).selected).toBe(5);
  });
});

describe('migrateLegacy', () => {
  it('maps the old fixed slots into the new 6-slot layout', () => {
    const h = migrateLegacy();
    expect(h.slots).toEqual(['darts', 'kit:zipline', 'kit:drone', 'purifiers', null, null]);
    expect(h.selected).toBe(0);
  });
});

describe('itemCount', () => {
  it('reads darts/purifiers/charms straight off the inventory', () => {
    const inv = createInventory();
    inv.darts = 4;
    inv.purifiers = 2;
    inv.charms = 1;
    expect(itemCount(inv, 'darts')).toBe(4);
    expect(itemCount(inv, 'purifiers')).toBe(2);
    expect(itemCount(inv, 'charms')).toBe(1);
  });

  it('reads kit counts via inv.kits', () => {
    const inv = createInventory();
    inv.kits = { zipline: 3, beacon: 0, drone: 5 };
    expect(itemCount(inv, 'kit:zipline')).toBe(3);
    expect(itemCount(inv, 'kit:drone')).toBe(5);
  });

  it('returns 0 for wall/ramp — Task 5 has not wired their counters yet', () => {
    const inv = createInventory();
    expect(itemCount(inv, 'wall')).toBe(0);
    expect(itemCount(inv, 'ramp')).toBe(0);
  });
});

// Sanity: the exported types compose the way Tasks 3/5 will rely on.
describe('type shape', () => {
  it('HotbarState has 6-element slots + a selected index', () => {
    const h: HotbarState = createHotbar();
    const ids: (ItemId | null)[] = h.slots;
    expect(ids).toHaveLength(6);
  });
});
