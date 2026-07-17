import * as THREE from 'three';
import { CHUNKS, SCATTER, WORLD_SEED } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';
import type { Obstacle } from '../player/collision.ts';
import {
  scatterForChunk,
  placementObstacle,
  placementGrappleCollider,
  type PropKind,
  type PropPlacement,
} from './scatter.ts';
import { biomeAt, heightAt } from './terrain.ts';
import { hash2 } from '../core/rng.ts';
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

// ---------------------------------------------------------------------------
// Geometry builders (base at y=0; instance scale/rot applied per prop). Each
// returns ONE merged, flat-shaded, vertex-coloured BufferGeometry shared across
// every instance of its bucket, so builders are rng-free and deterministic —
// per-instance variety comes from the scatter transform (scale+yaw) + which
// variant is chosen. F2 adds a per-biome tree/crystal/mesa variant zoo, cliff
// formations (mesa slabs, boulder stacks, scree, rock ribs), wetland reeds +
// willows + lily pads, forest glow mushrooms and near-player grass tufts.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Coloured cylinder centred so its mid-height sits at `y`. */
function cyl(rTop: number, rBot: number, h: number, seg: number, hex: number, y: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, y, 0);
  return colored(g, hex);
}
/** Coloured cone with its base at `y`. */
function cone(r: number, h: number, seg: number, hex: number, y: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, y + h / 2, 0);
  return colored(g, hex);
}
/** Coloured low-poly blob (icosahedron), optional non-uniform scale, at (x,y,z). */
function blob(
  r: number, hex: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, hex);
}
/** Coloured box centred at (x,y,z) with an optional Y rotation. */
function box(
  w: number, h: number, d: number, hex: number, x: number, y: number, z: number, ry = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colored(g, hex);
}
/** An octahedron shard/crystal, non-uniformly scaled, at (x,y,z). */
function oct(
  r: number, hex: number, x: number, y: number, z: number, sx: number, sy: number, sz: number,
): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, hex);
}

// --- Trees -----------------------------------------------------------------

/** Tall pine: trunk + three stacked cone tiers (~4.5m). Refined original. */
export function buildTree(): THREE.BufferGeometry {
  return merge([
    cyl(0.12, 0.2, 1.4, 5, C.trunk, 0.7),
    cone(1.2, 1.9, 7, C.pineFoliage, 1.1),
    cone(0.9, 1.7, 7, C.pineFoliage, 2.2),
    cone(0.55, 1.4, 7, C.pineFoliage, 3.2),
  ]);
}

// initial draft via codex (buildBroadleaf) — adapted to merged vertex-coloured geo
/** Broadleaf dome: trunk + three overlapping blobby canopy spheres (~4m). */
function buildBroadleaf(): THREE.BufferGeometry {
  return merge([
    cyl(0.16, 0.26, 2.4, 6, C.trunk, 1.2),
    blob(0.85, C.broadleaf, -0.45, 2.95, 0.05, 1.05, 0.95, 1.05),
    blob(0.8, C.broadleaf, 0.42, 3.05, -0.08, 1, 1, 1),
    blob(0.9, C.broadleaf, 0.02, 3.55, 0.12, 1, 1, 1),
  ]);
}

/** Dead snag: bare tapering trunk + two broken angled branch stubs. */
function buildSnag(): THREE.BufferGeometry {
  const b1 = new THREE.CylinderGeometry(0.04, 0.07, 1.1, 4);
  b1.rotateZ(0.9);
  b1.translate(0.35, 2.2, 0);
  const b2 = new THREE.CylinderGeometry(0.03, 0.06, 0.9, 4);
  b2.rotateZ(-1.0);
  b2.translate(-0.3, 2.5, 0.1);
  return merge([cyl(0.1, 0.22, 2.6, 5, C.snag, 1.3), colored(b1, C.snag), colored(b2, C.snag)]);
}

/** Lone oak-ish: thick trunk + broad rounded canopy (built big; rare in meadow). */
function buildOak(): THREE.BufferGeometry {
  return merge([
    cyl(0.28, 0.45, 2.2, 6, C.trunk, 1.1),
    blob(1.5, C.oakLeaf, 0, 3.3, 0, 1.2, 0.9, 1.2),
    blob(1.1, C.oakLeaf, -0.9, 3.0, 0.3, 1, 1, 1),
    blob(1.1, C.oakLeaf, 0.9, 3.1, -0.3, 1, 1, 1),
  ]);
}

