import type { Vec3 } from './types.ts';
import { PLAYER_START } from './constants.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { StructuresSave } from '../structures/placement.ts';
import type { RosterEntry } from '../critters/roster.ts';
import type { FarmState } from '../farm/farm.ts';

// ---------------------------------------------------------------------------
// Save v1 (Task 14). Plain JSON, version-guarded. `encodeSave`/`decodeSave`
// are pure (no localStorage, no window) so they're trivially unit-testable;
// `loadSave`/`writeSave`/`clearSave` are the thin browser glue on top,
// reading/writing `localStorage['wildtag-save-v1']`. A missing or malformed
// save (wrong/absent `v`, JSON.parse throwing, wrong shape) always resolves
// to `null` — the caller's contract is "null → fresh start", never a thrown
// exception.
// ---------------------------------------------------------------------------

/** Per-slot persisted critter gameplay flags (mirrors CritterManager's registry). */
export interface CritterPersistEntry {
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
  species?: string;
}

export interface SaveV1 {
  v: 1;
  inventory: Inventory;
  unlocks: string[];
  /** Keyed by critter slot id (as a string key in the JSON object). */
  critterPersist: Record<number, CritterPersistEntry>;
  structures: StructuresSave;
  player: { pos: Vec3; yaw: number };
  /** Ids of first-run HUD hints already shown (see ui/hud.ts get/setHintFlags). */
  hints: string[];
  /**
   * Haven V2: bonded critters. Optional + shape-guarded (defaults []) so v1
   * saves written before Haven load losslessly. The save version stays 1 until
   * Haven V7 bumps it.
   */
  roster?: RosterEntry[];
  /**
   * Haven V4 (barter). All optional + shape-guarded (default []) so older saves
   * load losslessly. `barter` is the per-NPC request rotation state (the live
   * request is regenerated deterministically from seq + linkedSpecies on load);
   * `pens` are the traded-away critters living at each NPC's pen; `rewards` is
   * the ordered granted-reward id list ('plotDeed' may appear twice).
   */
  barter?: BarterPersistEntry[];
  pens?: PenPersistEntry[];
  rewards?: string[];
  /**
   * Haven V5: farm plots (unlock flags / assignments / hoppers / progress).
   * Optional + shape-guarded (a malformed or absent farm is simply dropped, so
   * pre-Haven-V5 saves load losslessly). The save version stays 1 until V7.
   */
  farm?: FarmState;
}

/** Persisted per-NPC barter rotation state (Haven V4). */
export interface BarterPersistEntry {
  npcId: string;
  seq: number;
  fulfilled: number;
}

/** A traded-away critter living at an NPC's pen (Haven V4). */
export interface PenPersistEntry {
  npcId: string;
  speciesId: string;
  nickname: string;
}

export const SAVE_KEY = 'wildtag-save-v1';

/** Serialize a save state to a JSON string. Pure. */
export function encodeSave(state: SaveV1): string {
  return JSON.stringify(state);
}

function isVec3(v: unknown): v is Vec3 {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);
}

/**
 * Element-shape guards for the structures arrays. A malformed ELEMENT (e.g. a
 * hand-edited `ziplines: [{}]`) is dropped while its valid siblings — and the
 * rest of the save — survive; without this, a bad element would pass decode
 * and then throw inside ZiplineSystem.buildMesh during boot.
 */
function isZiplineEntry(z: unknown): boolean {
  if (!z || typeof z !== 'object') return false;
  const e = z as Record<string, unknown>;
  return typeof e.id === 'string' && isVec3(e.a) && isVec3(e.b);
}

function isDroneEntry(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const e = d as Record<string, unknown>;
  return typeof e.id === 'string' && Number.isFinite(e.x) && Number.isFinite(e.z);
}

/**
 * Element-shape guard for a roster entry (Haven V2). A malformed entry is
 * dropped while valid siblings — and the rest of the save — survive. Only the
 * reachable-this-task 'idle' status plus the forward-declared 'farm'/'mount'
 * shapes are accepted.
 */
function isRosterEntry(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const e = r as Record<string, unknown>;
  if (!Number.isFinite(e.id) || typeof e.speciesId !== 'string' || typeof e.nickname !== 'string') {
    return false;
  }
  const st = e.status as Record<string, unknown> | undefined;
  if (!st || typeof st !== 'object') return false;
  if (st.kind === 'idle' || st.kind === 'mount') return true;
  if (st.kind === 'farm' && Number.isFinite(st.plotId)) return true;
  return false;
}

