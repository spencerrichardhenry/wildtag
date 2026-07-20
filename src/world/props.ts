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
import { hash2 } from '../core/rng.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import {
  harvest,
  isAvailable,
  makeNode,
  withinHarvestCone,
  type NodeState,
} from './resources.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';

// ---------------------------------------------------------------------------
// Prop mesh layer + streaming PropManager. Low-poly, flat-shaded primitives
// (≤120 tris each) are built once per kind and shared, then drawn via one
// THREE.BatchedMesh per MATERIAL GROUP (Fidelity-2 P1): chunks add/delete
// instance ids into the batches on stream in/out, so the whole prop field
// renders in ~9 multi-draw calls with per-instance frustum culling, instead of
// one draw call per (chunk, kind). The manager streams prop chunks in a smaller
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
// willows + lily pads, forest glow mushrooms and permanent meadow grass tufts.
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

/**
 * Permanent meadow grass tuft: a small fan of three crossed TAPERED blades
 * (trapezoid strips whose tips narrow to ~15% of the base width), each with a
 * fixed height in a ±35% band and a slight outward lean, so the silhouette
 * reads as a grass clump rather than crossed cards. The vertex colour bakes a
 * GREYSCALE root→tip ramp (0.8 dark root → 1.1 bright tip); the actual green
 * is supplied per instance by the batch colour (setColorAt), which multiplies
 * the ramp — every tuft gets a hash-jittered meadow-green while keeping the
 * darker-base/lighter-tip shading. Static (no wind shader); builder rng-free.
 */