/** Flowering shrub: low green mound dotted with pink blooms. */
function buildShrub(): THREE.BufferGeometry {
  return merge([
    blob(0.7, C.shrub, 0, 0.55, 0, 1.2, 0.8, 1.2),
    blob(0.5, C.shrub, 0.35, 0.7, 0.2, 1, 1, 1),
    blob(0.5, C.shrub, -0.3, 0.65, -0.25, 1, 1, 1),
    blob(0.1, C.shrubBloom, 0.4, 1.0, 0.1, 1, 1, 1),
    blob(0.1, C.shrubBloom, -0.2, 1.05, 0.35, 1, 1, 1),
    blob(0.1, C.shrubBloom, 0.05, 1.1, -0.3, 1, 1, 1),
  ]);
}

/** Wind-bent pine: leaning trunk + cone tiers swept asymmetrically downwind. */
function buildWindpine(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.1, 0.18, 1.7, 5);
  trunk.rotateZ(-0.16);
  trunk.translate(0.12, 0.85, 0);
  const c1 = new THREE.ConeGeometry(1.0, 1.6, 7);
  c1.translate(0.25, 2.0, 0);
  const c2 = new THREE.ConeGeometry(0.72, 1.4, 7);
  c2.translate(0.5, 2.9, 0);
  const c3 = new THREE.ConeGeometry(0.44, 1.2, 7);
  c3.translate(0.82, 3.7, 0);
  return merge([
    colored(trunk, C.trunk),
    colored(c1, C.windPine),
    colored(c2, C.windPine),
    colored(c3, C.windPine),
  ]);
}

/** Boulder-pine cluster: a rocky mound with a small pine growing beside it. */
function buildBoulderpine(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.08, 0.13, 1.0, 5);
  trunk.translate(-0.35, 0.9, 0.1);
  const p1 = new THREE.ConeGeometry(0.6, 1.1, 6);
  p1.translate(-0.35, 1.6, 0.1);
  const p2 = new THREE.ConeGeometry(0.4, 0.9, 6);
  p2.translate(-0.35, 2.2, 0.1);
  return merge([
    blob(0.95, C.boulder, 0.2, 0.55, 0, 1.2, 0.8, 1.1),
    blob(0.6, C.boulder, 0.75, 0.45, 0.35, 1, 1, 1),
    colored(trunk, C.trunk),
    colored(p1, C.windPine),
    colored(p2, C.windPine),
  ]);
}

// initial draft via codex (buildWillow) — adapted: rng-free fixed strands, merged geo
/** Drooping willow: trunk, two canopy blobs, and a fringe of hanging strand-cones. */
function buildWillow(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    cyl(0.16, 0.32, 3.9, 6, C.trunk, 1.95),
    blob(1.0, C.willowLeaf, -0.38, 4.5, 0, 1.5, 1.05, 1.3),
    blob(1.0, C.willowLeaf, 0.6, 4.4, 0.08, 1.2, 0.95, 1.15),
  ];
  const strands = 8;
  const len = 3.0;
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * TAU;
    const rad = 1.15;
    const g = new THREE.ConeGeometry(0.08, len, 4);
    g.rotateX(Math.PI); // flip so the tip droops downward
    g.translate(Math.cos(a) * rad, 4.2 - len / 2, Math.sin(a) * rad * 0.85);
    parts.push(colored(g, C.willowLeaf));
  }
  return merge(parts);
}

/** Gnarled juniper snag: twisted multi-segment trunk + sparse dark tufts (crags). */
function buildJuniper(): THREE.BufferGeometry {
  const t1 = new THREE.CylinderGeometry(0.12, 0.2, 1.2, 5);
  t1.rotateZ(0.15);
  t1.translate(0, 0.6, 0);
  const t2 = new THREE.CylinderGeometry(0.08, 0.12, 1.1, 5);
  t2.rotateZ(-0.4);
  t2.translate(-0.25, 1.5, 0);
  const t3 = new THREE.CylinderGeometry(0.06, 0.09, 0.9, 5);
  t3.rotateZ(0.5);
  t3.translate(0.2, 1.7, 0.1);
  return merge([
    colored(t1, C.snag),
    colored(t2, C.snag),
    colored(t3, C.snag),
    blob(0.5, C.juniper, -0.5, 2.1, 0, 1.1, 0.6, 1.1),
    blob(0.45, C.juniper, 0.45, 2.3, 0.1, 1, 1, 1),
    blob(0.35, C.juniper, 0, 1.6, -0.3, 1, 1, 1),
  ]);
}

