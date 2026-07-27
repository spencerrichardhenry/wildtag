import { CASTLE, CHUNKS, ENV, SCATTER, TERRAIN, WORLD_SEED } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import { hash2 } from '../core/rng.ts';
import { groundNormalAt, heightAt, biomeAt } from './terrain.ts';

// ---------------------------------------------------------------------------
// Deterministic prop / resource scatter. `scatterForChunk(cx, cz)` is pure and
// stable from WORLD_SEED: it dices a chunk into a SCATTER.grid² sub-cell
// lattice, jitters one sample point per cell, classifies it by biome, and rolls
// (via hash2) for a single prop whose kind follows the per-biome scatter table.
// Trees may sprout an attached resin node; a rare spark mote is rolled once per
// chunk. Nothing is placed on the `water` biome or below SCATTER.minPlacementY.
//
// No `three` import — placements are plain data consumed by the prop mesh layer
// (props.ts) and the resource-node registry.
// ---------------------------------------------------------------------------

export type PropKind =
  | 'tree'
  | 'rock'
  | 'crystal'
  | 'flower'
  | 'fiber'
  | 'resin'
  | 'shard'
  | 'spark'
  // --- F2 scenery variety ---
  | 'mesa' // stacked slab formation (grappleable + collidable)
  | 'boulder' // composite boulder stack (grappleable + collidable)
  | 'scree' // pebble patch (set dressing, no collision)
  | 'reed' // wetland reed cluster (no collision)
  | 'lilypad' // floating lake lily pad (no collision)
  | 'mushroom' // forest glow-mushroom cluster (no collision)
  | 'grasstuft'; // permanent meadow ground-cover tuft (no collision; static)

/**
 * A single scattered prop: gameplay `kind` + world transform (y already
 * snapped). `variant` is an optional geometry-bucket key (tree/crystal/mesa
 * flavours); the mesh layer groups InstancedMeshes by `variant ?? kind` while
 * obstacle/grapple/resource logic keys off `kind`.
 */
export interface PropPlacement {
  kind: PropKind;
  variant?: string;
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
}

const GRID = SCATTER.grid;
const CELL = CHUNKS.size / GRID; // sub-cell edge (m)

// Distinct hash channels so position, kind roll, transform and extras are
// statistically independent yet fully deterministic.
const S_JX = 0x1111;
const S_JZ = 0x2222;
const S_KIND = 0x3333;
const S_SCALE = 0x4444;
const S_ROT = 0x5555;
const S_RESIN = 0x6666;
const S_SPARK = 0x7777;
const S_VARIANT = 0x8888;
const S_LILY = 0x9999;
// Permanent meadow grass-tuft channels (independent per-sub-cell roll + jitter).
const S_GRASS = 0xaaaa;
const S_GRASS_JX = 0xbbbb;
const S_GRASS_JZ = 0xcccc;
const S_GRASS_ROT = 0xdddd;
// Tree tier roll (Task 7 grandeur rescale): a second, independent channel
// picks which tier's scale band a tree's S_SCALE roll lands in.
const S_TIER = 0xeeee;
// Cursed Castle approach mushrooms (Task 9): independent channels keyed by a
// fixed candidate index (not a chunk grid cell — see approachMushroomsFor).
const S_APPROACH_ANGLE = 0xf001;
const S_APPROACH_RADIUS = 0xf002;
const S_APPROACH_SCALE = 0xf003;
const S_APPROACH_ROT = 0xf004;

function h(salt: number, gx: number, gz: number): number {
  return hash2((WORLD_SEED ^ salt) >>> 0, gx, gz);
}

type VariantEntry = { readonly v: string; readonly p: number };

/** First variant whose cumulative threshold exceeds the roll (last as fallback). */
function pickVariant(table: readonly VariantEntry[], roll: number): string | undefined {
  for (const e of table) if (roll < e.p) return e.v;
  return table.length ? table[table.length - 1]!.v : undefined;
}

/** Geometry-bucket variant for a placement (trees/crystals/mesas), else undefined. */
function variantFor(kind: PropKind, biome: Biome, gx: number, gz: number): string | undefined {
  const roll = h(S_VARIANT, gx, gz);
  if (kind === 'tree') {
    const table = (SCATTER.treeVariants as Record<string, readonly VariantEntry[]>)[biome];
    return table ? pickVariant(table, roll) : undefined;
  }
  if (kind === 'crystal') return pickVariant(SCATTER.crystalVariants, roll);
  if (kind === 'mesa') return (SCATTER.mesaVariants as Record<string, string>)[biome];
  return undefined;
}

