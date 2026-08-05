import type { Vec3 } from './types.ts';
import { PLAYER_START } from './constants.ts';
import type { Inventory } from '../craft/inventory.ts';
import { isItemId } from '../craft/hotbar.ts';
import type { StructuresSave } from '../structures/placement.ts';
import type { RosterEntry } from '../critters/roster.ts';
import type { FarmState } from '../farm/farm.ts';
import type { Request } from '../village/barter.ts';

// ---------------------------------------------------------------------------
// Save v3 (Task 14 → Haven V7; Cursed Castle → v3). Plain JSON, version-guarded.
// `encodeSave`/`decodeSave` are pure (no localStorage, no window) so they're
// trivially unit-testable; `loadSave`/`writeSave`/`clearSave` are the thin
// browser glue on top, reading/writing `localStorage[SAVE_KEY]`. A missing or
// malformed save (wrong/absent `v`, JSON.parse throwing, wrong shape) always
// resolves to `null` — the caller's contract is "null → fresh start", never a
// thrown exception.
//
// VERSION HISTORY / MIGRATION (v1 → v2 → v3):
//   v1 (Task 14) was the pre-Haven shape. The Haven fields (roster, barter,
//   pens, rewards, farm, mount, inventory.charms) were shipped INCREMENTALLY as
//   optional add-ons ON TOP of v1 across V2–V6 — a v1 save simply lacked them.
//   V7 bumped the on-disk version to 2 to mark "Haven-complete". Cursed Castle
//   bumps it again to 3, adding `daylightT`/`elves`/`castlePurified` — again
//   shipped as optional add-ons so v1/v2 saves migrate losslessly. `decodeSave`
//   MIGRATES v1/v2 → v3: it accepts any of the three versions, defaults every
//   absent field to its empty value, and always returns a v3-shaped object. So
//   a pure-v1 save (no Haven/castle keys) loads losslessly into the v3 shape; a
//   v2 or v3 save round-trips; anything else (`v` absent/other, garbage,
//   unsound) → null.
// ---------------------------------------------------------------------------

/** Per-slot persisted critter gameplay flags (mirrors CritterManager's registry). */
export interface CritterPersistEntry {
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
  species?: string;
}

