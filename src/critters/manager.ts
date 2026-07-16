import * as THREE from 'three';
import { AI, WORLD_SEED } from '../core/constants.ts';
import type { Biome, CritterState, GroundQuery, Vec3 } from '../core/types.ts';
import { hash2, mulberry32 } from '../core/rng.ts';
import { biomeAt, groundNormalAt, heightAt } from '../world/terrain.ts';
import { SPECIES, speciesById } from './species.ts';
import { buildCritterModel, type CritterParts } from './models.ts';
import { animateCritter } from './animation.ts';
import { stepAI, type AIContext } from './ai.ts';

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

    const y = heightAt(x, z);
    const flightHeight = AI.flyHeightMin + h(salt + 4, cx, cz) * (AI.flyHeightMax - AI.flyHeightMin);
    out.push({ id: slotId(cx, cz, i), species, home: { x, y, z }, flightHeight });
  }
  return out;
}

interface PersistState {
  tagged: boolean;
  linked: boolean;
  trackProgress: number;
}

interface ActiveCritter {
  state: CritterState;
  group: THREE.Group;
  parts: CritterParts;
  rng: () => number;
}

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Advance the population: stream slots, step AI, animate. */
  update(dt: number, playerPos: Vec3): void {
    this.worldTime += dt;
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
      animateCritter(entry.parts, Math.hypot(s.vel.x, s.vel.z), this.worldTime);
    }
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
    this.active.set(slot.id, { state, group, parts, rng });
  }

  private deactivate(id: number): void {
    const entry = this.active.get(id);
    if (!entry) return;
    // Persist the latest gameplay flags before the state is discarded — but
    // only allocate a registry entry when there is something non-default to
    // remember (keeps the registry from growing unboundedly on long roams).
    const s = entry.state;
    if (s.tagged || s.linked || s.trackProgress > 0 || this.registry.has(id)) {
      const p = this.persistFor(id);
      p.tagged = s.tagged;
      p.linked = s.linked;
      p.trackProgress = s.trackProgress;
    }
    this.scene.remove(entry.group);
    disposeGroup(entry.group);
    this.active.delete(id);
  }

  /** Screenless data snapshot of every live critter. */
  list(): CritterView[] {
    const out: CritterView[] = [];
    for (const entry of this.active.values()) out.push(view(entry.state));
    return out;
  }

  /** Data view of a live critter by id, or undefined if not currently active. */
  byId(id: number): CritterView | undefined {
    const entry = this.active.get(id);
    return entry ? view(entry.state) : undefined;
  }

  setTagged(id: number, value = true): void {
    this.persistFor(id).tagged = value;
    const entry = this.active.get(id);
    if (entry) entry.state.tagged = value;
  }

  setLinked(id: number, value = true): void {
    this.persistFor(id).linked = value;
    const entry = this.active.get(id);
    if (entry) {
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

  /** Dispose every active model (registry state is retained). */
  dispose(): void {
    for (const id of [...this.active.keys()]) this.deactivate(id);
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