/**
 * True where a lily pad may float: shallow on-island water inside the wetland
 * angular sector (a lake, not the ocean). Sector math mirrors terrain's
 * `sectorBiome` (kept local so scatter stays terrain-write-free).
 */
function isWetlandLake(x: number, z: number, y: number): boolean {
  if (y >= 0 || y < -SCATTER.lilypadMaxDepth) return false;
  const r = Math.hypot(x, z);
  if (r < TERRAIN.meadowRadius || r > TERRAIN.falloffStart) return false;
  const ang = Math.atan2(z, x);
  const q = Math.PI / 8;
  return ang >= 3 * q && ang < 5 * q; // wetland sector (S)
}

/** Tiered scale roll for trees: first pick a tier by cumulative `p`, then roll
 *  uniform within that tier's [min, max] scale band. */
function treeScaleFor(gx: number, gz: number): number {
  const tierRoll = h(S_TIER, gx, gz);
  const tiers = SCATTER.treeTiers;
  let tier = tiers[tiers.length - 1]!;
  for (const t of tiers) {
    if (tierRoll < t.p) {
      tier = t;
      break;
    }
  }
  const t = h(S_SCALE, gx, gz);
  return tier.scale[0] + t * (tier.scale[1] - tier.scale[0]);
}

function scaleFor(kind: PropKind, gx: number, gz: number): number {
  if (kind === 'tree') return treeScaleFor(gx, gz);
  const range = SCATTER.scale[kind as keyof typeof SCATTER.scale] ?? [1, 1];
  const t = h(S_SCALE, gx, gz);
  return range[0] + t * (range[1] - range[0]);
}

/** Pick a prop kind for a sub-cell roll under `biome`, or null for empty. */
function kindFor(biome: Biome, roll: number): PropKind | null {
  const table = (SCATTER.biomeScatter as Record<string, readonly { kind: string; p: number }[]>)[
    biome
  ];
  if (!table) return null;
  for (const entry of table) {
    if (roll < entry.p) return entry.kind as PropKind;
  }
  return null;
}

/** True where a prop may stand: on land, above the shore band, not water. */
function placeable(x: number, z: number, y: number): boolean {
  if (y < SCATTER.minPlacementY) return false;
  return biomeAt(x, z) !== 'water';
}

/**
 * True inside the castle's walled footprint + clearance margin (Task 8
 * review fix): a Chebyshev square matching the square curtain wall — cheaper
 * and tighter than a circular "in castle region" check. Applied once, as a
 * post-filter in `scatterForChunk`, to every placement kind (rocks, mesas,
 * boulders, trees, grass tufts, harvest nodes, ...) so none spawn inside the
 * ward and choke its maze corridors. The castle-approach mushrooms are added
 * AFTER this filter runs and sit on ring r∈[140,230] — well outside
 * `half + castleClearMargin` (95) — so they are never affected.
 */
function inCastleFootprint(x: number, z: number): boolean {
  const dx = Math.abs(x - CASTLE.center.x);
  const dz = Math.abs(z - CASTLE.center.z);
  return Math.max(dx, dz) < CASTLE.half + CASTLE.castleClearMargin;
}

/** Ground-normal Y below which the approach terrain reads as too steep for a
 *  standing mushroom cluster (mirrors AI's climb-slope gate, a little more
 *  permissive since these are static set dressing, not a walked path). */
const APPROACH_STEEP_NORMAL_Y = 0.6;

/**
 * Deterministic mushroom clusters along the ring `CASTLE.approachR` around
 * `CASTLE.center` — the highlands/crags biome out there has no mushrooms in
 * `SCATTER.biomeScatter`, so these are seeded independently of the chunk sub-
 * cell lattice: a fixed pool of hash-seeded ring positions (3x the nominal
 * `CASTLE.approachMushrooms` count, since several will fall on water/steep
 * highlands terrain and get skipped). Each candidate belongs to exactly one
 * chunk — the one its computed world position actually falls in — so calling
 * this once per streamed chunk never double-counts a placement.
 */