export interface SaveV3 {
  v: 3;
  inventory: Inventory;
  unlocks: string[];
  /** Keyed by critter slot id (as a string key in the JSON object). */
  critterPersist: Record<number, CritterPersistEntry>;
  structures: StructuresSave;
  player: { pos: Vec3; yaw: number };
  /** Ids of first-run HUD hints already shown (see ui/hud.ts get/setHintFlags). */
  hints: string[];
  /**
   * Haven V2: bonded critters. Optional + shape-guarded (defaults []) so a
   * pure-v1 save (no Haven keys) migrates losslessly.
   */
  roster?: RosterEntry[];
  /**
   * Haven V7: the bonded-nickname cursor — the next index into the shuffled
   * name pool. Optional + shape-guarded (absent → 0 on load) so a pre-V7 save
   * migrates losslessly; persisting it stops a fresh boot from re-minting a
   * nickname already in use.
   */
  nameCursor?: number;
  /**
   * Haven V4 (barter). All optional + shape-guarded (default []) so older saves
   * migrate losslessly. `barter` is the per-NPC request rotation state; each
   * entry ALSO persists the CONCRETE live `request` (Haven V7) so a reload never
   * swaps an outstanding request — regeneration from seq + linkedSpecies stays
   * the fallback for old saves that lack it. `pens` are the traded-away critters
   * living at each NPC's pen; `rewards` is the ordered granted-reward id list
   * ('plotDeed' may appear twice).
   */
  barter?: BarterPersistEntry[];
  pens?: PenPersistEntry[];
  rewards?: string[];
  /**
   * Haven V5: farm plots (unlock flags / assignments / hoppers / progress).
   * Optional + shape-guarded (a malformed or absent farm is simply dropped, so
   * pre-Haven-V5 saves migrate losslessly).
   */
  farm?: FarmState;
  /**
   * Haven V6: the active mount's roster-entry id and its idle actor's last
   * world position. Optional + shape-guarded so pre-V6 saves load losslessly;
   * on load the actor respawns there (or near the player if the field is
   * absent but a roster entry still carries the 'mount' status).
   */
  mount?: MountPersist;
  /**
   * Cursed Castle: world-clock seconds into the day/night cycle (Task 5 owns
   * writing/reading it in `buildSaveState()`/the load path — this task only
   * adds the decode/encode support). Optional + shape-guarded (absent → 0 at
   * the call site) so pre-Castle saves migrate losslessly.
   */
  daylightT?: number;
  /**
   * Cursed Castle: purified-elf count (castle residents). Optional +
   * shape-guarded (absent → 0 at the call site) so pre-Castle saves migrate
   * losslessly.
   */
  elves?: number;
  /**
   * Cursed Castle: permanent castle-purified transformation flag. Optional +
   * shape-guarded (absent → false at the call site) so pre-Castle saves
   * migrate losslessly.
   */
  castlePurified?: boolean;
  /**
   * Inventory+Building Task 2: the 6-slot hotbar assignment + selection.
   * Optional + shape-guarded so pre-Task-2 saves round-trip to exactly their
   * old shape (no phantom key) — the CALLER (Task 3) distinguishes "absent"
   * (a legacy save predating the hotbar → `migrateLegacy()`) from a decoded
   * `null` (there is no such state) and from a fresh boot (no save at all →
   * `createHotbar()`); this module only ever decodes what was actually
   * persisted. Slot strings are validated against the `ItemId` union
   * (unknown/tampered → `null`, not a whole-save rejection) and `selected` is
   * clamped 0..5; a structurally malformed block (missing `slots`, wrong
   * types) is dropped like the Cursed Castle v3 fields rather than rejecting
   * the whole save.
   */
  hotbar?: { slots: (string | null)[]; selected: number };
  /**
   * Inventory+Building Task 5: placed wall/ramp/cube pieces — compact `{k,
   * x, y, z, yaw}` entries (`k`: 'w' wall / 'r' ramp / 'c' cube, the last
   * added by the playtest Task 8). Optional + shape-guarded
   * (absent → BuildSystem starts empty) so pre-Task-5 saves migrate
   * losslessly; malformed entries are dropped like the structures/roster
   * element guards, and the whole array is truncated to `BUILD.maxPieces` on
   * load (BuildSystem.deserialize) in case a save was hand-edited past the cap.
   */
  builds?: BuildPersistEntry[];
}

/** A persisted placed piece (Inventory+Building Task 5; `k: 'c'` cube added
 *  by the playtest Task 8). */
