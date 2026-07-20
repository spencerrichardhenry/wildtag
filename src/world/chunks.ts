import * as THREE from 'three';
import { CHUNKS, ENV, WORLD_SEED } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
import { hash2 } from '../core/rng.ts';
import { heightAt, biomeAt } from './terrain.ts';
import { qualityFlags } from '../core/quality.ts';

// ---------------------------------------------------------------------------
// Streaming terrain mesh. The world is tiled into CHUNKS.size-metre squares;
// each chunk is a verts×verts vertex grid sampled from `heightAt` (positions in
// world coordinates, so neighbouring chunks share edge samples exactly → no
// seams). Vertices are coloured per biome (shore-sand below ENV.sandHeight),
// smooth-shaded from per-vertex normals off the height grid, and darkened in
// concavities by a baked vertex AO. Chunks within CHUNKS.radius of the player
// are kept resident; the rest are disposed (geometry freed, no leaks).
//
// F2 P2 — near-LOD: when the `nearLod` quality flag is on, chunks close to the
// player build at a 1 m grid (CHUNKS.nearVerts) and farther ones at the 2 m
// grid (CHUNKS.verts). Every chunk carries a downward EDGE SKIRT so the
// sub-metre height mismatch at a 1 m↔2 m boundary hides behind a vertical wall
// instead of a see-through T-junction. LOD selection has hysteresis so a chunk
// on the boundary doesn't thrash rebuilds.
// ---------------------------------------------------------------------------

/** Grid step (m between samples) for a `verts`×`verts` chunk. */
function stepFor(verts: number): number {
  return CHUNKS.size / (verts - 1);
}

// The FAR (2 m) grid step — the reference value the pure `terrainVertexColor` /
// regression path uses (the grid sampler derives its own step per LOD).
const STEP = stepFor(CHUNKS.verts); // 2 m

// Pre-resolved biome → THREE.Color lookup (built once).
const BIOME_COLOR: Record<Biome, THREE.Color> = {
  meadow: new THREE.Color(ENV.biomeColors.meadow),
  forest: new THREE.Color(ENV.biomeColors.forest),
  wetland: new THREE.Color(ENV.biomeColors.wetland),
  crags: new THREE.Color(ENV.biomeColors.crags),
  highlands: new THREE.Color(ENV.biomeColors.highlands),
  water: new THREE.Color(ENV.biomeColors.water),
};
const SAND_COLOR = new THREE.Color(ENV.biomeColors.sand);
// Crag grey the steep-slope rock tint blends toward.
const ROCK_COLOR = new THREE.Color(ENV.biomeColors.crags);

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Terrain vertex colour (pure, position-only → seam-safe: neighbouring chunks
// share edge samples and every input below is a function of world (x, z), so a
// shared vertex resolves to the identical colour on both sides). Effects layer
// on the flat biome palette: (1) a weighted BLEND across the biomes sampled
// around the vertex so borders fade instead of snapping; (2) a slope-based tint
// toward crag rock on steep faces; (3) a concavity AO darkening from the height
// grid; (4) a deterministic per-vertex micro lightness jitter. The shore sand
// band (below ENV.sandHeight) overrides the biome blend but still jitters + AOs.
// ---------------------------------------------------------------------------

/**
 * Average the biome palette colours for `biomes` into `out` (linear working
 * space — the palette Colors are constructed from sRGB hex, so blending here is
 * a correct linear mix). Pure; `biomes` may repeat (that just weights that
 * biome more). An empty list leaves `out` black.
 */
export function blendBiomeColors(biomes: Biome[], out: THREE.Color): THREE.Color {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const bi of biomes) {
    const c = BIOME_COLOR[bi];
    r += c.r;
    g += c.g;
    b += c.b;
  }
  const n = biomes.length || 1;
  out.setRGB(r / n, g / n, b / n);
  return out;
}

/**
 * Deterministic per-vertex lightness multiplier in [1 − jitter, 1 + jitter]
 * from a stable position hash (no Math.random → seam-safe, reproducible). Pure.
 */
export function vertexLightnessJitter(x: number, z: number): number {
  const h = hash2((WORLD_SEED ^ 0x7e57a11) >>> 0, Math.round(x), Math.round(z));
  return 1 + (h * 2 - 1) * ENV.vertexJitter;
}

