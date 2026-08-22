import { UNDERWATER } from '../core/constants.ts';
import type { Inventory } from '../craft/inventory.ts';
import { spend } from '../craft/inventory.ts';
import type { ResourceKind } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure breath + freed-elf trade rules. Rendering, HP damage, interaction
// distance, and toasts stay in main.ts; this module only owns deterministic
// progression math.
// ---------------------------------------------------------------------------

export interface BreathState {
  remaining: number;
  /** Time accumulated at zero breath toward the next drowning hit. */
  drownClock: number;
}

export function clampBreathLevel(level: number): number {
  return Math.min(UNDERWATER.breathUpgradeCount, Math.max(0, Math.floor(level)));
}

export function breathMax(level: number): number {
  return UNDERWATER.breathBaseS + clampBreathLevel(level) * UNDERWATER.breathPerUpgradeS;
}

export function createBreath(level = 0): BreathState {
  return { remaining: breathMax(level), drownClock: 0 };
}

export interface BreathStep {
  state: BreathState;
  /** Number of periodic drowning hits crossed during this step. */
  drownHits: number;
}

/** Drain while the camera is submerged; rapidly refill at the surface. */
export function stepBreath(
  state: BreathState,
  submerged: boolean,
  dt: number,
  level: number,
): BreathStep {
  const max = breathMax(level);
  if (!submerged) {
    return {
      state: {
        remaining: Math.min(max, state.remaining + UNDERWATER.breathRefillPerS * dt),
        drownClock: 0,
      },
      drownHits: 0,
    };
  }

  const before = Math.max(0, Math.min(max, state.remaining));
  const remaining = Math.max(0, before - dt);
  if (remaining > 0) return { state: { remaining, drownClock: 0 }, drownHits: 0 };

  // Only the fraction of a coarse step AFTER air reached zero contributes to
  // drowning. At fixed 60 Hz this distinction is tiny, but keeping the pure
  // primitive exact prevents a large test/debug time step from minting a
  // whole burst of damage while it was still consuming the final breath.
  const zeroFor = before <= 0 ? dt : Math.max(0, dt - before);
  const clock = (before <= 0 ? state.drownClock : 0) + zeroFor;
  const drownHits = Math.floor(clock / UNDERWATER.drownHitEveryS);
  return {
    state: {
      remaining: 0,
      drownClock: clock - drownHits * UNDERWATER.drownHitEveryS,
    },
    drownHits,
  };
}

export interface BreathTrade {
  level: 1 | 2;
  name: string;
  cost: Partial<Record<ResourceKind, number>>;
}

export const BREATH_TRADES: readonly BreathTrade[] = [
  // Castle-era ingredients keep the breathing path available before the
  // first serious dive. Shells/scales remain dedicated to the two items the
  // underwater enemies explicitly unlock: Tide Darts and the Currentboard.
  { level: 1, name: 'Bubble Charm', cost: { mushroom: 3, spark: 2 } },
  { level: 2, name: 'Deepwater Pearl', cost: { shard: 6, spark: 4 } },
];

export type BreathTradeReason = 'castle' | 'complete' | 'cost';

export type BreathTradeResult =
  | { ok: true; inventory: Inventory; level: number; trade: BreathTrade }
  | { ok: false; reason: BreathTradeReason; trade: BreathTrade | null };

/** Buy the next breath upgrade from any freed elf. Pure and all-or-nothing. */
export function tradeForBreath(
  inventory: Inventory,
  level: number,
  castlePurified: boolean,
): BreathTradeResult {
  if (!castlePurified) return { ok: false, reason: 'castle', trade: null };
  const current = clampBreathLevel(level);
  const trade = BREATH_TRADES[current] ?? null;
  if (!trade) return { ok: false, reason: 'complete', trade: null };
  const paid = spend(inventory, trade.cost);
  if (!paid) return { ok: false, reason: 'cost', trade };
  return { ok: true, inventory: paid, level: trade.level, trade };
}

/** Short human-readable cost used by the interaction toast. */
export function breathTradeCostText(trade: BreathTrade): string {
  return Object.entries(trade.cost)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(' + ');
}
