import * as THREE from 'three';
import { AI, WORLD_SEED } from '../core/constants.ts';
import type { Biome, CritterState, GroundQuery, Vec3 } from '../core/types.ts';
import { hash2, mulberry32 } from '../core/rng.ts';
import { biomeAt, groundNormalAt, heightAt } from '../world/terrain.ts';
import { SPECIES, speciesById } from './species.ts';
import { buildCritterModel, type CritterParts } from './models.ts';
import { animateCritter } from './animation.ts';
import { stepAI, type AIContext } from './ai.ts';
import { inVillage } from '../village/layout.ts';

// ---------------------------------------------------------------------------
// CritterManager — the world's living population.
//
// Spawn placement is a deterministic per-128 m-cell table (`spawnSlotsForCell`,
// pure, in the scatter.ts spirit): each cell rolls 0–3 slots, each slot picks a
// species by biome-filtered rarity weight at the cell centre and a jittered home
// position (land species skip water tiles; the lumen stag only spawns in far
// cells). The manager streams slots in within AI.activeRadius (nearest
// AI.maxActive kept) and out past AI.deactivateRadius (hysteresis), owns the
// three.js models, and drives `stepAI` + `animateCritter` each update.
//
// Gameplay flags (tagged/linked/trackProgress) live in a persistent registry
// keyed by the stable slot id, so they survive a critter streaming out and back
// in — mirroring the resource-node registry in props.ts.
// ---------------------------------------------------------------------------

/** A deterministic spawn slot: stable id + species + home position. */
export interface SpawnSlot {
  id: number;
  species: string;
  home: Vec3;
  /** Cruise altitude above terrain for flyers (m); ignored by others. */
  flightHeight: number;
}

/** Pure, screenless data view of a live critter (for HUD / darts / tracking). */
export interface CritterView {
  id: number;
  species: string;
  pos: Vec3;
  state: CritterState['state'];
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
}

const CELL = AI.cellSize;
const ID_BASE = 65536; // packs a cell coord axis (island is well within ±32768 cells)
const ID_OFFSET = 32768;
const ID_STRIDE = 8; // > maxSlotsPerCell, room for the slot index

/** Distinct, deterministic hash channel from WORLD_SEED. */
function h(salt: number, a: number, b: number): number {
  return hash2((WORLD_SEED ^ 0xc717 ^ salt) >>> 0, a, b);
}

/** Stable unique numeric id for slot `i` of cell (cx, cz). */
function slotId(cx: number, cz: number, i: number): number {
  return ((cx + ID_OFFSET) * ID_BASE + (cz + ID_OFFSET)) * ID_STRIDE + i;
}

/** Weighted-by-rarity species pick from `candidates`, or null if empty. */
function pickSpecies(candidates: typeof SPECIES, roll: number): string | null {
  if (candidates.length === 0) return null;
  let total = 0;
  for (const s of candidates) total += s.rarity;
  let r = roll * total;
  for (const s of candidates) {
    r -= s.rarity;
    if (r <= 0) return s.id;
  }
  return candidates[candidates.length - 1]!.id;
}

/**
 * Deterministic spawn slots for cell (cx, cz). Pure: identical output for
 * identical arguments, no PRNG state. Land species that land on a water tile
 * (or a species with no biome match) yield no slot; the lumen stag is excluded
 * from cells whose centre is within AI.lumenMinDist of the origin.
 */