/**
 * Vertex ambient-occlusion multiplier from height-grid concavity. `center` is
 * the vertex height, `avgNeighbor` the mean of its four ±STEP neighbours. When
 * the neighbourhood sits ABOVE the vertex (a valley / pit) the ground is
 * concave → DARKEN (toward `1 − aoDarken`); when it sits below (a ridge / bump,
 * convex) → gently LIGHTEN (toward `1 + aoLighten`). Flat ground (avg == center)
 * returns exactly 1. Pure & deterministic — same ±STEP taps on both sides of a
 * shared chunk edge, so it's seam-safe.
 */
export function vertexAO(center: number, avgNeighbor: number): number {
  const t = clamp((avgNeighbor - center) / ENV.aoScale, -1, 1);
  return t >= 0 ? 1 - t * ENV.aoDarken : 1 - t * ENV.aoLighten;
}

/**
 * Ground normal from four height samples one grid step (±step) either side of a
 * vertex — central differences on the height grid. Writes the unit normal into
 * `out[o..o+2]` and returns its Y component (`= 1` when flat, `< 1` on tilted
 * ground), which the colour path reuses as the slope factor. The chunk builder
 * feeds this from cached grid neighbours (no extra heightAt).
 */
function groundNormal(
  hL: number,
  hR: number,
  hD: number,
  hU: number,
  step: number,
  out: Float32Array | null,
  o: number,
): number {
  const nx = -(hR - hL) / (2 * step);
  const nz = -(hU - hD) / (2 * step);
  const inv = 1 / Math.hypot(nx, 1, nz);
  if (out) {
    out[o] = nx * inv;
    out[o + 1] = inv;
    out[o + 2] = nz * inv;
  }
  return inv;
}

/**
 * Full terrain colour from already-sampled inputs, written into `out`. Shore
 * sand below the waterline; otherwise the weighted `biomes` blend tinted toward
 * rock as `ny` (ground normal Y) tilts off vertical; then the concavity AO and
 * a micro lightness jitter finish both. Pure & position-only → seam-safe. This
 * is the single colour pipeline shared by the chunk-grid builder and the direct
 * reference below.
 */
function colorFromSamples(
  x: number,
  z: number,
  y: number,
  biomes: Biome[],
  ny: number,
  aoMul: number,
  out: THREE.Color,
): THREE.Color {
  if (y < ENV.sandHeight) {
    out.copy(SAND_COLOR);
  } else {
    blendBiomeColors(biomes, out);
    // Steep faces read as exposed rock: blend toward crag grey as the ground
    // normal tilts away from vertical (ny 1 → threshold gives 0 tint).
    if (ny < ENV.slopeRockThreshold) {
      const t =
        Math.min(1, (ENV.slopeRockThreshold - ny) / ENV.slopeRockThreshold) * ENV.slopeRockMax;
      out.lerp(ROCK_COLOR, t);
    }
  }
  out.multiplyScalar(vertexLightnessJitter(x, z) * aoMul);
  return out;
}

/**
 * Direct (per-vertex) terrain colour at world (x, z) with ground height `y`.
 * Samples the 5-tap biome blend (centre ±ENV.blendOffset), the slope normal and
 * the AO concavity (central differences ±STEP) itself, then defers to
 * `colorFromSamples`. Pure & seam-safe. The chunk builder does NOT call this per
 * vertex — it caches the same samples on a grid (see `sampleChunk`) — but this
 * remains the reference the grid path is regression-tested against (identical
 * taps → identical colour).
 */
export function terrainVertexColor(x: number, z: number, y: number, out: THREE.Color): THREE.Color {
  const o = ENV.blendOffset;
  const biomes: Biome[] = [
    biomeAt(x, z),
    biomeAt(x + o, z),
    biomeAt(x - o, z),
    biomeAt(x, z + o),
    biomeAt(x, z - o),
  ];
  const hL = heightAt(x - STEP, z);
  const hR = heightAt(x + STEP, z);
  const hD = heightAt(x, z - STEP);
  const hU = heightAt(x, z + STEP);
  const ny = groundNormal(hL, hR, hD, hU, STEP, null, 0);
  const aoMul = vertexAO(y, (hL + hR + hD + hU) * 0.25);
  return colorFromSamples(x, z, y, biomes, ny, aoMul, out);
}

