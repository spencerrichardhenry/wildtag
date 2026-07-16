// ---------------------------------------------------------------------------
// Bonded-roster core (Haven V2). Pure data: no three, no DOM. A RosterEntry is
// one critter the player has bonded out of the wild via a Bond Charm. Statuses
// are defined in full now (design spec §1) but only 'idle' is reachable this
// task — 'farm'/'mount' are wired by later Haven tasks (V5/V6).
//
// `bond` REQUIRES a Linked view (Link first = research, then capture — the
// two-step Spencer chose) and generates a nickname deterministically from a
// fixed 24-name pool via the caller's rng, so the same seed → the same name.
// ---------------------------------------------------------------------------

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

/**
 * Bond `view` into `roster`. Returns a NEW roster (never mutates the input)
 * plus the created entry, or `null` when `view` is not Linked (you must Link a
 * critter before you can bond it). The nickname is a deterministic pick from
 * NAME_POOL via `rng`.
 */
export function bond(
  roster: Roster,
  view: BondableView,
  rng: () => number,
): { roster: Roster; entry: RosterEntry } | null {
  if (!view.linked) return null;
  const nickname = NAME_POOL[Math.floor(rng() * NAME_POOL.length)] ?? NAME_POOL[0]!;
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
