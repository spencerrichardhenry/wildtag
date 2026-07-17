import { TRACKING, WORLD_SEED } from '../core/constants.ts';
import type { ResourceKind } from '../core/types.ts';
import { hash2, mulberry32 } from '../core/rng.ts';
import { speciesById } from '../critters/species.ts';
import { spend, type Inventory } from '../craft/inventory.ts';
import type { Roster, RosterEntry } from '../critters/roster.ts';

// ---------------------------------------------------------------------------
// Barter core (Haven V4) — PURE. No three, no DOM. Each NPC holds one active
// request at a time, drawn from a seeded rotation (deterministic from
// WORLD_SEED + the NPC id + a per-NPC sequence number). Species requests only
// ever ask for species the player has ALREADY Linked (so they're always
// plausibly fulfillable); when nothing is linked yet — or a fair share of the
// time otherwise — the NPC asks for raw resources instead. Fulfilling a
// request consumes goods: critter requests trade away the N OLDEST *idle*
// roster members of that species (never farm/mount-assigned ones — those are
// protected), resource requests spend the inventory. Every fulfilment grants
// the next item from a single global reward track shared across all NPCs.
// ---------------------------------------------------------------------------

export type Request =
  | { kind: 'critters'; speciesId: string; n: number }
  | { kind: 'resources'; resource: ResourceKind; n: number };

/** Per-NPC barter state: which request is live + how many it has fulfilled. */
export interface NpcRequestState {
  npcId: string;
  seq: number;
  request: Request;
  fulfilled: number;
}

// --- Seeded request generation --------------------------------------------

/** Stable string→uint hash (same pattern npcs.ts uses to seed its idle rng). */
function hashStr(s: string): number {
  return (s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) ^ 0x1234) >>> 0;
}

/** A fresh seeded PRNG for (npcId, seq) — deterministic across runs. */
function requestRng(npcId: string, seq: number): () => number {
  const salt = hashStr(npcId);
  const seed = (Math.floor(hash2((WORLD_SEED ^ 0x0ba27e5) >>> 0, salt, seq) * 0x100000000) ^ salt) >>> 0;
  return mulberry32(seed);
}

/** Chance an NPC asks for resources instead of critters when species ARE linked. */
const RESOURCE_REQUEST_CHANCE = 0.35;
/** The three bulk resources (20–60 asked) vs. the rare spark (5–15 asked). */
const BULK_RESOURCES: ResourceKind[] = ['fiber', 'resin', 'shard'];

/**
 * Generate the request for `npcId` at sequence `seq`, given the species the
 * player has Linked. Deterministic: same (npcId, seq, linkedSpecies) → same
 * request. Species requests are drawn ONLY from `linkedSpecies` (so they're
 * always plausibly fulfillable); with no linked species (or ~35% of the time
 * otherwise) the NPC asks for a resource bundle instead. Request size n:
 * 1–3 for rare species (rarity < 0.4), 1–5 otherwise; resources 20–60 of
 * fiber/resin/shard or 5–15 spark.
 */
export function generateRequest(
  npcId: string,
  seq: number,
  linkedSpecies: Set<string>,
): Request {
  const rng = requestRng(npcId, seq);
  // Sort for determinism — a Set's iteration order is insertion order, which
  // can differ between callers; sorting pins the choice to the id alone.
  const linked = [...linkedSpecies].sort();
  const wantResource = linked.length === 0 || rng() < RESOURCE_REQUEST_CHANCE;

  if (!wantResource) {
    const speciesId = linked[Math.floor(rng() * linked.length)]!;
    const rarity = speciesById(speciesId)?.rarity ?? 1;
    const maxN = rarity < 0.4 ? 3 : 5;
    const n = 1 + Math.floor(rng() * maxN);
    return { kind: 'critters', speciesId, n };
  }

  // Resource request: spark is rare (5–15), the bulk trio common (20–60).
  const spark = rng() < 0.25;
  if (spark) {
    return { kind: 'resources', resource: 'spark', n: 5 + Math.floor(rng() * 11) };
  }
  const resource = BULK_RESOURCES[Math.floor(rng() * BULK_RESOURCES.length)]!;
  return { kind: 'resources', resource, n: 20 + Math.floor(rng() * 41) };
}

/**
 * Reroll an NPC's live request WITHOUT granting a reward or consuming anything
 * — the escape hatch for a request the player can no longer meet (e.g. every
 * matching critter is bonded/traded away). Pure: returns a NEW state advanced by
 * one `seq` with a freshly-generated request; `fulfilled` is untouched (a reroll
 * is not a fulfilment). Deterministic — same (state, linked) → same next request.
 */
export function reroll(state: NpcRequestState, linkedSpecies: Set<string>): NpcRequestState {
  const seq = state.seq + 1;
  return { ...state, seq, request: generateRequest(state.npcId, seq, linkedSpecies) };
}

/** Human-readable request line for the dialog ("Bring me 3 Puffles"). */
export function requestText(req: Request): string {
  if (req.kind === 'critters') {
    const name = speciesById(req.speciesId)?.name ?? req.speciesId;
    return `Bring me ${req.n} ${req.n === 1 ? name : `${name}s`}`;
  }
  return `I need ${req.n} ${req.resource}`;
}