/** Element guard for a persisted barter rotation entry (Haven V4). */
function isBarterEntry(b: unknown): boolean {
  if (!b || typeof b !== 'object') return false;
  const e = b as Record<string, unknown>;
  return typeof e.npcId === 'string' && Number.isFinite(e.seq) && Number.isFinite(e.fulfilled);
}

/** Element guard for a persisted pen critter (Haven V4). */
function isPenEntry(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const e = p as Record<string, unknown>;
  return (
    typeof e.npcId === 'string' &&
    typeof e.speciesId === 'string' &&
    typeof e.nickname === 'string'
  );
}

/**
 * Shape guard for the optional farm block (Haven V5). A valid farm is
 * `{ plots: Plot[] }` where each plot has a finite id, boolean `unlocked`,
 * `assigned` of number|null, a plain-object hopper of finite counts, and finite
 * progress. Anything else returns undefined so the caller drops the field and
 * rebuilds a fresh farm — a malformed farm never rejects the whole save.
 */
function parseFarm(v: unknown): FarmState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const plots = (v as Record<string, unknown>).plots;
  if (!Array.isArray(plots)) return undefined;
  const out: FarmState = { plots: [] };
  for (const raw of plots) {
    if (!raw || typeof raw !== 'object') return undefined;
    const p = raw as Record<string, unknown>;
    if (!Number.isFinite(p.id)) return undefined;
    if (typeof p.unlocked !== 'boolean') return undefined;
    if (!(p.assigned === null || Number.isFinite(p.assigned))) return undefined;
    if (!Number.isFinite(p.progress)) return undefined;
    if (!p.hopper || typeof p.hopper !== 'object') return undefined;
    const hopper: FarmState['plots'][number]['hopper'] = {};
    for (const k of ['fiber', 'resin', 'shard', 'spark'] as const) {
      const n = (p.hopper as Record<string, unknown>)[k];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
      hopper[k] = n;
    }
    out.plots.push({
      id: p.id as number,
      unlocked: p.unlocked as boolean,
      assigned: (p.assigned as number | null) ?? null,
      hopper,
      progress: p.progress as number,
    });
  }
  return out;
}

/**
 * Parse + validate a save JSON string. Returns `null` (never throws) for
 * garbage input, a missing/wrong `v` (version guard), or any structurally
 * unsound shape — the caller always falls back to a fresh start.
 */
