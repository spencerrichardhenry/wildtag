import * as THREE from 'three';
import { CHUNKS, ENV, WORLD_SEED } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
import { hash2 } from '../core/rng.ts';
import { heightAt, biomeAt } from './terrain.ts';

// ---------------------------------------------------------------------------
// Streaming terrain mesh. The world is tiled into CHUNKS.size-metre squares;
// each chunk is a CHUNKS.verts×CHUNKS.verts vertex grid sampled from `heightAt`
// (positions in world coordinates, so neighbouring chunks share edge samples
// exactly → no seams). Vertices are coloured per biome, with a shore-sand tint
// below ENV.sandHeight. Chunks within CHUNKS.radius chunks of the player are
// kept resident; the rest are disposed (geometry freed, no leaks).
// ---------------------------------------------------------------------------

const STEP = CHUNKS.size / (CHUNKS.verts - 1); // metres between grid samples
// Biome-blend offset expressed in grid steps (ENV.blendOffset = 6 m, STEP = 2 m
// → 3 steps). Sampling grid neighbours this many steps out lands on exactly the
// same ±blendOffset world coords the old per-vertex path tapped, so the border
// blend is byte-identical while costing zero extra biomeAt calls.
const BLEND_STEPS = Math.round(ENV.blendOffset / STEP);

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

// ---------------------------------------------------------------------------
// Terrain vertex colour (pure, position-only → seam-safe: neighbouring chunks
// share edge samples and every input below is a function of world (x, z), so a
// shared vertex resolves to the identical colour on both sides). Three effects
// layer on the flat biome palette: (1) a weighted BLEND across the biomes
// sampled around the vertex so borders fade instead of snapping; (2) a slope-
// based tint toward crag rock on steep faces; (3) a deterministic per-vertex
// micro lightness jitter so large patches never read as flat paint. The shore
// sand band (below ENV.sandHeight) overrides the biome blend but still jitters.
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
 * Normalised ground-normal Y from four height samples taken one grid step
 * (±STEP) either side of a vertex — central differences on the height grid.
 * `y1 < 1` on tilted ground, `= 1` when flat. The chunk builder feeds this from
 * cached grid neighbours (no extra heightAt); `terrainVertexColor` samples them
 * directly. Both paths use the SAME ±STEP span, so they agree exactly.
 */
function slopeNormalY(hL: number, hR: number, hD: number, hU: number): number {
  const nx = -(hR - hL) / (2 * STEP);
  const nz = -(hU - hD) / (2 * STEP);
  return 1 / Math.hypot(nx, 1, nz);
}

/**
 * Full terrain colour from already-sampled inputs, written into `out`. Shore
 * sand below the waterline; otherwise the weighted `biomes` blend tinted toward
 * rock as `ny` (ground normal Y) tilts off vertical; a micro lightness jitter
 * finishes both. Pure & position-only → seam-safe. This is the single colour
 * pipeline shared by the chunk-grid builder and the direct reference below.
 */
function colorFromSamples(
  x: number,
  z: number,
  y: number,
  biomes: Biome[],
  ny: number,
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
  out.multiplyScalar(vertexLightnessJitter(x, z));
  return out;
}

/**
 * Direct (per-vertex) terrain colour at world (x, z) with ground height `y`.
 * Samples the 5-tap biome blend (centre ±ENV.blendOffset) and the slope normal
 * (central differences ±STEP) itself, then defers to `colorFromSamples`. Pure &
 * seam-safe. The chunk builder does NOT call this per vertex — it caches the
 * same samples on a grid (see `sampleChunk`) — but this remains the reference
 * the grid path is regression-tested against (identical taps → identical
 * colour).
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
  const ny = slopeNormalY(
    heightAt(x - STEP, z),
    heightAt(x + STEP, z),
    heightAt(x, z - STEP),
    heightAt(x, z + STEP),
  );
  return colorFromSamples(x, z, y, biomes, ny, out);
}

/**
 * Fill `positions` and `colors` (both length verts²·3) for chunk (cx, cz).
 *
 * Sampling is done ONCE per grid point into height + biome arrays carrying a
 * BLEND_STEPS-wide apron ring (so edge vertices still have the neighbours the
 * biome blend and slope normal need), then every vertex colour is assembled
 * from array lookups — no per-vertex `biomeAt`/`groundNormalAt` re-taps. Every
 * grid coord is world-position-pure (`originX + (gi - P)·STEP` etc.), so a
 * vertex shared with an adjacent chunk samples the identical world coords and
 * resolves to the identical height/colour → no seams, fully deterministic.
 */
// Apron geometry, fixed by the constants: P rings on each side (≥ 1 so the
// ±1-step slope normal always has neighbours), G = grid dim including apron.
const APRON = Math.max(1, BLEND_STEPS);
const GRID_DIM = CHUNKS.verts + 2 * APRON;
// Reusable sampling scratch — chunks are built one at a time (never reentrant),
// so a single shared height/biome grid avoids a per-chunk allocation + GC.
const SCRATCH_H = new Float32Array(GRID_DIM * GRID_DIM);
const SCRATCH_B: Biome[] = new Array(GRID_DIM * GRID_DIM);

