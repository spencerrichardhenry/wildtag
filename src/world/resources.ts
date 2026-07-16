import { SCATTER } from '../core/constants.ts';
import type { ResourceKind, Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure harvestable-resource-node state. A NodeState is a harvest target with a
// world position and a `depletedUntil` timestamp: it is available when the
// current time has reached that timestamp (0 = never harvested = available).
// Harvesting yields one of the node's ResourceKind and sets a
// SCATTER.respawnS-second cooldown; a depleted node dims/shrinks visually (the
// mesh layer scales the instance) until it respawns exactly at now + respawnS.
//
// No `three` import, no randomness — plain data + math, unit-tested.
// ---------------------------------------------------------------------------

export interface NodeState {
  /** Stable identifier (unique within a live node set). */
  id: number;
  kind: ResourceKind;
  x: number;
  z: number;
  y: number;
  /** World time (s) at which the node becomes harvestable again; 0 = ready. */
  depletedUntil: number;
}

/** Construct a ready (never-harvested) resource node. */
export function makeNode(
  id: number,
  kind: ResourceKind,
  x: number,
  z: number,
  y: number,
): NodeState {
  return { id, kind, x, z, y, depletedUntil: 0 };
}

/** A node is harvestable once the clock has reached its respawn time. */
export function isAvailable(node: NodeState, now: number): boolean {
  return now >= node.depletedUntil;
}

/**
 * Harvest node `id` at time `now`. Pure: returns a new `nodes` array (the input
 * and its elements are never mutated). On success the node's kind is `gained`
 * and its `depletedUntil` is set to `now + SCATTER.respawnS`. If the id is
 * unknown or the node is still depleted, `gained` is null and the set is
 * returned unchanged.
 */
export function harvest(
  nodes: NodeState[],
  id: number,
  now: number,
): { nodes: NodeState[]; gained: ResourceKind | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return { nodes, gained: null };
  const node = nodes[idx]!;
  if (!isAvailable(node, now)) return { nodes, gained: null };

  const next = nodes.slice();
  next[idx] = { ...node, depletedUntil: now + SCATTER.respawnS };
  return { nodes: next, gained: node.kind };
}

const CONE_COS = Math.cos((SCATTER.harvestConeDeg * Math.PI) / 180);

/**
 * True when `node` sits within SCATTER.harvestRange of `origin` and within the
 * SCATTER.harvestConeDeg look cone around unit-ish `look`. `origin` is the eye
 * position; `look` is the camera forward (need not be normalized).
 */
export function withinHarvestCone(origin: Vec3, look: Vec3, node: NodeState): boolean {
  const dx = node.x - origin.x;
  const dy = node.y - origin.y;
  const dz = node.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > SCATTER.harvestRange) return false;
  if (dist < 1e-6) return true;

  const ll = Math.hypot(look.x, look.y, look.z) || 1;
  const dot = (dx * look.x + dy * look.y + dz * look.z) / (dist * ll);
  return dot >= CONE_COS;
}
