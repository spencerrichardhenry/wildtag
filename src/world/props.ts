import * as THREE from 'three';
import { CHUNKS, SCATTER } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';
import type { Obstacle } from '../player/collision.ts';
import {
  scatterForChunk,
  placementObstacle,
  placementGrappleCollider,
  type PropKind,
  type PropPlacement,
} from './scatter.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import {
  harvest,
  isAvailable,
  makeNode,
  withinHarvestCone,
  type NodeState,
} from './resources.ts';

// ---------------------------------------------------------------------------
// Prop mesh layer + streaming PropManager. Low-poly, flat-shaded primitives
// (≤120 tris each) are built once per kind and shared, then drawn via one
// InstancedMesh per (chunk, kind). The manager streams prop chunks in a smaller
// radius than terrain, emits collision cylinders for trees/rocks, and owns the
// harvestable-resource node registry: harvesting dims/shrinks the depleted
// instance until it respawns (SCATTER.respawnS). Pure placement/state logic
// lives in scatter.ts / resources.ts — this module is the three.js bridge.
// ---------------------------------------------------------------------------

const C = SCATTER.colors;

/** Bake a uniform vertex colour onto a geometry and drop its index (flat). */
function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Concatenate coloured non-indexed parts into one BufferGeometry. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position');
    const pc = p.getAttribute('color');
    for (let i = 0; i < pp.count; i++) {
      pos[o * 3] = pp.getX(i);
      pos[o * 3 + 1] = pp.getY(i);
      pos[o * 3 + 2] = pp.getZ(i);
      col[o * 3] = pc.getX(i);
      col[o * 3 + 1] = pc.getY(i);
      col[o * 3 + 2] = pc.getZ(i);
      o++;
    }
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// --- Geometry builders (base at y=0; instance scale/rot applied per prop) ---

/** Trunk cylinder + conical foliage. ~34 tris. */
export function buildTree(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, 1.3, 5);
  trunk.translate(0, 0.65, 0);
  const foliage = new THREE.ConeGeometry(1.1, 2.4, 6);
  foliage.translate(0, 2.3, 0);
  return merge([colored(trunk, C.trunk), colored(foliage, C.foliage)]);
}

/** Low-poly boulder (icosahedron). 20 tris. */
export function buildRock(): THREE.BufferGeometry {
  const rock = new THREE.IcosahedronGeometry(0.9, 0);
  rock.scale(1, 0.8, 1);
  rock.translate(0, 0.55, 0);
  return merge([colored(rock, C.rock)]);
}

/** Elongated octahedral crystal. 8 tris. */
export function buildCrystal(): THREE.BufferGeometry {
  const cr = new THREE.OctahedronGeometry(0.5, 0);
  cr.scale(0.7, 2.0, 0.7);
  cr.translate(0, 0.7, 0);
  return merge([colored(cr, C.crystal)]);
}

/** Thin stem + small head. ~24 tris. */
export function buildFlower(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.02, 0.03, 0.45, 4);
  stem.translate(0, 0.22, 0);
  const head = new THREE.IcosahedronGeometry(0.13, 0);
  head.translate(0, 0.48, 0);
  return merge([colored(stem, C.reed), colored(head, C.flower)]);
}

/** Grass tuft (short flattened cone). ~8 tris. */
function buildFiber(): THREE.BufferGeometry {
  const tuft = new THREE.ConeGeometry(0.2, 0.55, 5);
  tuft.translate(0, 0.27, 0);
  return merge([colored(tuft, C.fiber)]);
}

/** Amber resin blob. 20 tris. */
function buildResin(): THREE.BufferGeometry {
  const blob = new THREE.IcosahedronGeometry(0.18, 0);
  blob.scale(1, 1.3, 1);
  blob.translate(0, 0.22, 0);
  return merge([colored(blob, C.resin)]);
}

/** Crystal-shard cluster (two crossed octahedra). 16 tris. */
function buildShard(): THREE.BufferGeometry {
  const a = new THREE.OctahedronGeometry(0.35, 0);
  a.scale(0.6, 2.2, 0.6);
  a.translate(0, 0.5, 0);
  const b = new THREE.OctahedronGeometry(0.28, 0);
  b.scale(0.5, 1.5, 0.5);
  b.translate(0.28, 0.35, 0.1);
  return merge([colored(a, C.shard), colored(b, C.shard)]);
}

/** Floating spark mote (small octahedron). 8 tris. */
function buildSpark(): THREE.BufferGeometry {
  const m = new THREE.OctahedronGeometry(0.16, 0);
  m.translate(0, 0.9, 0);
  return merge([colored(m, C.spark)]);
}

const BUILDERS: Record<PropKind, () => THREE.BufferGeometry> = {
  tree: buildTree,
  rock: buildRock,
  crystal: buildCrystal,
  flower: buildFlower,
  fiber: buildFiber,
  resin: buildResin,
  shard: buildShard,
  spark: buildSpark,
};