function approachMushroomsForChunk(cx: number, cz: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const [rMin, rMax] = CASTLE.approachR;
  const poolSize = CASTLE.approachMushrooms * 3;
  for (let k = 0; k < poolSize; k++) {
    const angle = h(S_APPROACH_ANGLE, k, 0) * Math.PI * 2;
    const radius = rMin + h(S_APPROACH_RADIUS, k, 0) * (rMax - rMin);
    const x = CASTLE.center.x + Math.cos(angle) * radius;
    const z = CASTLE.center.z + Math.sin(angle) * radius;
    if (Math.floor(x / CHUNKS.size) !== cx || Math.floor(z / CHUNKS.size) !== cz) continue;
    const y = heightAt(x, z);
    if (!placeable(x, z, y)) continue;
    if (groundNormalAt(x, z).y < APPROACH_STEEP_NORMAL_Y) continue;
    out.push({
      kind: 'mushroom',
      x,
      z,
      y,
      scale: SCATTER.scale.mushroom[0] + h(S_APPROACH_SCALE, k, 0) * (SCATTER.scale.mushroom[1] - SCATTER.scale.mushroom[0]),
      rot: h(S_APPROACH_ROT, k, 0) * Math.PI * 2,
    });
  }
  return out;
}

/**
 * All props for chunk (cx, cz). Pure & deterministic; identical output for
 * identical arguments. Placement order is stable (row-major sub-cell scan, with
 * each tree immediately followed by its optional resin node, then the spark
 * roll) so a chunk's Nth placement keeps a stable identity for node state.
 */
export function scatterForChunk(cx: number, cz: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;
  const counts: Record<string, number> = {};
  const caps = SCATTER.caps as Record<string, number>;
  const capped = (k: PropKind): boolean => (counts[k] ?? 0) >= (caps[k] ?? Infinity);

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const gx = cx * GRID + i;
      const gz = cz * GRID + j;

      // Jittered sample point within the sub-cell (stays inside the cell).
      const jx = (h(S_JX, gx, gz) - 0.5) * 2 * SCATTER.jitter;
      const jz = (h(S_JZ, gx, gz) - 0.5) * 2 * SCATTER.jitter;
      const x = originX + (i + 0.5 + jx) * CELL;
      const z = originZ + (j + 0.5 + jz) * CELL;
      const y = heightAt(x, z);
      const biome = biomeAt(x, z);

      // Water sub-cells: only a wetland-lake lily pad may float here.
      if (biome === 'water') {
        if (
          isWetlandLake(x, z, y) &&
          !capped('lilypad') &&
          h(S_LILY, gx, gz) < SCATTER.lilypadChance
        ) {
          out.push({
            kind: 'lilypad',
            x,
            z,
            y: ENV.waterY,
            scale: scaleFor('lilypad', gx, gz),
            rot: h(S_ROT, gx, gz) * Math.PI * 2,
          });
          counts.lilypad = (counts.lilypad ?? 0) + 1;
        }
        continue;
      }
      if (y < SCATTER.minPlacementY) continue;

      const kind = kindFor(biome, h(S_KIND, gx, gz));
      if (!kind || capped(kind)) continue;

      out.push({
        kind,
        variant: variantFor(kind, biome, gx, gz),
        x,
        z,
        y,
        scale: scaleFor(kind, gx, gz),
        rot: h(S_ROT, gx, gz) * Math.PI * 2,
      });
      counts[kind] = (counts[kind] ?? 0) + 1;

      // A forest tree may carry a resin node at its base (separate harvestable).
      if (kind === 'tree' && biome === 'forest' && h(S_RESIN, gx, gz) < SCATTER.resinChancePerTree) {
        const ra = h(S_ROT, gz, gx) * Math.PI * 2;
        const rx = x + Math.cos(ra) * SCATTER.resinOffset;
        const rz = z + Math.sin(ra) * SCATTER.resinOffset;
        const ry = heightAt(rx, rz);
        if (placeable(rx, rz, ry)) {
          out.push({
            kind: 'resin',
            x: rx,
            z: rz,
            y: ry,
            scale: scaleFor('resin', gz, gx),
            rot: ra,
          });
        }
      }
    }
  }

  // Rare spark mote: one roll per chunk, placed at a hash-derived point.
  if (h(S_SPARK, cx, cz) < SCATTER.sparkChancePerChunk) {
    const sx = originX + h(S_JX, cx, cz) * CHUNKS.size;
    const sz = originZ + h(S_JZ, cx, cz) * CHUNKS.size;
    const sy = heightAt(sx, sz);
    if (placeable(sx, sz, sy)) {
      out.push({
        kind: 'spark',
        x: sx,
        z: sz,
        y: sy,
        scale: scaleFor('spark', cx, cz),
        rot: h(S_ROT, cx, cz) * Math.PI * 2,
      });
    }
  }

  // Permanent meadow ground-cover grass tufts: an INDEPENDENT per-sub-cell roll
  // (meadow biome only) appended AFTER the prop/spark rolls, so a tuft never
  // shifts a resource node's placement index (registry keys stay stable). Roughly
  // SCATTER.grasstuftChance of the grid² sub-cells sprout one static, non-
  // colliding tuft at its own jittered point — sparse ground cover across the
  // plains, deterministic from world position like every other placement.
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const gx = cx * GRID + i;
      const gz = cz * GRID + j;
      if (h(S_GRASS, gx, gz) >= SCATTER.grasstuftChance) continue;
      const jx = (h(S_GRASS_JX, gx, gz) - 0.5) * 2 * SCATTER.jitter;
      const jz = (h(S_GRASS_JZ, gx, gz) - 0.5) * 2 * SCATTER.jitter;
      const x = originX + (i + 0.5 + jx) * CELL;
      const z = originZ + (j + 0.5 + jz) * CELL;
      if (biomeAt(x, z) !== 'meadow') continue;
      const y = heightAt(x, z);
      if (y < SCATTER.minPlacementY) continue;
      out.push({
        kind: 'grasstuft',
        x,
        z,
        y,
        scale: scaleFor('grasstuft', gx, gz),
        rot: h(S_GRASS_ROT, gx, gz) * Math.PI * 2,
      });
    }
  }

  // Castle exclusion (Task 8 review fix): drop every placement above that
  // fell inside the walled footprint before adding the approach mushrooms
  // below, so this single filter is the choke point for ALL prop kinds
  // (including grass tufts) and can never touch the mushrooms themselves.
  const cleared = out.filter((p) => !inCastleFootprint(p.x, p.z));

  // Cursed Castle approach: mushroom clusters seeded along the ring around
  // CASTLE.center (independent of the sub-cell lattice — see the function doc).
  cleared.push(...approachMushroomsForChunk(cx, cz));

  return cleared;
}