export function spawnSlotsForCell(cx: number, cz: number): SpawnSlot[] {
  const out: SpawnSlot[] = [];
  const ccx = (cx + 0.5) * CELL;
  const ccz = (cz + 0.5) * CELL;
  const centerBiome = biomeAt(ccx, ccz);
  const centerDist = Math.hypot(ccx, ccz);

  const count = Math.floor(h(0x01, cx, cz) * (AI.maxSlotsPerCell + 1)); // 0..maxSlots

  const candidates = SPECIES.filter((s) => {
    if (!s.biomes.includes(centerBiome)) return false;
    if (s.id === 'lumenstag' && centerDist <= AI.lumenMinDist) return false;
    return true;
  });
  if (candidates.length === 0) return out;

  for (let i = 0; i < count; i++) {
    const salt = 0x100 + i * 0x10;
    const species = pickSpecies(candidates, h(salt + 1, cx, cz));
    if (!species) continue;
    const def = speciesById(species)!;

    const jx = (h(salt + 2, cx, cz) - 0.5) * 2 * AI.slotJitter;
    const jz = (h(salt + 3, cx, cz) - 0.5) * 2 * AI.slotJitter;
    const x = (cx + 0.5 + jx) * CELL;
    const z = (cz + 0.5 + jz) * CELL;

    // Land species may not home on a water tile; fliers/swimmers are exempt.
    const overWater = biomeAt(x, z) === 'water';
    if (overWater && def.fleeStyle !== 'swim' && def.fleeStyle !== 'fly') continue;

    // Nothing spawns inside Haven Village — the plaza is for villagers.
    if (inVillage(x, z)) continue;

    const y = heightAt(x, z);
    // The bumblewhale is a flyer but a low, placid one: it drifts just above
    // the terrain (spec §5) rather than cruising the high band like the finch.
    const flightHeight =
      species === 'bumblewhale'
        ? AI.hoverHeightLow
        : AI.flyHeightMin + h(salt + 4, cx, cz) * (AI.flyHeightMax - AI.flyHeightMin);
    out.push({ id: slotId(cx, cz, i), species, home: { x, y, z }, flightHeight });
  }
  return out;
}

interface PersistState {
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
  /** Species id, remembered so `linkedSpecies()` can resolve linked slots. */
  species?: string;
  /**
   * Haven V2: this slot was bonded into the roster and has permanently left
   * the wild — the streaming loop never re-activates a consumed slot. Persists
   * via the registry export so the slot stays empty across save/load.
   */
  consumed?: boolean;
}

interface ActiveCritter {
  state: CritterState;
  group: THREE.Group;
  parts: CritterParts;
  rng: () => number;
  /** Blinking tracking beacon (child of `group`) while tagged-not-linked. */
  beacon: THREE.Mesh | null;
}

/** Beacon: a small bright octahedron that hovers above a tagged critter. */
const BEACON_COLOR = 0x66e0ff;

const ground: GroundQuery = { heightAt, normalAt: groundNormalAt };
const _biomeAt = (x: number, z: number): Biome => biomeAt(x, z);

/** Streams, simulates and renders the critter population around the player. */
export class CritterManager {
  private readonly scene: THREE.Scene;
  private readonly active = new Map<number, ActiveCritter>();
  /** Gameplay flags persisted per slot id across deactivate/reactivate. */
  private readonly registry = new Map<number, PersistState>();
  private worldTime = 0;
  /** Cached in-range slot list, rebuilt when the player crosses a cell boundary. */
  private slotCache: SpawnSlot[] = [];
  private cacheCellX = NaN;
  private cacheCellZ = NaN;
  /** Counts down from -1 so debug-spawned ids never collide with a real slot id. */
  private debugIdCounter = -1;
  /**
   * Per-step snapshot of `list()`. Built lazily on the first `list()` call after
   * any change and reused by every subsequent caller in the same sim step
   * (tracker + HUD + darts all read it), cutting the per-frame view allocation.
   * Invalidated by `update()` and by every mutation of the active population or
   * gameplay flags below.
   */
  private listCache: CritterView[] | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Drop the cached `list()` snapshot (population or a flag changed). */
  private invalidateList(): void {
    this.listCache = null;
  }