// Glow kinds render with an emissive lift; the spark is fully unlit so it
// reads as a mote regardless of the sun angle.
const EMISSIVE: Partial<Record<PropKind, number>> = {
  crystal: 0.35,
  shard: 0.5,
  resin: 0.3,
};

function materialFor(kind: PropKind): THREE.Material {
  if (kind === 'spark') {
    return new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const e = EMISSIVE[kind];
  if (e !== undefined) {
    mat.emissive = new THREE.Color(C[kind as keyof typeof C]);
    mat.emissiveIntensity = e;
  }
  return mat;
}

// Shared geometry + material per kind (built lazily, reused across all chunks).
const geoCache = new Map<PropKind, THREE.BufferGeometry>();
const matCache = new Map<PropKind, THREE.Material>();

function sharedGeo(kind: PropKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    g = BUILDERS[kind]();
    geoCache.set(kind, g);
  }
  return g;
}
function sharedMat(kind: PropKind): THREE.Material {
  let m = matCache.get(kind);
  if (!m) {
    m = materialFor(kind);
    matCache.set(kind, m);
  }
  return m;
}

const RESOURCE_KINDS = new Set<PropKind>(['fiber', 'resin', 'shard', 'spark']);

interface NodeEntry {
  node: NodeState;
  mesh: THREE.InstancedMesh;
  index: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  lastAvailable: boolean;
}

interface LoadedProps {
  cx: number;
  cz: number;
  meshes: THREE.InstancedMesh[];
  obstacles: Obstacle[];
  grappleColliders: GrappleCollider[];
  nodes: NodeEntry[];
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

// Scratch objects for allocation-free matrix composition.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _euler = new THREE.Euler();

function compose(x: number, y: number, z: number, rot: number, scale: number): THREE.Matrix4 {
  _euler.set(0, rot, 0);
  _q.setFromEuler(_euler);
  _p.set(x, y, z);
  _s.set(scale, scale, scale);
  return _m.compose(_p, _q, _s);
}

/**
 * Streams instanced prop meshes around the player, supplies obstacles, and owns
 * harvestable resource nodes. Node depletion state persists in a registry keyed
 * by chunk+placement index, so leaving and re-entering a chunk keeps a harvested
 * node depleted until its respawn time.
 */
export class PropManager {
  private readonly scene: THREE.Scene;
  private readonly loaded = new Map<string, LoadedProps>();
  /** Persistent node state keyed by `${cx},${cz}:${placementIndex}`. */
  private readonly registry = new Map<string, NodeState>();
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Keep prop chunks within SCATTER.radius resident (build at most
   * SCATTER.buildsPerUpdate per call); dispose the rest. `now` (seconds) drives
   * resource respawn visuals.
   */
  update(playerX: number, playerZ: number, now: number): void {
    const pcx = Math.floor(playerX / CHUNKS.size);
    const pcz = Math.floor(playerZ / CHUNKS.size);
    const r = SCATTER.radius;

    for (const [key, chunk] of this.loaded) {
      if (Math.abs(chunk.cx - pcx) > r || Math.abs(chunk.cz - pcz) > r) {
        this.disposeChunk(chunk);
        this.loaded.delete(key);
      }
    }

    let budget = SCATTER.buildsPerUpdate;
    for (let ring = 0; ring <= r && budget > 0; ring++) {
      for (let dz = -ring; dz <= ring && budget > 0; dz++) {
        for (let dx = -ring; dx <= ring && budget > 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (this.loaded.has(key)) continue;
          this.loaded.set(key, this.buildChunk(cx, cz, now));
          budget--;
        }
      }
    }

    this.syncVisuals(now);
  }