export interface BuildPersistEntry {
  k: 'w' | 'r' | 'c';
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Persisted active-mount state (Haven V6). */
export interface MountPersist {
  entryId: number;
  x: number;
  z: number;
}

/** Persisted per-NPC barter rotation state (Haven V4; `request` added V7). */
export interface BarterPersistEntry {
  npcId: string;
  seq: number;
  fulfilled: number;
  /**
   * Haven V7: the CONCRETE outstanding request, persisted so a reload never
   * swaps it for a differently-regenerated one (which could happen when the
   * player Linked new species since the request was minted). Optional — old
   * saves lack it and fall back to deterministic regeneration from seq.
   */
  request?: Request;
}

/** A traded-away critter living at an NPC's pen (Haven V4). */
export interface PenPersistEntry {
  npcId: string;
  speciesId: string;
  nickname: string;
}

/**
 * The localStorage key. Deliberately KEPT as 'wildtag-save-v1' across the v1→v2
 * bump: the version lives INSIDE the payload (`v`), and `decodeSave` migrates v1
 * blobs in place. Renaming the key would orphan Spencer's real (v1) save under
 * the old key — a fresh boot would find nothing and silently wipe his progress.
 */
export const SAVE_KEY = 'wildtag-save-v1';

/** Serialize a save state to a JSON string. Pure. */
export function encodeSave(state: SaveV3): string {
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

/** Shape guard for a persisted concrete barter request (Haven V7). */
function isRequest(r: unknown): r is Request {
  if (!r || typeof r !== 'object') return false;
  const e = r as Record<string, unknown>;
  if (e.kind === 'critters') return typeof e.speciesId === 'string' && Number.isFinite(e.n);
  if (e.kind === 'resources') return typeof e.resource === 'string' && Number.isFinite(e.n);
  return false;
}

/**
 * Element guard/normalizer for a persisted barter rotation entry (Haven V4;
 * `request` added V7). Returns a clean entry, or null to drop a malformed one
 * (mirrors the structures element guards). A present-but-malformed `request` is
 * dropped (the entry survives; the live request regenerates from seq).
 */
function parseBarterEntry(b: unknown): BarterPersistEntry | null {
  if (!b || typeof b !== 'object') return null;
  const e = b as Record<string, unknown>;
  if (typeof e.npcId !== 'string' || !Number.isFinite(e.seq) || !Number.isFinite(e.fulfilled)) {
    return null;
  }
  const out: BarterPersistEntry = {
    npcId: e.npcId,
    seq: e.seq as number,
    fulfilled: e.fulfilled as number,
  };
  if (isRequest(e.request)) out.request = e.request;
  return out;
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
    // 'wood'/'stone' (Task 1): the timberchomp/pebbleshrew produce roles bank
    // straight into a plot hopper like any other producer, so they need the
    // same shape guard as fiber/resin/shard/spark. 'mushroom' stays absent —
    // it's forage-only and never a farm-role resource.
    for (const k of ['fiber', 'resin', 'shard', 'spark', 'wood', 'stone'] as const) {
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
 * Element guard/normalizer for a persisted placed piece (Inventory+Building
 * Task 5) — mirrors `parseBarterEntry`: returns a clean entry, or null to
 * drop a malformed one while valid siblings survive.
 */
function parseBuildEntry(b: unknown): BuildPersistEntry | null {
  if (!b || typeof b !== 'object') return null;
  const e = b as Record<string, unknown>;
  if (e.k !== 'w' && e.k !== 'r' && e.k !== 'c') return null;
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z) || !Number.isFinite(e.yaw)) {
    return null;
  }
  return { k: e.k, x: e.x as number, y: e.y as number, z: e.z as number, yaw: e.yaw as number };
}

const HOTBAR_SLOT_COUNT = 6;

/**
 * Shape guard/normalizer for the optional hotbar block (Inventory+Building
 * Task 2). Lenient at the slot level — matching how the hotbar model itself
 * treats bad input as recoverable, not fatal: an unrecognized/tampered item
 * string in a slot becomes `null` rather than rejecting the save, and an
 * out-of-range `selected` is clamped 0..5 rather than rejected. Only a
 * structurally unsound block (not an object, `slots` not an array, `selected`
 * not finite) returns `undefined`, which drops the whole field (the save
 * itself still decodes — mirrors the daylightT/elves/castlePurified
 * treatment) rather than rejecting the save outright.
 */
function parseHotbar(v: unknown): { slots: (string | null)[]; selected: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const h = v as Record<string, unknown>;
  if (!Array.isArray(h.slots) || !Number.isFinite(h.selected)) return undefined;
  const slots: (string | null)[] = [];
  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    const s = h.slots[i];
    slots.push(isItemId(s) ? s : null);
  }
  const selected = Math.min(Math.max(Math.trunc(h.selected as number), 0), HOTBAR_SLOT_COUNT - 1);
  return { slots, selected };
}

/**
 * Parse + validate a save JSON string. Returns `null` (never throws) for
 * garbage input, a missing/wrong `v` (version guard), or any structurally
 * unsound shape — the caller always falls back to a fresh start.
 */
export function decodeSave(json: string): SaveV3 | null {
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    // Version guard + migration: accept v1 (pre-Haven / incremental Haven), v2
    // (Haven-complete), and v3 (Cursed Castle); anything else is a fresh start.
    // The output is always normalized to v3 (see the `v: 3` in `sanitized`
    // below).
    if (o.v !== 1 && o.v !== 2 && o.v !== 3) return null;
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
    // `mushroom` mirrors `charms`: forward-compat for pre-Cursed-Castle saves
    // (missing → defaults to 0), but a present tampered/negative value rejects.
    if (inv.mushroom !== undefined && !isCount(inv.mushroom)) return null;
    const mushroom = isCount(inv.mushroom) ? (inv.mushroom as number) : 0;
    // `purifiers` mirrors `mushroom`: forward-compat for pre-Cursed-Castle
    // saves (missing → defaults to 0), but a present tampered/negative value
    // rejects.
    if (inv.purifiers !== undefined && !isCount(inv.purifiers)) return null;
    const purifiers = isCount(inv.purifiers) ? (inv.purifiers as number) : 0;
    // `wood`/`stone` mirror `mushroom` (Inventory+Building Task 1): forward-
    // compat for pre-Task-1 saves (missing → defaults to 0), but a present
    // tampered/negative value rejects.
    if (inv.wood !== undefined && !isCount(inv.wood)) return null;
    const wood = isCount(inv.wood) ? (inv.wood as number) : 0;
    if (inv.stone !== undefined && !isCount(inv.stone)) return null;
    const stone = isCount(inv.stone) ? (inv.stone as number) : 0;
    // `walls`/`ramps` mirror `purifiers` (Inventory+Building Task 5): forward-
    // compat for pre-Task-5 saves (missing → defaults to 0), but a present
    // tampered/negative value rejects.
    if (inv.walls !== undefined && !isCount(inv.walls)) return null;
    const walls = isCount(inv.walls) ? (inv.walls as number) : 0;
    if (inv.ramps !== undefined && !isCount(inv.ramps)) return null;
    const ramps = isCount(inv.ramps) ? (inv.ramps as number) : 0;
    // `cubes` mirrors `walls`/`ramps` (playtest Task 8): forward-compat for
    // pre-Task-8 saves (missing → defaults to 0), but a present tampered/
    // negative value rejects.
    if (inv.cubes !== undefined && !isCount(inv.cubes)) return null;
    const cubes = isCount(inv.cubes) ? (inv.cubes as number) : 0;
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
      mushroom,
      wood,
      stone,
      charms,
      purifiers,
      walls,
      ramps,
      cubes,
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
      barter = o.barter.map(parseBarterEntry).filter((e): e is BarterPersistEntry => e !== null);
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
    // Builds (Inventory+Building Task 5): optional, default []. A present
    // non-array rejects; malformed elements are dropped, valid siblings survive.
    let builds: BuildPersistEntry[] = [];
    if (o.builds !== undefined && o.builds !== null) {
      if (!Array.isArray(o.builds)) return null;
      builds = o.builds.map(parseBuildEntry).filter((e): e is BuildPersistEntry => e !== null);
    }
    // Farm (Haven V5): optional, shape-guarded, dropped if malformed.
    const farm = parseFarm(o.farm);
    // Nickname cursor (Haven V7): optional. A present-but-non-finite value
    // rejects the whole save (consistent with the other field-level guards);
    // absent → left off entirely so pre-V7 saves round-trip to their old shape.
    let nameCursor: number | undefined;
    if (o.nameCursor !== undefined && o.nameCursor !== null) {
      if (!Number.isFinite(o.nameCursor)) return null;
      nameCursor = o.nameCursor as number;
    }
    // Mount (Haven V6): optional. A present-but-malformed value rejects the
    // whole save (fresh start) — consistent with the other field-level guards.
    let mount: MountPersist | undefined;
    if (o.mount !== undefined && o.mount !== null) {
      const m = o.mount as Record<string, unknown>;
      if (!Number.isFinite(m.entryId) || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return null;
      mount = { entryId: m.entryId as number, x: m.x as number, z: m.z as number };
    }
    // Castle fields (Cursed Castle, v3): all optional. Unlike nameCursor/mount,
    // a present-but-malformed value is simply DROPPED (field left absent, so
    // the call site's `?? 0`/`?? false` default kicks in) rather than
    // rejecting the whole save — these are minor cosmetic/world-state fields,
    // not worth losing an entire save over a tampered/garbage value.
    let daylightT: number | undefined;
    if (o.daylightT !== undefined && o.daylightT !== null && Number.isFinite(o.daylightT)) {
      daylightT = o.daylightT as number;
    }
    let elves: number | undefined;
    if (o.elves !== undefined && o.elves !== null && Number.isFinite(o.elves)) {
      elves = o.elves as number;
    }
    let castlePurified: boolean | undefined;
    if (typeof o.castlePurified === 'boolean') {
      castlePurified = o.castlePurified;
    }
    // Hotbar (Inventory+Building Task 2): optional, shape-guarded. `null`
    // means "no hotbar" and is treated the same as absent (mirrors `mount`).
    let hotbar: { slots: (string | null)[]; selected: number } | undefined;
    if (o.hotbar !== undefined && o.hotbar !== null) {
      hotbar = parseHotbar(o.hotbar);
    }
    // Sanitize structure elements: drop malformed entries, keep valid siblings
    // (and the rest of the save) so a partly-corrupt save never crashes boot.
    const sanitized: Record<string, unknown> = {
      ...o,
      v: 3, // migrate/normalize: a decoded save is always the current v3 shape
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
    if (o.builds !== undefined && o.builds !== null) sanitized.builds = builds;
    // A `mount: null` was written as "no active mount" — strip it (absent),
    // never surface a null (the spread above would otherwise carry it through).
    delete sanitized.mount;
    if (mount !== undefined) sanitized.mount = mount;
    // Same "only surface when present" treatment for the nickname cursor, so a
    // pre-V7 save decodes to exactly its old shape (no phantom key).
    delete sanitized.nameCursor;
    if (nameCursor !== undefined) sanitized.nameCursor = nameCursor;
    // Same "only surface when present" treatment for the Cursed Castle fields,
    // so a pre-Castle save decodes to exactly its old shape (no phantom keys).
    delete sanitized.daylightT;
    if (daylightT !== undefined) sanitized.daylightT = daylightT;
    delete sanitized.elves;
    if (elves !== undefined) sanitized.elves = elves;
    delete sanitized.castlePurified;
    if (castlePurified !== undefined) sanitized.castlePurified = castlePurified;
    delete sanitized.hotbar;
    if (hotbar !== undefined) sanitized.hotbar = hotbar;
    return sanitized as unknown as SaveV3;
  } catch {
    return null;
  }
}

/** Read + decode the save from `storage` (defaults to `window.localStorage`). */
export function loadSave(storage: Storage = window.localStorage): SaveV3 | null {
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
export function writeSave(state: SaveV3, storage: Storage = window.localStorage): void {
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
export function applyStartingLoadout(base: Inventory, loaded: SaveV3 | null): Inventory {
  if (loaded) return { ...loaded.inventory, kits: { ...loaded.inventory.kits } };
  return { ...base, kits: { ...base.kits }, darts: base.darts + PLAYER_START.startingDarts };
}

/**
 * Snap a restored player position to the (possibly-reshaped) terrain: if the
 * saved `y` is more than `tolerance` units off the live ground height at that
 * `(x, z)`, replace it with `groundY + 0.5` (a small hover clearance); otherwise
 * the position is returned unchanged. Pure — `groundY` is passed in as a
 * number (the caller looks it up via `heightAt`, not imported here) so this
 * stays testable without three/terrain. Always returns a NEW object; never
 * mutates `pos`.
 *
 * Guards against loading an old save whose player position was valid against
 * a terrain shape that has since changed (e.g. Cursed Castle's world
 * grandeur rescale) — without this, an old save could resurrect the player
 * buried in or floating far above the new terrain.
 */
export function snapToGround(pos: Vec3, groundY: number, tolerance = 3): Vec3 {
  if (Math.abs(pos.y - groundY) > tolerance) {
    return { ...pos, y: groundY + 0.5 };
  }
  return { ...pos };
}