  /** Advance the population: stream slots, step AI, animate. */
  update(dt: number, playerPos: Vec3): void {
    this.worldTime += dt;
    // A fresh step: the AI advance below mutates every critter, so the previous
    // step's snapshot is stale.
    this.invalidateList();
    this.refreshSlots(playerPos);

    // Distances (recomputed every frame; slot table only on cell change).
    const withDist = this.slotCache.map((slot) => ({
      slot,
      dist: Math.hypot(slot.home.x - playerPos.x, slot.home.z - playerPos.z),
    }));

    // Deactivate anything now beyond the outer radius.
    for (const [id, entry] of this.active) {
      const d = Math.hypot(
        entry.state.pos.x - playerPos.x,
        entry.state.pos.z - playerPos.z,
      );
      if (d > AI.deactivateRadius) this.deactivate(id);
    }

    // Activate nearest in-range slots up to the cap.
    withDist.sort((a, b) => a.dist - b.dist);
    for (const { slot, dist } of withDist) {
      if (this.active.size >= AI.maxActive) break;
      if (dist > AI.activeRadius) break; // sorted — the rest are farther
      // A bonded (consumed) slot has permanently left the wild — never respawn it.
      if (this.registry.get(slot.id)?.consumed) continue;
      if (!this.active.has(slot.id)) this.activate(slot);
    }

    // Simulate + render every active critter.
    for (const entry of this.active.values()) {
      const def = speciesById(entry.state.species)!;
      const aiCtx: AIContext = {
        playerPos,
        species: def,
        ground,
        biomeAt: _biomeAt,
        rand: entry.rng,
      };
      entry.state = stepAI(entry.state, aiCtx, dt);
      const s = entry.state;
      entry.group.position.set(s.pos.x, s.pos.y, s.pos.z);
      entry.group.rotation.y = s.yaw;
      animateCritter(entry.parts, Math.hypot(s.vel.x, s.vel.z), this.worldTime, dt, s.species);

      // Tracking beacon: shown while tagged-not-linked, blinking; removed once
      // the critter Links (or is somehow untagged).
      if (s.tagged && !s.linked) {
        this.ensureBeacon(entry, def);
        if (entry.beacon) {
          const mat = entry.beacon.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.worldTime * 8));
        }
      } else {
        this.removeBeacon(entry);
      }
    }
  }

  private ensureBeacon(entry: ActiveCritter, def: { size: number }): void {
    if (entry.beacon) return;
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18),
      new THREE.MeshBasicMaterial({ color: BEACON_COLOR, transparent: true, opacity: 1 }),
    );
    // Local coords: hover above the critter's head (group is scaled per model).
    beacon.position.set(0, def.size * 2 + 0.6, 0);
    entry.group.add(beacon);
    entry.beacon = beacon;
  }

  private removeBeacon(entry: ActiveCritter): void {
    if (!entry.beacon) return;
    entry.group.remove(entry.beacon);
    entry.beacon.geometry.dispose();
    (entry.beacon.material as THREE.Material).dispose();
    entry.beacon = null;
  }

  /** Rebuild the candidate slot list when the player enters a new cell. */
  private refreshSlots(playerPos: Vec3): void {
    const pcx = Math.floor(playerPos.x / CELL);
    const pcz = Math.floor(playerPos.z / CELL);
    if (pcx === this.cacheCellX && pcz === this.cacheCellZ) return;
    this.cacheCellX = pcx;
    this.cacheCellZ = pcz;
    const r = Math.ceil(AI.deactivateRadius / CELL) + 1;
    const slots: SpawnSlot[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const slot of spawnSlotsForCell(pcx + dx, pcz + dz)) slots.push(slot);
      }
    }
    this.slotCache = slots;
  }

  private persistFor(id: number): PersistState {
    let p = this.registry.get(id);
    if (!p) {
      p = { tagged: false, linked: false, trackProgress: 0 };
      this.registry.set(id, p);
    }
    return p;
  }

  private activate(slot: SpawnSlot): void {
    const modelRng = mulberry32(slot.id >>> 0);
    const { group, parts } = buildCritterModel(slot.species, modelRng);
    group.position.set(slot.home.x, slot.home.y, slot.home.z);
    this.scene.add(group);

    const rng = mulberry32((slot.id ^ 0x5eed5eed) >>> 0);
    // Read-only registry lookup — entries are created lazily (setTagged /
    // setLinked / deactivate-with-progress) so long roams don't accumulate
    // registry entries for critters the player never touched.
    const persist = this.registry.get(slot.id);
    const state: CritterState = {
      id: slot.id,
      species: slot.species,
      pos: { ...slot.home },
      vel: { x: 0, y: 0, z: 0 },
      yaw: rng() * Math.PI * 2,
      state: 'idle',
      stateTime: 0,
      targetYaw: rng() * Math.PI * 2,
      tagged: persist?.tagged ?? false,
      linked: persist?.linked ?? false,
      trackProgress: persist?.trackProgress ?? 0,
      home: { ...slot.home },
      flightHeight: slot.flightHeight,
      stateDur: AI.idleMin + rng() * (AI.idleMax - AI.idleMin),
      farTime: 0,
    };
    this.active.set(slot.id, { state, group, parts, rng, beacon: null });
    this.invalidateList();
  }

  private deactivate(id: number): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.invalidateList();
    // Persist the latest gameplay flags before the state is discarded — but
    // only allocate a registry entry when there is something non-default to
    // remember (keeps the registry from growing unboundedly on long roams).
    const s = entry.state;
    if (s.tagged || s.linked || s.trackProgress > 0 || this.registry.has(id)) {
      const p = this.persistFor(id);
      p.tagged = s.tagged;
      p.linked = s.linked;
      p.trackProgress = s.trackProgress;
      p.species = s.species;
    }
    this.removeBeacon(entry);
    this.scene.remove(entry.group);
    disposeGroup(entry.group);
    this.active.delete(id);
  }

  /**
   * Screenless data snapshot of every live critter. Cached per sim step: within
   * one step every caller gets the SAME array reference (see `listCache`); the
   * cache is rebuilt after `update()` or any population/flag change. Callers
   * must treat the result as read-only (the shared snapshot is not defensively
   * frozen for perf, but no caller mutates it).
   */
  list(): CritterView[] {
    if (this.listCache) return this.listCache;
    const out: CritterView[] = [];
    for (const entry of this.active.values()) out.push(view(entry.state));
    this.listCache = out;
    return out;
  }

  /** Data view of a live critter by id, or undefined if not currently active. */
  byId(id: number): CritterView | undefined {
    const entry = this.active.get(id);
    return entry ? view(entry.state) : undefined;
  }

  setTagged(id: number, value = true): void {
    const p = this.persistFor(id);
    p.tagged = value;
    const entry = this.active.get(id);
    if (entry) {
      entry.state.tagged = value;
      p.species = entry.state.species;
      this.invalidateList();
    }
  }

  /** Persist and (if active) apply the tracking progress for a critter. */
  setTrackProgress(id: number, value: number): void {
    this.persistFor(id).trackProgress = value;
    const entry = this.active.get(id);
    if (entry) {
      entry.state.trackProgress = value;
      this.invalidateList();
    }
  }

  setLinked(id: number, value = true): void {
    const p = this.persistFor(id);
    p.linked = value;
    const entry = this.active.get(id);
    if (entry) {
      this.invalidateList();
      p.species = entry.state.species;
      entry.state.linked = value;
      // Linking a mid-alert/mid-flee critter calms it on the spot (the payoff
      // moment) — stepAI's alert/flee cases also re-check linked, but forcing
      // the state here means even the same-frame view reads 'calm' and any
      // sprint burst decelerates naturally from the next step.
      if (value && (entry.state.state === 'alert' || entry.state.state === 'flee')) {
        entry.state.state = 'calm';
        entry.state.stateTime = 0;
        entry.state.stateDur = AI.calmTime;
        entry.state.farTime = 0;
      }
    }
  }

  /**
   * Haven V2: mark slot `id` as bonded — it leaves the wild permanently. The
   * live model (if any) is deactivated now, and the persistent `consumed` flag
   * (surviving save/load via the registry export) keeps the streaming loop from
   * ever re-activating it.
   */
  consumeSlot(id: number): void {
    const p = this.persistFor(id);
    const entry = this.active.get(id);
    if (entry) p.species = entry.state.species;
    p.consumed = true;
    if (entry) this.deactivate(id); // deactivate reuses the same registry object
  }

  /**
   * Haven V2 (release): re-open a previously-consumed wild slot so a released
   * roster critter returns to the world at its ORIGINAL home instead of an
   * ephemeral debug slot. The registry entry is un-consumed (kept linked, so it
   * streams back as an already-Linked critter) and persists via the registry
   * export — surviving save/reload. The normal streaming loop reactivates it
   * the next time the player is within range of its home (it then walks off).
   * No-op for an id with no registry entry (never bonded) or a negative ad-hoc
   * debug slot, whose home isn't a real spawn slot (caller keeps the old path).
   */
  releaseSlot(id: number): boolean {
    const p = this.registry.get(id);
    if (!p || !p.consumed) return false;
    p.consumed = false;
    this.invalidateList();
    return true;
  }

  /**
   * Debug convenience (Haven V2): force a critter Linked, then return its view.
   * Lets a verification script bond a spawned critter without the tracking loop.
   * Returns undefined if the critter is not currently active.
   */
  debugBond(id: number): CritterView | undefined {
    this.setLinked(id, true);
    return this.byId(id);
  }

  /**
   * Nearest live critter within `maxDist` whose bearing from `origin` lies
   * inside the cone around unit `dir` (half-angle via `cosHalfAngle`), or null.
   * For dart aiming / lock-on.
   */
  nearestInCone(
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    cosHalfAngle: number,
  ): CritterView | null {
    let best: CritterView | null = null;
    let bestD = Infinity;
    for (const entry of this.active.values()) {
      const s = entry.state;
      const vx = s.pos.x - origin.x;
      const vy = s.pos.y - origin.y;
      const vz = s.pos.z - origin.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > maxDist || d < 1e-4) continue;
      const dot = (vx * dir.x + vy * dir.y + vz * dir.z) / d;
      if (dot < cosHalfAngle) continue;
      if (d < bestD) {
        bestD = d;
        best = view(s);
      }
    }
    return best;
  }

  /** Active critter count (for the debug HUD). */
  count(): number {
    return this.active.size;
  }

  /**
   * Species ids the player has Linked at least once (any linked slot),
   * derived from the persistence registry so it survives streaming. Feeds the
   * Field Guide's linked/unknown card split.
   */
  linkedSpecies(): Set<string> {
    const out = new Set<string>();
    for (const p of this.registry.values()) {
      if (p.linked && p.species) out.add(p.species);
    }
    return out;
  }

  /** Dispose every active model (registry state is retained). */
  dispose(): void {
    for (const id of [...this.active.keys()]) this.deactivate(id);
  }

  // ---------------------------------------------------------------------
  // Persistence registry export/import (Task 14 save/load). Plain JSON,
  // keyed by slot id — round-trips tagged/linked/trackProgress/species for
  // every critter the player has ever touched, active or not.
  // ---------------------------------------------------------------------

  /** Plain-data snapshot of the persistence registry. */
  exportRegistry(): Record<number, PersistState> {
    const out: Record<number, PersistState> = {};
    for (const [id, p] of this.registry) out[id] = { ...p };
    return out;
  }

  /**
   * Rebuild the persistence registry from plain data (replaces any current
   * entries). Any critters already active (there normally are none this
   * early in boot) have their live flags refreshed to match.
   */
  importRegistry(data: Record<number, PersistState>): void {
    this.registry.clear();
    for (const key of Object.keys(data)) {
      const id = Number(key);
      const p = data[key as unknown as number];
      if (!Number.isFinite(id) || !p) continue;
      this.registry.set(id, { ...p });
    }
    for (const [id, entry] of this.active) {
      const p = this.registry.get(id);
      if (!p) continue;
      entry.state.tagged = p.tagged;
      entry.state.linked = p.linked;
      entry.state.trackProgress = p.trackProgress;
    }
    this.invalidateList();
  }

  /**
   * Debug-only (Task 14): force-activate a critter of `speciesId` at `pos`,
   * bypassing the normal cell-based spawn table entirely — works for any
   * species anywhere. Returns the new (negative, so it never collides with a
   * real slot id) critter id, or null if `speciesId` is unknown. The critter
   * behaves exactly like a streamed one from then on (including normal
   * deactivate-by-distance and persistence).
   */
  debugSpawn(speciesId: string, pos: Vec3): number | null {
    if (!speciesById(speciesId)) return null;
    const id = this.debugIdCounter--;
    const slot: SpawnSlot = { id, species: speciesId, home: { ...pos }, flightHeight: AI.flyHeightMin };
    this.activate(slot);
    return id;
  }
}

function view(s: CritterState): CritterView {
  return {
    id: s.id,
    species: s.species,
    pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
    state: s.state,
    tagged: s.tagged,
    linked: s.linked,
    trackProgress: s.trackProgress,
  };
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