// --- Rocks / cliff formations ----------------------------------------------

/** Low-poly boulder (icosahedron). 20 tris. */
export function buildRock(): THREE.BufferGeometry {
  return merge([blob(0.9, C.rock, 0, 0.55, 0, 1, 0.8, 1)]);
}

// initial draft via codex (buildMesa) — adapted: fixed layers, merged vertex-coloured geo
/** Crag mesa: four flattened boxes of decreasing width, each yaw-jittered (~4.6m). */
function buildMesa(): THREE.BufferGeometry {
  return merge([
    box(4.2, 1.4, 2.9, C.mesa, 0, 0.7, 0, 0.1),
    box(3.4, 1.2, 2.4, C.mesa, 0.15, 2.0, 0.1, -0.15),
    box(2.6, 1.1, 1.9, C.mesa, -0.1, 3.1, 0.15, 0.2),
    box(1.8, 1.0, 1.3, C.mesa, 0.2, 4.1, -0.1, -0.1),
  ]);
}

/** Highlands rock rib: a low elongated ridge of angled slabs. */
function buildRib(): THREE.BufferGeometry {
  return merge([
    box(1.3, 1.0, 3.6, C.rib, 0, 0.6, 0, 0.28),
    box(1.0, 1.7, 2.3, C.rib, 0.35, 1.35, -0.2, 0.18),
    box(0.8, 0.9, 1.5, C.rib, -0.25, 1.1, 0.45, -0.16),
  ]);
}

/** Boulder stack: composite of icosphere boulders + a wedged box (~2m). */
function buildBoulder(): THREE.BufferGeometry {
  return merge([
    blob(0.95, C.boulder, 0, 0.6, 0, 1.1, 0.85, 1.0),
    blob(0.7, C.boulder, 0.5, 0.55, 0.4, 1.0, 0.9, 1.1),
    blob(0.6, C.boulder, -0.2, 1.25, -0.1, 1, 1, 1),
    box(0.7, 0.6, 0.7, C.boulder, -0.55, 0.45, -0.3, 0.4),
  ]);
}

/** Scree patch: a scatter of tiny flattened pebbles (set dressing, no collision). */
function buildScree(): THREE.BufferGeometry {
  const pts: [number, number, number][] = [
    [0, 0, 0.17], [0.6, 0.3, 0.14], [-0.5, 0.4, 0.15], [0.3, -0.6, 0.13],
    [-0.6, -0.3, 0.16], [0.8, -0.2, 0.12], [-0.2, 0.7, 0.14], [0.15, 0.12, 0.18],
  ];
  return merge(pts.map(([x, z, r]) => blob(r, C.scree, x, r * 0.7, z, 1.1, 0.7, 1.1)));
}

// --- Wetland ---------------------------------------------------------------

/** Reed cluster: a splay of thin tall cones (no collision). */
function buildReed(): THREE.BufferGeometry {
  const cfg: [number, number, number, number][] = [
    [0, 0, 0, 0], [0.12, 0.1, 0.1, 0.05], [-0.1, -0.12, -0.12, -0.06],
    [0.05, -0.08, 0.06, 0.03], [-0.08, 0.1, 0.1, -0.04], [0.14, -0.05, -0.05, 0.07],
  ];
  return merge(cfg.map(([x, z, lz, lx]) => {
    const g = new THREE.ConeGeometry(0.05, 1.4, 4);
    g.rotateZ(lz);
    g.rotateX(lx);
    g.translate(x, 0.7, z);
    return colored(g, C.reed);
  }));
}

