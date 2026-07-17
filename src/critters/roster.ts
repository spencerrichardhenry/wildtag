// ---------------------------------------------------------------------------
// Bonded-roster core (Haven V2). Pure data: no three, no DOM. A RosterEntry is
// one critter the player has bonded out of the wild via a Bond Charm. Statuses
// are defined in full now (design spec §1) but only 'idle' is reachable this
// task — 'farm'/'mount' are wired by later Haven tasks (V5/V6).
//
// `bond` REQUIRES a Linked view (Link first = research, then capture — the
// two-step Spencer chose) and names the critter from a monotonic `nameIndex`
// cursor into a fixed, seeded SHUFFLE of the 24-name pool: sequential bonds hand
// out distinct, varied names, and only repeat after the pool is exhausted. The
// caller persists the cursor (save `nameCursor`) so names never collide across
// reloads — a raw per-boot PRNG (the old approach) could re-mint a live name.
// ---------------------------------------------------------------------------

import { mulberry32 } from '../core/rng.ts';
import { WORLD_SEED } from '../core/constants.ts';

export type RosterStatus =
  | { kind: 'idle' }
  | { kind: 'farm'; plotId: number }
  | { kind: 'mount' };

export interface RosterEntry {
  /** The wild critter slot id this bonded critter came from (stable). */
  id: number;
  speciesId: string;
  nickname: string;
  status: RosterStatus;
}

export type Roster = RosterEntry[];

/**
 * The minimal live-critter shape `bond` needs — a structural subset of the
 * manager's CritterView, so callers can pass a view straight through.
 */
export interface BondableView {
  id: number;
  speciesId: string;
  linked: boolean;
}

/**
 * 24 whimsical nicknames. Picked deterministically by `bond` via the caller's
 * rng so a seeded run always names critters the same way.
 */
export const NAME_POOL: readonly string[] = [
  'Doodle',
  'Sir Hops',
  'Miriam',
  'Beans',
  'Waffle',
  'Pip',
  'Noodle',
  'Biscuit',
  'Zonk',
  'Marbles',
  'Tuffet',
  'Gizmo',
  'Puddle',
  'Snorkel',
  'Bramble',
  'Wobbles',
  'Nugget',
  'Clover',
  'Mochi',
  'Fitz',
  'Jangle',
  'Poppy',
  'Tumble',
  'Quill',
];

/** Fisher-Yates shuffle of a copy of `pool` via the injected rng (pure). */
function shuffle(pool: readonly string[], rng: () => number): string[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * NAME_POOL in a fixed, seeded shuffle so a monotonic `nameIndex` cursor hands
 * out varied (non-pool-order) names deterministically across runs.
 */
const SHUFFLED_NAMES: readonly string[] = shuffle(NAME_POOL, mulberry32((WORLD_SEED ^ 0x0b0d) >>> 0));

/**
 * The nickname for bond number `index` (0-based cursor): cycles the shuffled
 * pool, so duplicates only appear once all NAME_POOL names have been used.
 */
export function nickForIndex(index: number): string {
  const n = SHUFFLED_NAMES.length;
  const i = ((Math.floor(index) % n) + n) % n;
  return SHUFFLED_NAMES[i]!;
}

/**
 * Bond `view` into `roster`. Returns a NEW roster (never mutates the input)
 * plus the created entry, or `null` when `view` is not Linked (you must Link a
 * critter before you can bond it). The nickname is `nickForIndex(nameIndex)` —
 * the caller advances (and persists) the `nameIndex` cursor so names stay unique
 * across the session and across reloads.
 */
export function bond(
  roster: Roster,
  view: BondableView,
  nameIndex: number,
): { roster: Roster; entry: RosterEntry } | null {
  if (!view.linked) return null;
  const nickname = nickForIndex(nameIndex);
  const entry: RosterEntry = {
    id: view.id,
    speciesId: view.speciesId,
    nickname,
    status: { kind: 'idle' },
  };
  return { roster: [...roster, entry], entry };
}

/** New roster with the entry `id` removed (no-op copy if absent). Pure. */
export function release(roster: Roster, id: number): Roster {
  return roster.filter((e) => e.id !== id);
}

/** The roster entry with `id`, or undefined. */
export function byId(roster: Roster, id: number): RosterEntry | undefined {
  return roster.find((e) => e.id === id);
}

/** How many bonded critters of `speciesId` are on the roster. */
export function count(roster: Roster, speciesId: string): number {
  let n = 0;
  for (const e of roster) if (e.speciesId === speciesId) n++;
  return n;
}
