import { CHUNKS, SCATTER, WORLD_SEED } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import { hash2 } from '../core/rng.ts';
import { heightAt, biomeAt } from './terrain.ts';

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
  | 'spark';

/** A single scattered prop: kind + world transform (y already snapped). */
export interface PropPlacement {
  kind: PropKind;
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

function h(salt: number, gx: number, gz: number): number {
  return hash2((WORLD_SEED ^ salt) >>> 0, gx, gz);
}

function scaleFor(kind: PropKind, gx: number, gz: number): number {
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
 * All props for chunk (cx, cz). Pure & deterministic; identical output for
 * identical arguments. Placement order is stable (row-major sub-cell scan, with
 * each tree immediately followed by its optional resin node, then the spark
 * roll) so a chunk's Nth placement keeps a stable identity for node state.
 */
export function scatterForChunk(cx: number, cz: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;

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
      if (!placeable(x, z, y)) continue;

      const kind = kindFor(biomeAt(x, z), h(S_KIND, gx, gz));
      if (!kind) continue;

      out.push({
        kind,
        x,
        z,
        y,
        scale: scaleFor(kind, gx, gz),
        rot: h(S_ROT, gx, gz) * Math.PI * 2,
      });

      // A forest tree may carry a resin node at its base (separate harvestable).
      if (kind === 'tree' && h(S_RESIN, gx, gz) < SCATTER.resinChancePerTree) {
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

  return out;
}

/**
 * Collision cylinder for a blocking prop (trees, rocks) scaled by its instance
 * scale; null for props that don't block (flowers, crystals, resource nodes).
 */
export function placementObstacle(p: PropPlacement): Obstacle | null {
  const factor = (SCATTER.obstacleRadius as Record<string, number>)[p.kind];
  if (factor === undefined) return null;
  return { x: p.x, z: p.z, r: factor * p.scale };
}

/** Approx. mesh top (m above base) per grappleable kind, × instance scale. */
const GRAPPLE_TOP: Partial<Record<PropKind, number>> = { tree: 4.5, rock: 1.6 };

/**
 * Grapple anchor cylinder for a tree/rock (the hook latches to its trunk/body),
 * or null for props that can't be anchored to. Radius matches the collision
 * cylinder; the y-band spans base → an approximate mesh top so a hook can catch
 * high on a tree's canopy or on top of a boulder.
 */
export function placementGrappleCollider(p: PropPlacement): GrappleCollider | null {
  const rFactor = (SCATTER.obstacleRadius as Record<string, number>)[p.kind];
  const top = GRAPPLE_TOP[p.kind];
  if (rFactor === undefined || top === undefined) return null;
  return { x: p.x, z: p.z, r: rFactor * p.scale, yBase: p.y, yTop: p.y + top * p.scale };
}