/** Floating lily pad: flat disc + a small bloom (no collision, sits at water Y). */
function buildLilypad(): THREE.BufferGeometry {
  const pad = new THREE.CylinderGeometry(0.55, 0.55, 0.05, 9);
  pad.translate(0, 0.025, 0);
  return merge([colored(pad, C.lily), blob(0.12, C.lilyBloom, 0.12, 0.12, 0.05, 1, 0.6, 1)]);
}

// --- Forest floor / glow ---------------------------------------------------

/** Glow-mushroom cluster: small emissive caps on cream stems (no collision). */
function buildMushroom(): THREE.BufferGeometry {
  const cfg: [number, number, number][] = [
    [0, 0, 1], [0.22, 0.1, 0.75], [-0.18, -0.12, 0.7], [0.08, -0.2, 0.6],
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, s] of cfg) {
    const stem = new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.32 * s, 4);
    stem.translate(x, 0.16 * s, z);
    const cap = new THREE.SphereGeometry(0.15 * s, 6, 4, 0, TAU, 0, Math.PI * 0.6);
    cap.translate(x, 0.32 * s, z);
    parts.push(colored(stem, C.mushroomStem), colored(cap, C.mushroomCap));
  }
  return merge(parts);
}

/** Near-player grass tuft: two crossed quads, darker at the base (double-sided). */
function grassBlade(rotY: number): THREE.BufferGeometry {
  const p = new THREE.PlaneGeometry(0.45, 0.6);
  p.rotateY(rotY);
  p.translate(0, 0.3, 0);
  const g = p.toNonIndexed();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(C.grassBase);
  const top = new THREE.Color(C.grassTop);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    tmp.copy(base).lerp(top, clamp01(pos.getY(i) / 0.6));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function buildGrass(): THREE.BufferGeometry {
  return merge([grassBlade(0), grassBlade(Math.PI / 2)]);
}

// --- Crystals (crag/highlands variants) ------------------------------------

/** Elongated octahedral crystal (fallback/tall single). */
export function buildCrystal(): THREE.BufferGeometry {
  return buildCrystalA();
}
function buildCrystalA(): THREE.BufferGeometry {
  return merge([oct(0.5, C.crystalA, 0, 0.7, 0, 0.7, 2.0, 0.7)]);
}
function buildCrystalB(): THREE.BufferGeometry {
  return merge([
    oct(0.42, C.crystalB, 0, 0.6, 0, 0.7, 1.7, 0.7),
    oct(0.3, C.crystalB, 0.3, 0.4, 0.15, 0.6, 1.3, 0.6),
  ]);
}
function buildCrystalC(): THREE.BufferGeometry {
  return merge([
    oct(0.35, C.crystalC, 0, 0.4, 0, 0.9, 1.1, 0.9),
    oct(0.28, C.crystalC, 0.28, 0.3, 0.1, 0.8, 1.0, 0.8),
    oct(0.24, C.crystalC, -0.22, 0.28, -0.12, 0.8, 0.9, 0.8),
  ]);
}

// --- Small props / resources -----------------------------------------------

/** Thin stem + small head. */
export function buildFlower(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.02, 0.03, 0.45, 4);
  stem.translate(0, 0.22, 0);
  return merge([colored(stem, C.reed), blob(0.13, C.flower, 0, 0.48, 0, 1, 1, 1)]);
}

/** Fiber tuft (short flattened cone). */
function buildFiber(): THREE.BufferGeometry {
  return merge([cone(0.2, 0.55, 5, C.fiber, 0)]);
}

/** Amber resin blob. */
function buildResin(): THREE.BufferGeometry {
  return merge([blob(0.18, C.resin, 0, 0.22, 0, 1, 1.3, 1)]);
}

/** Crystal-shard cluster (two crossed octahedra). */
function buildShard(): THREE.BufferGeometry {
  return merge([
    oct(0.35, C.shard, 0, 0.5, 0, 0.6, 2.2, 0.6),
    oct(0.28, C.shard, 0.28, 0.35, 0.1, 0.5, 1.5, 0.5),
  ]);
}

/** Floating spark mote (small octahedron). */
function buildSpark(): THREE.BufferGeometry {
  return merge([oct(0.16, C.spark, 0, 0.9, 0, 1, 1, 1)]);
}