// --- Fulfilment ------------------------------------------------------------

/** Idle roster members of `speciesId`, oldest first (roster append order). */
function idleOfSpecies(roster: Roster, speciesId: string): RosterEntry[] {
  return roster.filter((e) => e.speciesId === speciesId && e.status.kind === 'idle');
}

/** True when `req` can be fulfilled from the current roster + inventory. */
export function canFulfill(req: Request, roster: Roster, inventory: Inventory): boolean {
  if (req.kind === 'critters') {
    return idleOfSpecies(roster, req.speciesId).length >= req.n;
  }
  return inventory[req.resource] >= req.n;
}

export interface FulfillResult {
  roster: Roster;
  inventory: Inventory;
  /** The critters traded away (empty for a resource request). */
  delivered: RosterEntry[];
}

/**
 * Fulfil `req` from `roster` + `inventory`. PURE: returns brand-new roster +
 * inventory, never mutates the inputs. Critter requests consume the N OLDEST
 * idle members of the species (assigned ones untouched); resource requests
 * spend the inventory. Returns `null` when the request can't be met — callers
 * gate on `canFulfill` first (the debug force-path handles the rest).
 */
export function fulfill(req: Request, roster: Roster, inventory: Inventory): FulfillResult | null {
  if (!canFulfill(req, roster, inventory)) return null;

  if (req.kind === 'critters') {
    const delivered = idleOfSpecies(roster, req.speciesId).slice(0, req.n);
    const takeIds = new Set(delivered.map((e) => e.id));
    const nextRoster = roster.filter((e) => !takeIds.has(e.id));
    return { roster: nextRoster, inventory, delivered };
  }

  const nextInv = spend(inventory, { [req.resource]: req.n });
  if (!nextInv) return null;
  return { roster, inventory: nextInv, delivered: [] };
}

// --- Reward track ----------------------------------------------------------

export interface Reward {
  /** Reward id ('saddle' / 'plotDeed' / 'goldenDart' / 'whistle' /
   *  'lanternCharm' / 'bundle'). Uniques share their id; bundles are all 'bundle'. */
  id: string;
  kind: 'unique' | 'bundle';
  name: string;
  description: string;
  /** Set for bundles: the resource granted and how much. */
  resource?: ResourceKind;
  amount?: number;
}

/** The fixed, global unique-reward order (spec §3). Plot Deed appears twice. */
const UNIQUE_TRACK: Reward[] = [
  { id: 'saddle', kind: 'unique', name: 'Saddle', description: 'Unlocks riding a bonded Prismhorse.' },
  { id: 'plotDeed', kind: 'unique', name: 'Plot Deed', description: 'Expands the farm by two plots.' },
  { id: 'plotDeed', kind: 'unique', name: 'Plot Deed', description: 'Expands the farm by two plots.' },
  { id: 'goldenDart', kind: 'unique', name: 'Golden Dart Tip', description: 'Tracking rings fill 1.5× faster.' },
  { id: 'whistle', kind: 'unique', name: 'Critter Whistle', description: 'Summon your mount to your side.' },
  { id: 'lanternCharm', kind: 'unique', name: 'Lantern Charm', description: 'A soft personal light for the night.' },
];

/** Rotating resource bundles handed out once the uniques run out. */
const BUNDLE_ROTATION: { resource: ResourceKind; amount: number }[] = [
  { resource: 'fiber', amount: 30 },
  { resource: 'resin', amount: 20 },
  { resource: 'shard', amount: 10 },
  { resource: 'spark', amount: 5 },
];

/** Number of unique (non-bundle) rewards on the track. */
export const UNIQUE_REWARD_COUNT = UNIQUE_TRACK.length;

/**
 * The reward granted for the `grantedCount`-th fulfilment (0-indexed): the
 * uniques in order first, then infinite rotating resource bundles.
 */
export function nextReward(grantedCount: number): Reward {
  if (grantedCount < UNIQUE_TRACK.length) return UNIQUE_TRACK[grantedCount]!;
  const b = BUNDLE_ROTATION[(grantedCount - UNIQUE_TRACK.length) % BUNDLE_ROTATION.length]!;
  const noun = b.resource.charAt(0).toUpperCase() + b.resource.slice(1);
  return {
    id: 'bundle',
    kind: 'bundle',
    name: `${noun} Bundle`,
    description: `${b.amount} ${b.resource}.`,
    resource: b.resource,
    amount: b.amount,
  };
}

// --- Golden Dart tracking multiplier (pure) --------------------------------

/**
 * Tracking-ring fill-rate multiplier given the owned rewards: 1.5× once the
 * Golden Dart Tip has been granted, otherwise 1. The tracker multiplies its
 * inside-ring accrual by this (see tracking/progress.ts stepTracking).
 */
export function trackingFillRate(rewards: Set<string>): number {
  return rewards.has('goldenDart') ? TRACKING.goldenDartFill : 1;
}
