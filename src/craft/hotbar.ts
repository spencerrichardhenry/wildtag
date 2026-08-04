import type { Inventory } from './inventory.ts';

// ---------------------------------------------------------------------------
// Hotbar: the 6-slot assignable loadout (Inventory+Building Task 2). Pure —
// no three, no DOM — so it's trivially unit-testable and safe for
// src/core/save.ts to import from. Consumed by Task 3 (HUD render + input:
// wheel/Digit1-6) and Task 5 (wall/ramp placement selection).
// ---------------------------------------------------------------------------

/** Everything assignable to a hotbar slot. Grapple is NOT here — it stays
 * permanently equipped (right hand, RMB) per the design decision to keep it
 * off the hotbar entirely. */
export type ItemId = 'darts' | 'purifiers' | 'charms' | 'kit:zipline' | 'kit:drone' | 'wall' | 'ramp';

/** Every assignable `ItemId`, in canonical order — used by the inventory
 * screen (Task 3) to enumerate the owned-items picker without duplicating
 * this list. */
export const ITEM_IDS: readonly ItemId[] = [
  'darts',
  'purifiers',
  'charms',
  'kit:zipline',
  'kit:drone',
  'wall',
  'ramp',
];

/** Runtime type guard for `ItemId` — used by `src/core/save.ts` to validate
 * each persisted slot string without this module knowing anything about the
 * save format. */
export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v);
}

export const NUM_SLOTS = 6;

export interface HotbarState {
  /** Exactly `NUM_SLOTS` (6) entries; `null` means the slot is empty. */
  slots: (ItemId | null)[];
  /** Currently-selected slot index, always 0..NUM_SLOTS-1. */
  selected: number;
}

function clampSlot(slot: number): number {
  return Math.min(Math.max(Math.trunc(slot), 0), NUM_SLOTS - 1);
}

/** A fresh hotbar: darts in slot 0, everything else empty, slot 0 selected —
 * the fresh-start loadout (as opposed to `migrateLegacy`, the pre-Task-2 save
 * loadout). */
export function createHotbar(): HotbarState {
  return { slots: ['darts', null, null, null, null, null], selected: 0 };
}

/**
 * Assign `item` to `slot`, returning a NEW `HotbarState` (never mutates `h`).
 * If `item` is already assigned to a different slot, it is MOVED there — the
 * hotbar never holds two copies of the same item. Passing `item: null` clears
 * `slot`.
 */
export function assign(h: HotbarState, slot: number, item: ItemId | null): HotbarState {
  const slots = [...h.slots];
  if (item !== null) {
    const existing = slots.indexOf(item);
    if (existing !== -1) slots[existing] = null;
  }
  slots[clampSlot(slot)] = item;
  return { slots, selected: h.selected };
}

/** Select `slot` outright (e.g. Digit1-6). Clamps to 0..5; pure. */
export function select(h: HotbarState, slot: number): HotbarState {
  return { slots: h.slots, selected: clampSlot(slot) };
}

/** Step the selection by `dir` (scroll wheel), wrapping around both ends. */
export function selectStep(h: HotbarState, dir: 1 | -1): HotbarState {
  const next = (h.selected + dir + NUM_SLOTS) % NUM_SLOTS;
  return { slots: h.slots, selected: next };
}

/**
 * The loadout a pre-Task-2 save migrates to: the old fixed slots (darts,
 * zipline kit, drone kit, purify darts) map straight across in their old
 * order; grapple drops off the hotbar entirely (it's permanently equipped);
 * the two new slots start empty.
 */
export function migrateLegacy(): HotbarState {
  return { slots: ['darts', 'kit:zipline', 'kit:drone', 'purifiers', null, null], selected: 0 };
}

/**
 * Map a hotbar `item` to its owned count in `inv`, for HUD count badges and
 * "empty slot" LMB no-ops. `'wall'`/`'ramp'` read `Inventory.walls`/`.ramps`
 * (Task 5 — mirrors the `charms`/`purifiers` optional-save pattern).
 */
export function itemCount(inv: Inventory, item: ItemId): number {
  switch (item) {
    case 'darts':
      return inv.darts;
    case 'purifiers':
      return inv.purifiers;
    case 'charms':
      return inv.charms;
    case 'kit:zipline':
      return inv.kits.zipline;
    case 'kit:drone':
      return inv.kits.drone;
    case 'wall':
      return inv.walls;
    case 'ramp':
      return inv.ramps;
  }
}