// Geometry buckets keyed by `variant ?? kind`. Trees/crystals/mesas resolve via
// their variant; everything else via its gameplay kind.
const BUILDERS: Record<string, () => THREE.BufferGeometry> = {
  // trees
  pine: buildTree,
  broadleaf: buildBroadleaf,
  snag: buildSnag,
  oak: buildOak,
  shrub: buildShrub,
  windpine: buildWindpine,
  boulderpine: buildBoulderpine,
  willow: buildWillow,
  juniper: buildJuniper,
  tree: buildTree, // defensive fallback (variant always set in practice)
  // rocks / formations
  rock: buildRock,
  mesa: buildMesa,
  rib: buildRib,
  boulder: buildBoulder,
  scree: buildScree,
  // wetland / floor
  reed: buildReed,
  lilypad: buildLilypad,
  mushroom: buildMushroom,
  grass: buildGrass,
  // crystals
  crystal: buildCrystal, // defensive fallback
  crystalA: buildCrystalA,
  crystalB: buildCrystalB,
  crystalC: buildCrystalC,
  // small props / resources
  flower: buildFlower,
  fiber: buildFiber,
  resin: buildResin,
  shard: buildShard,
  spark: buildSpark,
};

// Emissive buckets get a glow lift (color, intensity); the spark is fully unlit
// so it reads as a mote regardless of the sun angle.
const EMISSIVE: Record<string, { hex: number; i: number }> = {
  crystal: { hex: C.crystalA, i: 0.35 },
  crystalA: { hex: C.crystalA, i: 0.35 },
  crystalB: { hex: C.crystalB, i: 0.4 },
  crystalC: { hex: C.crystalC, i: 0.4 },
  shard: { hex: C.shard, i: 0.5 },
  resin: { hex: C.resin, i: 0.3 },
  mushroom: { hex: C.mushroomCap, i: 0.55 },
};

// Buckets whose quads need to be visible from both sides.
const DOUBLE_SIDED = new Set<string>(['grass', 'lilypad']);

function materialFor(bucket: string): THREE.Material {
  if (bucket === 'spark') {
    return new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: DOUBLE_SIDED.has(bucket) ? THREE.DoubleSide : THREE.FrontSide,
  });
  const e = EMISSIVE[bucket];
  if (e) {
    mat.emissive = new THREE.Color(e.hex);
    mat.emissiveIntensity = e.i;
  }
  return mat;
}