export function sampleChunk(
  cx: number,
  cz: number,
  positions: Float32Array,
  colors: Float32Array,
): void {
  const n = CHUNKS.verts;
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;
  const P = APRON; // apron rings (also ≥ 1, covering the ±1-step normal)
  const G = GRID_DIM; // grid dimension including the apron on both sides

  // One heightAt + one biomeAt per grid point (apron included), cached.
  const hGrid = SCRATCH_H;
  const bGrid = SCRATCH_B;
  for (let gj = 0; gj < G; gj++) {
    const z = originZ + (gj - P) * STEP;
    for (let gi = 0; gi < G; gi++) {
      const x = originX + (gi - P) * STEP;
      const g = gj * G + gi;
      hGrid[g] = heightAt(x, z);
      bGrid[g] = biomeAt(x, z);
    }
  }

  const c = new THREE.Color();
  const biomes: Biome[] = ['meadow', 'meadow', 'meadow', 'meadow', 'meadow']; // scratch, reused
  for (let j = 0; j < n; j++) {
    const gj = j + P;
    const z = originZ + j * STEP;
    for (let i = 0; i < n; i++) {
      const gi = i + P;
      const x = originX + i * STEP;
      const g = gj * G + gi;
      // All grid indices below are in-bounds by construction (interior vertex +
      // ≤ APRON rings), so the non-null assertions on these reads are safe.
      const y = hGrid[g]!;
      const vidx = (j * n + i) * 3;

      positions[vidx] = x;
      positions[vidx + 1] = y;
      positions[vidx + 2] = z;

      // 5-tap biome blend: centre + neighbours ±BLEND_STEPS (== ±blendOffset m).
      biomes[0] = bGrid[g]!;
      biomes[1] = bGrid[g + BLEND_STEPS]!; // +x
      biomes[2] = bGrid[g - BLEND_STEPS]!; // -x
      biomes[3] = bGrid[g + BLEND_STEPS * G]!; // +z
      biomes[4] = bGrid[g - BLEND_STEPS * G]!; // -z
      // Slope normal Y from ±1-step (±STEP) grid neighbours — no extra heightAt.
      const ny = slopeNormalY(hGrid[g - 1]!, hGrid[g + 1]!, hGrid[g - G]!, hGrid[g + G]!);

      colorFromSamples(x, z, y, biomes, ny, c);
      colors[vidx] = c.r;
      colors[vidx + 1] = c.g;
      colors[vidx + 2] = c.b;
    }
  }
}

/** Build a chunk's mesh. Positions are in world space; mesh sits at origin. */
function buildChunkMesh(cx: number, cz: number): THREE.Mesh {
  const n = CHUNKS.verts;

  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);

  // Positions + blended/tinted/jittered vertex colours, sampled once per grid
  // point with an apron (seam-safe; see sampleChunk).
  sampleChunk(cx, cz, positions, colors);

  // Two triangles per quad; (n-1)² quads.
  const quads = (n - 1) * (n - 1);
  const indices = new Uint32Array(quads * 6);
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

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  // flatShading derives normals from position derivatives in-shader, giving a
  // faceted look that makes biome patches read clearly.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
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
}

/** Streams terrain-mesh chunks around a moving player position. */
export class ChunkManager {
  private readonly scene: THREE.Scene;
  private readonly loaded = new Map<string, LoadedChunk>();
  /** Last player chunk coords the scan ran against (NaN until the first call). */
  private lastCx = NaN;
  private lastCz = NaN;
  /**
   * True once every in-radius chunk around `lastCx/lastCz` is resident (a build
   * pass finished with budget to spare). While it holds AND the player is still
   * in the same chunk, `update()` early-returns — skipping the whole ring scan.
   */
  private complete = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Keep chunks within CHUNKS.radius of (playerX, playerZ) resident; dispose
   * the rest. Builds at most CHUNKS.buildsPerUpdate meshes per call so a large
   * jump can't hitch a single frame (remaining chunks fill in over subsequent
   * calls). When the player hasn't crossed a chunk boundary and the field is
   * already fully built, the scan is skipped entirely (steady-state fast path).
   */
  update(playerX: number, playerZ: number): void {
    const pcx = Math.floor(playerX / CHUNKS.size);
    const pcz = Math.floor(playerZ / CHUNKS.size);
    // Steady state: same chunk, nothing left to build — nothing to scan.
    if (pcx === this.lastCx && pcz === this.lastCz && this.complete) return;
    this.lastCx = pcx;
    this.lastCz = pcz;
    const r = CHUNKS.radius;

    // Dispose chunks that have fallen outside the keep radius.
    for (const [key, chunk] of this.loaded) {
      if (Math.abs(chunk.cx - pcx) > r || Math.abs(chunk.cz - pcz) > r) {
        this.disposeChunk(chunk);
        this.loaded.delete(key);
      }
    }

    // Build missing chunks nearest-first, capped per call.
    let budget = CHUNKS.buildsPerUpdate;
    for (let ring = 0; ring <= r && budget > 0; ring++) {
      for (let dz = -ring; dz <= ring && budget > 0; dz++) {
        for (let dx = -ring; dx <= ring && budget > 0; dx++) {
          // Only the outer shell of this ring (inner rings already handled).
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (this.loaded.has(key)) continue;
          const mesh = buildChunkMesh(cx, cz);
          this.scene.add(mesh);
          this.loaded.set(key, { mesh, cx, cz });
          budget--;
        }
      }
    }
    // Field is complete iff this pass built every missing chunk without hitting
    // the per-call cap (leftover budget → nothing more to build this position).
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