export function decodeSave(json: string): SaveV1 | null {
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (!o.inventory || typeof o.inventory !== 'object') return null;
    // Field-level inventory guard: every resource/rp/darts count must be a
    // finite number ≥ 0 (a tampered/garbage value rejects the whole save →
    // fresh start). `kits` is forward-compat: a missing object defaults to
    // zeros rather than rejecting, but any present kit count is validated.
    const inv = o.inventory as Record<string, unknown>;
    const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    for (const f of ['fiber', 'resin', 'shard', 'spark', 'rp', 'darts'] as const) {
      if (!isCount(inv[f])) return null;
    }
    // `charms` mirrors `darts` but is forward-compat: a v1 save written before
    // Haven has no `charms`, so a missing value defaults to 0; any present
    // value is still validated (a tampered/negative count rejects the save).
    if (inv.charms !== undefined && !isCount(inv.charms)) return null;
    const charms = isCount(inv.charms) ? (inv.charms as number) : 0;
    const kits: Inventory['kits'] = { zipline: 0, beacon: 0, drone: 0 };
    if (inv.kits !== undefined && inv.kits !== null) {
      if (typeof inv.kits !== 'object') return null;
      const k = inv.kits as Record<string, unknown>;
      for (const id of ['zipline', 'beacon', 'drone'] as const) {
        if (k[id] === undefined) continue; // missing individual kit → default 0
        if (!isCount(k[id])) return null;
        kits[id] = k[id] as number;
      }
    }
    const inventory: Inventory = {
      fiber: inv.fiber as number,
      resin: inv.resin as number,
      shard: inv.shard as number,
      spark: inv.spark as number,
      rp: inv.rp as number,
      darts: inv.darts as number,
      charms,
      kits,
    };
    if (!Array.isArray(o.unlocks) || !o.unlocks.every((u) => typeof u === 'string')) return null;
    if (!o.critterPersist || typeof o.critterPersist !== 'object') return null;
    if (!o.structures || typeof o.structures !== 'object') return null;
    const structures = o.structures as Record<string, unknown>;
    if (!Array.isArray(structures.ziplines) || !Array.isArray(structures.drones)) return null;
    if (!o.player || typeof o.player !== 'object') return null;
    const player = o.player as Record<string, unknown>;
    if (!isVec3(player.pos) || typeof player.yaw !== 'number') return null;
    if (!Array.isArray(o.hints) || !o.hints.every((h) => typeof h === 'string')) return null;
    // Roster (Haven V2): optional, defaults []. Missing/absent on a v1 save is
    // fine; a present non-array rejects; malformed elements are dropped while
    // valid siblings survive (mirrors the structures element guards).
    let roster: RosterEntry[] = [];
    if (o.roster !== undefined && o.roster !== null) {
      if (!Array.isArray(o.roster)) return null;
      roster = o.roster.filter(isRosterEntry) as RosterEntry[];
    }
    // Barter/pens/rewards (Haven V4): all optional, default []. A present
    // non-array rejects; malformed elements are dropped, valid siblings survive.
    let barter: BarterPersistEntry[] = [];
    if (o.barter !== undefined && o.barter !== null) {
      if (!Array.isArray(o.barter)) return null;
      barter = o.barter.filter(isBarterEntry) as BarterPersistEntry[];
    }
    let pens: PenPersistEntry[] = [];
    if (o.pens !== undefined && o.pens !== null) {
      if (!Array.isArray(o.pens)) return null;
      pens = o.pens.filter(isPenEntry) as PenPersistEntry[];
    }
    let rewards: string[] = [];
    if (o.rewards !== undefined && o.rewards !== null) {
      if (!Array.isArray(o.rewards) || !o.rewards.every((r) => typeof r === 'string')) return null;
      rewards = o.rewards as string[];
    }
    // Farm (Haven V5): optional, shape-guarded, dropped if malformed.
    const farm = parseFarm(o.farm);
    // Sanitize structure elements: drop malformed entries, keep valid siblings
    // (and the rest of the save) so a partly-corrupt save never crashes boot.
    const sanitized: Record<string, unknown> = {
      ...o,
      inventory,
      structures: {
        ziplines: structures.ziplines.filter(isZiplineEntry),
        drones: structures.drones.filter(isDroneEntry),
      },
      roster,
      farm,
    };
    // Only surface the Haven V4 fields when the input actually carried them, so
    // saves written before V4 decode to exactly their old shape (no phantom
    // empty keys) — matching how those callers round-trip.
    if (o.barter !== undefined && o.barter !== null) sanitized.barter = barter;
    if (o.pens !== undefined && o.pens !== null) sanitized.pens = pens;
    if (o.rewards !== undefined && o.rewards !== null) sanitized.rewards = rewards;
    return sanitized as unknown as SaveV1;
  } catch {
    return null;
  }
}

/** Read + decode the save from `storage` (defaults to `window.localStorage`). */
export function loadSave(storage: Storage = window.localStorage): SaveV1 | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  return decodeSave(raw);
}

/**
 * Latched true by `clearSave` (the "Reset Save" path). Both reset call sites
 * (`main.ts` resetSave, the pause-screen button) clear the save and then
 * `location.reload()` — and that reload fires the `beforeunload`/`pagehide`
 * autosave, which would otherwise re-create the save from the still-in-memory
 * (un-reset) state and silently defeat the reset. Once a reset is requested the
 * page is about to be replaced, so suppressing every subsequent write for the
 * remainder of this page's life is exactly correct (a fresh page starts with
 * the flag false again).
 */
let saveSuppressed = false;

/** Encode + write a save to `storage` (defaults to `window.localStorage`). */
export function writeSave(state: SaveV1, storage: Storage = window.localStorage): void {
  if (saveSuppressed) return;
  storage.setItem(SAVE_KEY, encodeSave(state));
}

/**
 * Remove the save from `storage` (defaults to `window.localStorage`) and latch
 * off all further writes this page life (see `saveSuppressed`) so the imminent
 * reset-reload's unload autosave can't resurrect the cleared save.
 */
export function clearSave(storage: Storage = window.localStorage): void {
  saveSuppressed = true;
  storage.removeItem(SAVE_KEY);
}

/**
 * Resolve the inventory a boot should start with. A loaded save's own dart
 * (and every other resource) count always wins untouched; a brand-new game
 * (no save, or `?fresh=1`) instead gets `base` plus the starting dart
 * loadout. Pure — `createInventory()` itself stays a zero-value constructor;
 * this is the one place `PLAYER_START.startingDarts` is ever applied.
 */
export function applyStartingLoadout(base: Inventory, loaded: SaveV1 | null): Inventory {
  if (loaded) return { ...loaded.inventory, kits: { ...loaded.inventory.kits } };
  return { ...base, kits: { ...base.kits }, darts: base.darts + PLAYER_START.startingDarts };
}