// ---------------------------------------------------------------------------
// Chunk grid sampling. Done ONCE per grid point into height + biome arrays
// carrying an apron ring (so edge vertices still have the neighbours the biome
// blend + slope normal need), then every vertex colour/normal is assembled from
// array lookups — no per-vertex `biomeAt`/`heightAt` re-taps. Every grid coord
// is world-position-pure, so a vertex shared with an adjacent chunk samples the
// identical world coords → no seams, fully deterministic. The apron width
// scales with the grid step so the ±blendOffset biome taps always land in it.
// ---------------------------------------------------------------------------

// Scratch grids sized to the WORST case (near/1 m LOD: the largest apron + verts
// combination). Chunks are built one at a time (never reentrant), so a single
// shared height/biome grid avoids a per-chunk allocation + GC.
function apronFor(verts: number): number {
  return Math.max(1, Math.round(ENV.blendOffset / stepFor(verts)));
}
const MAX_GRID_DIM = CHUNKS.nearVerts + 2 * apronFor(CHUNKS.nearVerts);
const SCRATCH_H = new Float32Array(MAX_GRID_DIM * MAX_GRID_DIM);
const SCRATCH_B: Biome[] = new Array(MAX_GRID_DIM * MAX_GRID_DIM);

/**
 * Fill `positions` and `colors` (both length verts²·3) — and, when supplied,
 * per-vertex `normals` (same length) — for chunk (cx, cz) at the given grid
 * resolution (`verts` per edge; defaults to the far 2 m grid). Seam-safe &
 * deterministic; see the block comment above.
 */
export function sampleChunk(
  cx: number,
  cz: number,
  positions: Float32Array,
  colors: Float32Array,
  verts: number = CHUNKS.verts,
  normals: Float32Array | null = null,
): void {
  const n = verts;
  const step = stepFor(n);
  const blendSteps = Math.round(ENV.blendOffset / step);
  const P = Math.max(1, blendSteps); // apron rings (≥ 1, covering the ±1-step normal)
  const G = n + 2 * P; // grid dimension including the apron on both sides
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;

  // One heightAt + one biomeAt per grid point (apron included), cached.
  const hGrid = SCRATCH_H;
  const bGrid = SCRATCH_B;
  for (let gj = 0; gj < G; gj++) {
    const z = originZ + (gj - P) * step;
    for (let gi = 0; gi < G; gi++) {
      const x = originX + (gi - P) * step;
      const g = gj * G + gi;
      hGrid[g] = heightAt(x, z);
      bGrid[g] = biomeAt(x, z);
    }
  }

  const c = new THREE.Color();
  const biomes: Biome[] = ['meadow', 'meadow', 'meadow', 'meadow', 'meadow']; // scratch, reused
  for (let j = 0; j < n; j++) {
    const gj = j + P;
    const z = originZ + j * step;
    for (let i = 0; i < n; i++) {
      const gi = i + P;
      const x = originX + i * step;
      const g = gj * G + gi;
      // All grid indices below are in-bounds by construction (interior vertex +
      // ≤ P apron rings), so the non-null assertions on these reads are safe.
      const y = hGrid[g]!;
      const vidx = (j * n + i) * 3;

      positions[vidx] = x;
      positions[vidx + 1] = y;
      positions[vidx + 2] = z;

      // 5-tap biome blend: centre + neighbours ±blendSteps (== ±blendOffset m).
      biomes[0] = bGrid[g]!;
      biomes[1] = bGrid[g + blendSteps]!; // +x
      biomes[2] = bGrid[g - blendSteps]!; // -x
      biomes[3] = bGrid[g + blendSteps * G]!; // +z
      biomes[4] = bGrid[g - blendSteps * G]!; // -z

      const hL = hGrid[g - 1]!;
      const hR = hGrid[g + 1]!;
      const hD = hGrid[g - G]!;
      const hU = hGrid[g + G]!;
      // Slope normal Y from ±1-step (±step) grid neighbours — no extra heightAt.
      const ny = groundNormal(hL, hR, hD, hU, step, normals, vidx);
      const aoMul = vertexAO(y, (hL + hR + hD + hU) * 0.25);

      colorFromSamples(x, z, y, biomes, ny, aoMul, c);
      colors[vidx] = c.r;
      colors[vidx + 1] = c.g;
      colors[vidx + 2] = c.b;
    }
  }
}