// Shared geometry + material per bucket (built lazily, reused across all chunks).
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function sharedGeo(bucket: string): THREE.BufferGeometry {
  let g = geoCache.get(bucket);
  if (!g) {
    const build = BUILDERS[bucket] ?? buildRock;
    g = build();
    geoCache.set(bucket, g);
  }
  return g;
}
function sharedMat(bucket: string): THREE.Material {
  let m = matCache.get(bucket);
  if (!m) {
    m = materialFor(bucket);
    matCache.set(bucket, m);
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
// Independent hash channels for the near-player grass ring (deterministic from
// world position so the ring doesn't shimmer as the player crosses cells).
const GRASS_JX = (WORLD_SEED ^ 0xa17f) >>> 0;
const GRASS_JZ = (WORLD_SEED ^ 0xb28e) >>> 0;
const GRASS_DEN = (WORLD_SEED ^ 0xc39d) >>> 0;
const GRASS_ROT = (WORLD_SEED ^ 0xd4ac) >>> 0;
const GRASS_SCL = (WORLD_SEED ^ 0xe5bb) >>> 0;

export class PropManager {
  private readonly scene: THREE.Scene;
  private readonly loaded = new Map<string, LoadedProps>();
  /** Persistent node state keyed by `${cx},${cz}:${placementIndex}`. */
  private readonly registry = new Map<string, NodeState>();
  private nextId = 1;

  /** Near-player grass ring: one InstancedMesh, rebuilt on grass-cell change. */
  private grassMesh: THREE.InstancedMesh | null = null;
  private grassCellX = Number.NaN;
  private grassCellZ = Number.NaN;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Rebuild the dense grass ring when the player crosses a SCATTER.grass.cell
   * boundary (meadow/forest only, capped, deterministic from world position).
   */
  private updateGrass(px: number, pz: number): void {
    const cell = SCATTER.grass.cell;
    const cx = Math.floor(px / cell);
    const cz = Math.floor(pz / cell);
    if (cx === this.grassCellX && cz === this.grassCellZ && this.grassMesh) return;
    this.grassCellX = cx;
    this.grassCellZ = cz;

    const G = SCATTER.grass;
    if (!this.grassMesh) {
      this.grassMesh = new THREE.InstancedMesh(sharedGeo('grass'), sharedMat('grass'), G.cap);
      this.grassMesh.name = 'props grass ring';
      this.grassMesh.frustumCulled = false; // ring straddles the player, not origin
      this.scene.add(this.grassMesh);
    }
    const mesh = this.grassMesh;

    const step = G.spacing;
    const r2 = G.radius * G.radius;
    const [sMin, sMax] = SCATTER.scale.grass;
    const minGX = Math.floor((px - G.radius) / step);
    const maxGX = Math.floor((px + G.radius) / step);
    const minGZ = Math.floor((pz - G.radius) / step);
    const maxGZ = Math.floor((pz + G.radius) / step);
    let n = 0;
    for (let gx = minGX; gx <= maxGX && n < G.cap; gx++) {
      for (let gz = minGZ; gz <= maxGZ && n < G.cap; gz++) {
        if (hash2(GRASS_DEN, gx, gz) > G.density) continue;
        const x = gx * step + step * 0.5 + (hash2(GRASS_JX, gx, gz) - 0.5) * step;
        const z = gz * step + step * 0.5 + (hash2(GRASS_JZ, gx, gz) - 0.5) * step;
        const dx = x - px;
        const dz = z - pz;
        if (dx * dx + dz * dz > r2) continue;
        const b = biomeAt(x, z);
        if (b !== 'meadow' && b !== 'forest') continue;
        const y = heightAt(x, z);
        if (y < SCATTER.minPlacementY) continue;
        const rot = hash2(GRASS_ROT, gx, gz) * Math.PI * 2;
        const sc = sMin + hash2(GRASS_SCL, gx, gz) * (sMax - sMin);
        mesh.setMatrixAt(n, compose(x, y, z, rot, sc));
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
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

    this.updateGrass(playerX, playerZ);
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
    this.updateGrass(playerX, playerZ);
    this.syncVisuals(now);
  }

  private buildChunk(cx: number, cz: number, now: number): LoadedProps {
    const placements = scatterForChunk(cx, cz);

    // Group placement indices by geometry bucket (`variant ?? kind`), so each
    // tree/crystal/mesa flavour gets its own InstancedMesh while obstacle,
    // grapple and resource logic still key off the gameplay `kind`.
    const byBucket = new Map<string, { p: PropPlacement; index: number }[]>();
    placements.forEach((p, index) => {
      const bucket = p.variant ?? p.kind;
      const list = byBucket.get(bucket) ?? [];
      list.push({ p, index });
      byBucket.set(bucket, list);
    });

    const meshes: THREE.InstancedMesh[] = [];
    const obstacles: Obstacle[] = [];
    const grappleColliders: GrappleCollider[] = [];
    const nodes: NodeEntry[] = [];

    for (const [bucket, list] of byBucket) {
      const mesh = new THREE.InstancedMesh(sharedGeo(bucket), sharedMat(bucket), list.length);
      mesh.name = `props ${bucket} ${chunkKey(cx, cz)}`;
      mesh.frustumCulled = true;

      list.forEach((item, i) => {
        const { p, index } = item;
        const ob = placementObstacle(p);
        if (ob) obstacles.push(ob);
        const gc = placementGrappleCollider(p);
        if (gc) grappleColliders.push(gc);

        if (RESOURCE_KINDS.has(p.kind)) {
          const rkey = `${cx},${cz}:${index}`;
          let node = this.registry.get(rkey);
          if (!node) {
            node = makeNode(this.nextId++, p.kind as NodeState['kind'], p.x, p.z, p.y);
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
    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassMesh.dispose();
      this.grassMesh = null;
      this.grassCellX = Number.NaN;
      this.grassCellZ = Number.NaN;
    }
  }

  private disposeChunk(chunk: LoadedProps): void {
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.dispose(); // frees the per-instance matrix buffer; shared geo/mat kept
    }
  }
}