/** Approx. mesh top (m above base) per grappleable/collidable kind, × instance
 *  scale. Shared by `placementObstacle` (the collision cylinder's finite top —
 *  a player above this height glides over the prop instead of being blocked)
 *  and `placementGrappleCollider` (the hook's reachable y-band top), since a
 *  prop's "top you can reach" and "top that blocks you" are the same surface. */
const PROP_TOP: Partial<Record<PropKind, number>> = {
  tree: 4.5,
  rock: 1.6,
  mesa: 5,
  boulder: 2,
};

/**
 * Collision cylinder for a blocking prop (trees, rocks, mesas, boulders)
 * scaled by its instance scale; null for props that don't block (flowers,
 * crystals, resource nodes). `yTop` (absolute world Y) is the prop's
 * approximate mesh top, so a player gliding above it passes over instead of
 * being shoved sideways by an infinite invisible column.
 */
export function placementObstacle(p: PropPlacement): Obstacle | null {
  const factor = (SCATTER.obstacleRadius as Record<string, number>)[p.kind];
  if (factor === undefined) return null;
  const top = PROP_TOP[p.kind];
  const ob: Obstacle = { x: p.x, z: p.z, r: factor * p.scale };
  if (top !== undefined) ob.yTop = p.y + top * p.scale;
  return ob;
}

/**
 * Grapple anchor cylinder for a tree/rock (the hook latches to its trunk/body),
 * or null for props that can't be anchored to. Radius matches the collision
 * cylinder; the y-band spans base → an approximate mesh top so a hook can catch
 * high on a tree's canopy or on top of a boulder.
 */
export function placementGrappleCollider(p: PropPlacement): GrappleCollider | null {
  const rFactor = (SCATTER.obstacleRadius as Record<string, number>)[p.kind];
  const top = PROP_TOP[p.kind];
  if (rFactor === undefined || top === undefined) return null;
  return { x: p.x, z: p.z, r: rFactor * p.scale, yBase: p.y, yTop: p.y + top * p.scale };
}
