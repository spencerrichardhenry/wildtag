import * as THREE from 'three';
import { CHUNKS, ENV, WORLD_SEED } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
import { hash2 } from '../core/rng.ts';
import { heightAt, biomeAt, groundNormalAt } from './terrain.ts';

// ---------------------------------------------------------------------------
// Streaming terrain mesh. The world is tiled into CHUNKS.size-metre squares;
// each chunk is a CHUNKS.verts×CHUNKS.verts vertex grid sampled from `heightAt`
// (positions in world coordinates, so neighbouring chunks share edge samples
// exactly → no seams). Vertices are coloured per biome, with a shore-sand tint
// below ENV.sandHeight. Chunks within CHUNKS.radius chunks of the player are
// kept resident; the rest are disposed (geometry freed, no leaks).
// ---------------------------------------------------------------------------

const STEP = CHUNKS.size / (CHUNKS.verts - 1); // metres between grid samples

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
 * Full terrain colour at world (x, z) with ground height `y`, written into
 * `out`. Shore sand below the waterline; otherwise a 4-tap (±ENV.blendOffset)
 * biome border blend tinted toward rock on steep slopes; a micro lightness
 * jitter finishes both. Pure & position-only (seam-safe). `groundNormalAt` and
 * `biomeAt` are the same fields the mesh/collision/AI share, so nothing drifts.
 */
export function terrainVertexColor(x: number, z: number, y: number, out: THREE.Color): THREE.Color {
  if (y < ENV.sandHeight) {
    out.copy(SAND_COLOR);
  } else {
    const o = ENV.blendOffset;
    blendBiomeColors(
      [
        biomeAt(x, z),
        biomeAt(x + o, z),
        biomeAt(x - o, z),
        biomeAt(x, z + o),
        biomeAt(x, z - o),
      ],
      out,
    );
    // Steep faces read as exposed rock: blend toward crag grey as the ground
    // normal tilts away from vertical (ny 1 → threshold gives 0 tint).
    const ny = groundNormalAt(x, z).y;
    if (ny < ENV.slopeRockThreshold) {
      const t =
        Math.min(1, (ENV.slopeRockThreshold - ny) / ENV.slopeRockThreshold) * ENV.slopeRockMax;
      out.lerp(ROCK_COLOR, t);
    }
  }
  out.multiplyScalar(vertexLightnessJitter(x, z));
  return out;
}

/** Build a chunk's mesh. Positions are in world space; mesh sits at origin. */
function buildChunkMesh(cx: number, cz: number): THREE.Mesh {
  const n = CHUNKS.verts;
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;

  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const c = new THREE.Color(); // scratch, reused per vertex (no per-vertex alloc)

  for (let j = 0; j < n; j++) {
    const z = originZ + j * STEP;
    for (let i = 0; i < n; i++) {
      const x = originX + i * STEP;
      const y = heightAt(x, z);
      const idx = (j * n + i) * 3;

      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // Blended biome colour + slope rock tint + micro jitter (seam-safe).
      terrainVertexColor(x, z, y, c);
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;
    }
  }

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Keep chunks within CHUNKS.radius of (playerX, playerZ) resident; dispose
   * the rest. Builds at most CHUNKS.buildsPerUpdate meshes per call so a large
   * jump can't hitch a single frame (remaining chunks fill in over subsequent
   * calls).
   */
  update(playerX: number, playerZ: number): void {
    const pcx = Math.floor(playerX / CHUNKS.size);
    const pcz = Math.floor(playerZ / CHUNKS.size);
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
  }

  /** Dispose every resident chunk (teardown / scene reset). */
  dispose(): void {
    for (const chunk of this.loaded.values()) {
      this.disposeChunk(chunk);
    }
    this.loaded.clear();
  }

  private disposeChunk(chunk: LoadedChunk): void {
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    (chunk.mesh.material as THREE.Material).dispose();
  }
}