  /** Build every in-range chunk synchronously (boot priming, no hitch cap). */
  primeAround(playerX: number, playerZ: number, now: number): void {
    const pcx = Math.floor(playerX / CHUNKS.size);
    const pcz = Math.floor(playerZ / CHUNKS.size);
    const r = SCATTER.radius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (!this.loaded.has(key)) this.loaded.set(key, this.buildChunk(cx, cz, now));
      }
    }
    this.syncVisuals(now);
  }

  private buildChunk(cx: number, cz: number, now: number): LoadedProps {
    const placements = scatterForChunk(cx, cz);

    // Group placement indices by kind.
    const byKind = new Map<PropKind, { p: PropPlacement; index: number }[]>();
    placements.forEach((p, index) => {
      const list = byKind.get(p.kind) ?? [];
      list.push({ p, index });
      byKind.set(p.kind, list);
    });

    const meshes: THREE.InstancedMesh[] = [];
    const obstacles: Obstacle[] = [];
    const grappleColliders: GrappleCollider[] = [];
    const nodes: NodeEntry[] = [];

    for (const [kind, list] of byKind) {
      const mesh = new THREE.InstancedMesh(sharedGeo(kind), sharedMat(kind), list.length);
      mesh.name = `props ${kind} ${chunkKey(cx, cz)}`;
      mesh.frustumCulled = true;

      list.forEach((item, i) => {
        const { p, index } = item;
        const ob = placementObstacle(p);
        if (ob) obstacles.push(ob);
        const gc = placementGrappleCollider(p);
        if (gc) grappleColliders.push(gc);

        if (RESOURCE_KINDS.has(kind)) {
          const rkey = `${cx},${cz}:${index}`;
          let node = this.registry.get(rkey);
          if (!node) {
            node = makeNode(this.nextId++, kind as NodeState['kind'], p.x, p.z, p.y);
            this.registry.set(rkey, node);
          }
          const avail = isAvailable(node, now);
          const s = avail ? p.scale : p.scale * SCATTER.depletedScale;
          mesh.setMatrixAt(i, compose(p.x, p.y, p.z, p.rot, s));
          nodes.push({
            node,
            mesh,
            index: i,
            x: p.x,
            y: p.y,
            z: p.z,
            rot: p.rot,
            scale: p.scale,
            lastAvailable: avail,
          });
        } else {
          mesh.setMatrixAt(i, compose(p.x, p.y, p.z, p.rot, p.scale));
        }
      });

      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      meshes.push(mesh);
    }

    return { cx, cz, meshes, obstacles, grappleColliders, nodes };
  }

  /** Restore/dim node instances whose availability changed since last sync. */
  private syncVisuals(now: number): void {
    for (const chunk of this.loaded.values()) {
      const dirty = new Set<THREE.InstancedMesh>();
      for (const e of chunk.nodes) {
        const avail = isAvailable(e.node, now);
        if (avail === e.lastAvailable) continue;
        const s = avail ? e.scale : e.scale * SCATTER.depletedScale;
        e.mesh.setMatrixAt(e.index, compose(e.x, e.y, e.z, e.rot, s));
        e.lastAvailable = avail;
        dirty.add(e.mesh);
      }
      for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Collision cylinders within SCATTER.obstacleRangeChunks of (x, z). */
  getObstacles(x: number, z: number): Obstacle[] {
    const pcx = Math.floor(x / CHUNKS.size);
    const pcz = Math.floor(z / CHUNKS.size);
    const rng = SCATTER.obstacleRangeChunks;
    const out: Obstacle[] = [];
    for (const chunk of this.loaded.values()) {
      if (Math.abs(chunk.cx - pcx) > rng || Math.abs(chunk.cz - pcz) > rng) continue;
      for (const ob of chunk.obstacles) out.push(ob);
    }
    return out;
  }

  /** Grappleable tree/rock cylinders within SCATTER.obstacleRangeChunks of (x, z). */
  getGrappleColliders(x: number, z: number): GrappleCollider[] {
    const pcx = Math.floor(x / CHUNKS.size);
    const pcz = Math.floor(z / CHUNKS.size);
    const rng = SCATTER.obstacleRangeChunks;
    const out: GrappleCollider[] = [];
    for (const chunk of this.loaded.values()) {
      if (Math.abs(chunk.cx - pcx) > rng || Math.abs(chunk.cz - pcz) > rng) continue;
      for (const gc of chunk.grappleColliders) out.push(gc);
    }
    return out;
  }

  /** Nearest available resource node within range + look cone, else null. */
  findHarvestable(origin: Vec3, look: Vec3, now: number): NodeState | null {
    let best: NodeState | null = null;
    let bestD = Infinity;
    for (const chunk of this.loaded.values()) {
      for (const e of chunk.nodes) {
        if (!isAvailable(e.node, now)) continue;
        if (!withinHarvestCone(origin, look, e.node)) continue;
        const d = Math.hypot(e.x - origin.x, e.y - origin.y, e.z - origin.z);
        if (d < bestD) {
          bestD = d;
          best = e.node;
        }
      }
    }
    return best;
  }

  /**
   * Harvest the aimed-at node, if any. Applies the pure `harvest` cooldown,
   * dims the instance, and returns the gained ResourceKind (or null).
   */
  harvestAt(origin: Vec3, look: Vec3, now: number): NodeState['kind'] | null {
    const target = this.findHarvestable(origin, look, now);
    if (!target) return null;
    const res = harvest([target], target.id, now);
    if (!res.gained) return null;
    target.depletedUntil = res.nodes[0]!.depletedUntil;
    this.syncVisuals(now);
    return res.gained;
  }

  /** Dispose every resident chunk (node registry state is retained). */
  dispose(): void {
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
  }

  private disposeChunk(chunk: LoadedProps): void {
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.dispose(); // frees the per-instance matrix buffer; shared geo/mat kept
    }
  }
}
