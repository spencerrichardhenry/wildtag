import type { Vec3 } from './types.ts';
import { PLAYER_START } from './constants.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { StructuresSave } from '../structures/placement.ts';

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
    if (!Array.isArray(o.unlocks) || !o.unlocks.every((u) => typeof u === 'string')) return null;
    if (!o.critterPersist || typeof o.critterPersist !== 'object') return null;
    if (!o.structures || typeof o.structures !== 'object') return null;
    const structures = o.structures as Record<string, unknown>;
    if (!Array.isArray(structures.ziplines) || !Array.isArray(structures.drones)) return null;
    if (!o.player || typeof o.player !== 'object') return null;
    const player = o.player as Record<string, unknown>;
    if (!isVec3(player.pos) || typeof player.yaw !== 'number') return null;
    if (!Array.isArray(o.hints) || !o.hints.every((h) => typeof h === 'string')) return null;
    // Sanitize structure elements: drop malformed entries, keep valid siblings
    // (and the rest of the save) so a partly-corrupt save never crashes boot.
    const sanitized = {
      ...o,
      structures: {
        ziplines: structures.ziplines.filter(isZiplineEntry),
        drones: structures.drones.filter(isDroneEntry),
      },
    };
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