// ---------------------------------------------------------------------------
// Near-LOD selection (pure). LOD_NEAR = 1 m grid, LOD_FAR = 2 m grid. Selection
// runs against the chunk-centre → player distance with hysteresis (promote near
// only inside `lodPromote`, demote back to far only past `lodDemote`) so a chunk
// sitting on the boundary doesn't rebuild every time the player jitters across
// it. When `nearLodEnabled` is off (the low preset) everything stays far.
// ---------------------------------------------------------------------------
export const LOD_NEAR = 0;
export const LOD_FAR = 1;

/** Grid resolution (verts per edge) for a LOD level. */
export function vertsForLod(lod: number): number {
  return lod === LOD_NEAR ? CHUNKS.nearVerts : CHUNKS.verts;
}

/** Resolve the LOD a chunk should hold given its distance + current LOD. Pure. */
export function selectChunkLod(dist: number, currentLod: number, nearLodEnabled: boolean): number {
  if (!nearLodEnabled) return LOD_FAR;
  if (currentLod === LOD_NEAR) return dist > CHUNKS.lodDemote ? LOD_FAR : LOD_NEAR;
  return dist < CHUNKS.lodPromote ? LOD_NEAR : LOD_FAR;
}

// ---------------------------------------------------------------------------
// Geometry (positions + colours + smooth normals + downward edge skirt). The
// skirt duplicates every perimeter (rim) vertex pushed straight down by
// CHUNKS.skirtDrop, skinned with a vertical wall carrying the rim's colour +
// normal, so a 1 m↔2 m LOD boundary's sub-metre height mismatch hides behind
// the skirt rather than showing a see-through T-junction. Pure builder →
// exported so the skirt geometry is unit-testable.
// ---------------------------------------------------------------------------
export function buildChunkGeometry(
  cx: number,
  cz: number,
  verts: number = CHUNKS.verts,
): THREE.BufferGeometry {
  const n = verts;
  const grid = n * n;
  const perim = 4 * (n - 1); // rim vertices around the border (one loop)
  const total = grid + perim;

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);

  // Interior grid (fills the first `grid` vertices; skirt fills the tail).
  sampleChunk(cx, cz, positions, colors, n, normals);

  // Perimeter loop of grid indices (top → right → bottom → left, closed).
  const rim = new Int32Array(perim);
  let rp = 0;
  for (let i = 0; i < n; i++) rim[rp++] = i; // top edge  (j = 0)
  for (let j = 1; j < n; j++) rim[rp++] = j * n + (n - 1); // right edge (i = n-1)
  for (let i = n - 2; i >= 0; i--) rim[rp++] = (n - 1) * n + i; // bottom edge (j = n-1)
  for (let j = n - 2; j >= 1; j--) rim[rp++] = j * n; // left edge  (i = 0)

  // Skirt vertices: each rim vertex duplicated, dropped, colour + normal copied.
  for (let k = 0; k < perim; k++) {
    const gk = rim[k]! * 3;
    const sk = (grid + k) * 3;
    positions[sk] = positions[gk]!;
    positions[sk + 1] = positions[gk + 1]! - CHUNKS.skirtDrop;
    positions[sk + 2] = positions[gk + 2]!;
    colors[sk] = colors[gk]!;
    colors[sk + 1] = colors[gk + 1]!;
    colors[sk + 2] = colors[gk + 2]!;
    normals[sk] = normals[gk]!;
    normals[sk + 1] = normals[gk + 1]!;
    normals[sk + 2] = normals[gk + 2]!;
  }

  // Indices: interior quads + skirt quads (2 triangles each).
  const quads = (n - 1) * (n - 1);
  const indices = new Uint32Array(quads * 6 + perim * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  // Skirt walls: rim[k] → rim[k+1] down to their dropped duplicates. Winding
  // (a, b, sa) + (b, sb, sa) faces outward from the chunk interior.
  for (let k = 0; k < perim; k++) {
    const a = rim[k]!;
    const b = rim[(k + 1) % perim]!;
    const sa = grid + k;
    const sb = grid + ((k + 1) % perim);
    indices[o++] = a;
    indices[o++] = b;
    indices[o++] = sa;
    indices[o++] = b;
    indices[o++] = sb;
    indices[o++] = sa;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Build a chunk's mesh at the given LOD. Positions are in world space. */
function buildChunkMesh(cx: number, cz: number, verts: number): THREE.Mesh {
  const geo = buildChunkGeometry(cx, cz, verts);
  // Smooth shading now (per-vertex normals off the height grid); the faceted
  // look is retained only for props/critters (deliberate stylistic contrast).
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `chunk ${chunkKey(cx, cz)}`;
  // Terrain receives (and softly casts) the perf-gated directional shadow.
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

interface LoadedChunk {
  mesh: THREE.Mesh;
  cx: number;
  cz: number;
  /** LOD_NEAR (1 m) or LOD_FAR (2 m) — the grid resolution this mesh was built at. */
  lod: number;
}

/** Streams terrain-mesh chunks around a moving player position. */
export class ChunkManager {
  private readonly scene: THREE.Scene;
  private readonly loaded = new Map<string, LoadedChunk>();
  /** Last player chunk coords the scan ran against (NaN until the first call). */
  private lastCx = NaN;
  private lastCz = NaN;
  /**
   * True once every in-radius chunk around `lastCx/lastCz` is resident with no
   * pending work. Used ONLY by the far-LOD (nearLod-off) fast path: while it
   * holds AND the player is still in the same chunk, `update()` early-returns.
   * When nearLod is on the scan always runs — intra-chunk motion shifts per-
   * chunk distances, so LOD reconciliation can't be skipped (the scan is cheap;
   * only actual rebuilds cost).
   */
  private complete = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Keep chunks within CHUNKS.radius of (playerX, playerZ) resident; dispose
   * the rest. Each resident chunk holds the LOD its distance dictates (with
   * hysteresis); a chunk whose required LOD changed REBUILDS. Builds + LOD
   * rebuilds together are capped at CHUNKS.buildsPerUpdate per call so a large
   * jump (or a wave of promotions) can't hitch a single frame.
   */
  update(playerX: number, playerZ: number): void {
    const pcx = Math.floor(playerX / CHUNKS.size);
    const pcz = Math.floor(playerZ / CHUNKS.size);
    const nearLod = qualityFlags().nearLod;
    // Steady state (far-LOD only): same chunk, nothing left to build → skip the
    // scan. With nearLod on we always reconcile (see `complete` docs).
    if (!nearLod && pcx === this.lastCx && pcz === this.lastCz && this.complete) return;
    this.lastCx = pcx;
    this.lastCz = pcz;
    const r = CHUNKS.radius;
    const half = CHUNKS.size / 2;

    // Dispose chunks that have fallen outside the keep radius.
    for (const [key, chunk] of this.loaded) {
      if (Math.abs(chunk.cx - pcx) > r || Math.abs(chunk.cz - pcz) > r) {
        this.disposeChunk(chunk);
        this.loaded.delete(key);
      }
    }

    // Build missing chunks + reconcile LODs nearest-first, capped per call.
    let budget = CHUNKS.buildsPerUpdate;
    for (let ring = 0; ring <= r && budget > 0; ring++) {
      for (let dz = -ring; dz <= ring && budget > 0; dz++) {
        for (let dx = -ring; dx <= ring && budget > 0; dx++) {
          // Only the outer shell of this ring (inner rings already handled).
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);
          const centerX = cx * CHUNKS.size + half;
          const centerZ = cz * CHUNKS.size + half;
          const dist = Math.hypot(centerX - playerX, centerZ - playerZ);
          const existing = this.loaded.get(key);
          const curLod = existing ? existing.lod : LOD_FAR;
          const lod = selectChunkLod(dist, curLod, nearLod);
          if (!existing) {
            const mesh = buildChunkMesh(cx, cz, vertsForLod(lod));
            this.scene.add(mesh);
            this.loaded.set(key, { mesh, cx, cz, lod });
            budget--;
          } else if (existing.lod !== lod) {
            // LOD changed — rebuild this chunk at the new resolution in place.
            this.disposeChunk(existing);
            const mesh = buildChunkMesh(cx, cz, vertsForLod(lod));
            this.scene.add(mesh);
            existing.mesh = mesh;
            existing.lod = lod;
            budget--;
          }
        }
      }
    }
    // Field is complete iff this pass finished every build/rebuild without
    // hitting the per-call cap (leftover budget → nothing more to do here).
    this.complete = budget > 0;
  }

  /** Dispose every resident chunk (teardown / scene reset). */
  dispose(): void {
    for (const chunk of this.loaded.values()) {
      this.disposeChunk(chunk);
    }
    this.loaded.clear();
    this.complete = false;
    this.lastCx = NaN;
    this.lastCz = NaN;
  }

  private disposeChunk(chunk: LoadedChunk): void {
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    (chunk.mesh.material as THREE.Material).dispose();
  }
}