function grasstuftBlade(rotY: number, h: number, lean: number): THREE.BufferGeometry {
  const p = new THREE.PlaneGeometry(0.34, h, 1, 3);
  p.translate(0, h / 2, 0); // base at y = 0
  // Taper: narrow linearly toward the tip (tip width ≈ 15% of the base).
  const raw = p.getAttribute('position');
  for (let i = 0; i < raw.count; i++) {
    const t = clamp01(raw.getY(i) / h);
    raw.setX(i, raw.getX(i) * (1 - 0.85 * t));
  }
  p.rotateX(lean); // pivot at the base: the tip leans outward
  p.rotateY(rotY);
  const g = p.toNonIndexed();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // 0.95 (root) → 1.35 (tip): a grey ramp the per-instance green multiplies.
    // Deliberately >1 toward the tip: near-vertical faces receive far less
    // direct sun than the upward-facing terrain (and the back half of the
    // double-sided blades none), so without this lift the tufts render as
    // dark cutouts against the meadow instead of blending into it.
    const v = 0.95 + clamp01(pos.getY(i) / h) * 0.4;
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function buildGrasstuft(): THREE.BufferGeometry {
  // Three blades fanned at 60°, heights spanning ±35% about ~0.45 m, leans
  // alternating so no two tips point the same way.
  return merge([
    grasstuftBlade(0, 0.46, 0.16),
    grasstuftBlade(Math.PI / 3, 0.32, -0.22),
    grasstuftBlade((2 * Math.PI) / 3, 0.58, 0.1),
  ]);
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
  grasstuft: buildGrasstuft,
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
const DOUBLE_SIDED = new Set<string>(['grasstuft', 'lilypad']);

// Per-bucket roughness for the Standard-material path (medium+). Rocks/mesas are
// matte, trees a touch smoother, crystals slick; everything else is foliage.
const ROCK_BUCKETS = new Set<string>(['rock', 'mesa', 'rib', 'boulder', 'scree']);
const TREE_BUCKETS = new Set<string>([
  'pine', 'broadleaf', 'snag', 'oak', 'shrub', 'windpine', 'boulderpine', 'willow', 'juniper', 'tree',
]);
const CRYSTAL_BUCKETS = new Set<string>(['crystal', 'crystalA', 'crystalB', 'crystalC', 'shard']);

function roughnessFor(bucket: string): number {
  if (ROCK_BUCKETS.has(bucket)) return ROUGHNESS.rock;
  if (TREE_BUCKETS.has(bucket)) return ROUGHNESS.tree;
  if (CRYSTAL_BUCKETS.has(bucket)) return ROUGHNESS.crystal;
  return ROUGHNESS.foliage;
}

function materialFor(bucket: string): THREE.Material {
  if (bucket === 'spark') {
    return new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  const e = EMISSIVE[bucket];
  // Quality-gated: MeshStandardMaterial (per-kind roughness) on medium+, the
  // identical-look MeshLambertMaterial on low. flatShading + vertex colours +
  // emissive glow carry across both paths.
  const mat = makeSurfaceMaterial({
    vertexColors: true,
    flatShading: true,
    side: DOUBLE_SIDED.has(bucket) ? THREE.DoubleSide : THREE.FrontSide,
    roughness: roughnessFor(bucket),
    ...(e ? { emissive: e.hex, emissiveIntensity: e.i } : {}),
  }) as THREE.MeshStandardMaterial;
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
  batch: PropBatch;
  index: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  lastAvailable: boolean;
}

/** One bucket's instance-id allocation within a resident chunk. */
interface ChunkAlloc {
  bucket: string;
  batch: PropBatch;
  indices: number[];
}

interface LoadedProps {
  cx: number;
  cz: number;
  allocs: ChunkAlloc[];
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

// ---------------------------------------------------------------------------
// Batched prop pools (Fidelity-2 P1, revised P1.1). Replaces the old one-
// InstancedMesh-per-(chunk,bucket) scheme with ONE THREE.BatchedMesh per
// MATERIAL GROUP (standard / double-sided / each emissive tint / unlit spark):
// every geometry bucket registers its shared geometry once, and every placement
// is an addInstance() into its group's batch. This gets BOTH wins at once —
// the whole prop field renders in ~9 draw calls (WEBGL_multi_draw) AND each
// instance is individually frustum-culled (perObjectFrustumCulled), so off-
// screen props never reach the vertex stage (a global unculled InstancedMesh
// pool per kind had floored software rasterizers on vertex throughput; a
// per-sector pool split kept culling but multiplied draw calls past budget).
// Chunks add/delete instance ids on stream in/out; BatchedMesh recycles freed
// ids internally, so capacity plateaus under streaming churn and grows
// (doubling via setInstanceCount) only if a denser region overflows it.
// ---------------------------------------------------------------------------
const BATCH_INITIAL_INSTANCES = 512;
/** Vertex storage per group: geometries are stored once (instances share them). */
const BATCH_VERTS_STANDARD = 32768;
const BATCH_VERTS_SMALL = 4096;

/** Material-group key for a bucket (one BatchedMesh + material per key). */
function materialGroup(bucket: string): string {
  if (bucket === 'spark') return 'basic';
  if (DOUBLE_SIDED.has(bucket)) return 'double';
  const e = EMISSIVE[bucket];
  if (e) return `emissive-${bucket}`;
  return 'standard';
}

class PropBatch {
  readonly mesh: THREE.BatchedMesh;
  private readonly geoIds = new Map<string, number>();
  /** Currently-allocated instance count (visibility gate + stats). */
  live = 0;

  constructor(
    private readonly scene: THREE.Scene,
    group: string,
    firstBucket: string,
  ) {
    const verts = group === 'standard' ? BATCH_VERTS_STANDARD : BATCH_VERTS_SMALL;
    // All bucket geometries are non-indexed (see merge()), so no index storage.
    this.mesh = new THREE.BatchedMesh(BATCH_INITIAL_INSTANCES, verts, 0, sharedMat(firstBucket));
    this.mesh.name = `props batch ${group}`;
    // Whole-mesh culling off (the field straddles the camera); per-instance
    // culling on — each instance is tested against the frustum individually.
    this.mesh.frustumCulled = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.visible = false; // until the first live instance lands
    this.scene.add(this.mesh);
  }

  /** The batch-local geometry id for `bucket`, registering it on first use. */
  private geometryIdFor(bucket: string): number {
    let id = this.geoIds.get(bucket);
    if (id === undefined) {
      id = this.mesh.addGeometry(sharedGeo(bucket));
      this.geoIds.set(bucket, id);
    }
    return id;
  }

  /** Add an instance of `bucket`; returns its instance id. */
  alloc(bucket: string): number {
    const geoId = this.geometryIdFor(bucket);
    let id: number;
    try {
      id = this.mesh.addInstance(geoId);
    } catch {
      // At capacity: double and retry (streamed into a denser region).
      this.mesh.setInstanceCount(this.mesh.maxInstanceCount * 2);
      id = this.mesh.addInstance(geoId);
    }
    this.live++;
    this.mesh.visible = true;
    return id;
  }

  /** Set the transform of a live instance. */
  setMatrix(id: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(id, m);
  }

  /**
   * Set the per-instance colour of a live instance (BatchedMesh colours default
   * to white on add, so instances that never call this render unmodified).
   */
  setColor(id: number, color: THREE.Color): void {
    this.mesh.setColorAt(id, color);
  }

  /** Delete a live instance (its id is recycled internally). */
  free(id: number): void {
    this.mesh.deleteInstance(id);
    this.live--;
    if (this.live <= 0) this.mesh.visible = false; // nothing left to draw
  }

  /** Instance capacity (grows by doubling; plateaus under churn). */
  get capacity(): number {
    return this.mesh.maxInstanceCount;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose(); // internal batch geometry + data textures
  }
}

/**
 * Streams instanced prop meshes around the player, supplies obstacles, and owns
 * harvestable resource nodes. Node depletion state persists in a registry keyed
 * by chunk+placement index, so leaving and re-entering a chunk keeps a harvested
 * node depleted until its respawn time.
 */
// Independent hash channels for per-instance grass-tuft hue/lightness jitter
// (deterministic from the tuft's quantised world position → same tuft, same
// tint on every rebuild). The green base is C.grassTuft; setColorAt multiplies
// the geometry's baked greyscale root→tip ramp.
const GRASS_HUE = (WORLD_SEED ^ 0xa17f) >>> 0;
const GRASS_LIT = (WORLD_SEED ^ 0xb28e) >>> 0;
const _tuftColor = new THREE.Color();
const _tuftHSL = { h: 0, s: 0, l: 0 };
new THREE.Color(C.grassTuft).getHSL(_tuftHSL);

/**
 * Per-instance meadow-green tint for a grass tuft at world (x, z): the jitter
 * spans slightly-YELLOWED (hue shifted down toward yellow) to slightly-DEEPER
 * green (hue up a touch, lightness down), so the field reads as sun-varied
 * meadow texture rather than uniform paint.
 */
function grasstuftColor(x: number, z: number): THREE.Color {
  const qx = Math.round(x);
  const qz = Math.round(z);
  const hue = _tuftHSL.h + (hash2(GRASS_HUE, qx, qz) - 0.7) * 0.08; // −0.056 (yellowed) … +0.024 (deeper)
  const lit = clamp01(_tuftHSL.l + (hash2(GRASS_LIT, qx, qz) - 0.55) * 0.16); // −0.088 … +0.072
  return _tuftColor.setHSL(hue, _tuftHSL.s, lit);
}

export class PropManager {
  private readonly scene: THREE.Scene;
  private readonly loaded = new Map<string, LoadedProps>();
  /** Persistent node state keyed by `${cx},${cz}:${placementIndex}`. */
  private readonly registry = new Map<string, NodeState>();
  private nextId = 1;

  /** Prop batches keyed by material group, created lazily. */
  private readonly batches = new Map<string, PropBatch>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** The batch for `bucket`'s material group, created on first use. */
  private batchFor(bucket: string): PropBatch {
    const group = materialGroup(bucket);
    let batch = this.batches.get(group);
    if (!batch) {
      batch = new PropBatch(this.scene, group, bucket);
      this.batches.set(group, batch);
    }
    return batch;
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

    // Group placement indices by geometry bucket (`variant ?? kind`), so each
    // tree/crystal/mesa flavour instances its own registered geometry while
    // obstacle, grapple and resource logic still key off the gameplay `kind`.
    const byBucket = new Map<string, { p: PropPlacement; index: number }[]>();
    placements.forEach((p, index) => {
      const bucket = p.variant ?? p.kind;
      const list = byBucket.get(bucket) ?? [];
      list.push({ p, index });
      byBucket.set(bucket, list);
    });

    const allocs: ChunkAlloc[] = [];
    const obstacles: Obstacle[] = [];
    const grappleColliders: GrappleCollider[] = [];
    const nodes: NodeEntry[] = [];

    for (const [bucket, list] of byBucket) {
      // One instance id per placement in the bucket's material-group batch.
      const batch = this.batchFor(bucket);
      const indices: number[] = [];

      for (const { p, index } of list) {
        const slot = batch.alloc(bucket);
        indices.push(slot);

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
          batch.setMatrix(slot, compose(p.x, p.y, p.z, p.rot, s));
          nodes.push({
            node,
            batch,
            index: slot,
            x: p.x,
            y: p.y,
            z: p.z,
            rot: p.rot,
            scale: p.scale,
            lastAvailable: avail,
          });
        } else {
          batch.setMatrix(slot, compose(p.x, p.y, p.z, p.rot, p.scale));
          // Grass tufts get a per-instance meadow-green tint (multiplies the
          // geometry's baked greyscale root→tip ramp — see grasstuftBlade).
          if (p.kind === 'grasstuft') batch.setColor(slot, grasstuftColor(p.x, p.z));
        }
      }

      allocs.push({ bucket, batch, indices });
    }

    return { cx, cz, allocs, obstacles, grappleColliders, nodes };
  }

  /** Restore/dim node instances whose availability changed since last sync. */
  private syncVisuals(now: number): void {
    for (const chunk of this.loaded.values()) {
      for (const e of chunk.nodes) {
        const avail = isAvailable(e.node, now);
        if (avail === e.lastAvailable) continue;
        const s = avail ? e.scale : e.scale * SCATTER.depletedScale;
        e.batch.setMatrix(e.index, compose(e.x, e.y, e.z, e.rot, s));
        e.lastAvailable = avail;
      }
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

  /** Dispose every resident chunk + tear down the batches. */
  dispose(): void {
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
  }

  /**
   * Stream a chunk out: delete its instances from each material-group batch
   * (ids recycle internally), retaining the batches themselves for the next
   * chunk. Shared geometry/material and batch buffers live on across churn.
   */
  private disposeChunk(chunk: LoadedProps): void {
    for (const { batch, indices } of chunk.allocs) {
      for (const idx of indices) batch.free(idx);
    }
  }

  /**
   * Batch stats keyed by material group (test/introspection): instance
   * capacity + live instance count, used by the perf churn test to assert the
   * batches don't grow without bound under streaming.
   */
  poolStats(): Record<string, { capacity: number; live: number }> {
    const out: Record<string, { capacity: number; live: number }> = {};
    for (const [group, batch] of this.batches) {
      out[group] = { capacity: batch.capacity, live: batch.live };
    }
    return out;
  }

  /**
   * Test/introspection: true if some resident chunk holds a live `bucket`
   * instance whose batch matrix sits at (x, y, z) (within `eps`).
   */
  hasInstanceAt(bucket: string, x: number, y: number, z: number, eps = 1e-3): boolean {
    const m = new THREE.Matrix4();
    for (const chunk of this.loaded.values()) {
      for (const alloc of chunk.allocs) {
        if (alloc.bucket !== bucket) continue;
        for (const id of alloc.indices) {
          alloc.batch.mesh.getMatrixAt(id, m);
          const e = m.elements;
          if (
            Math.abs(e[12]! - x) < eps &&
            Math.abs(e[13]! - y) < eps &&
            Math.abs(e[14]! - z) < eps
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
