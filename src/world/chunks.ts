import * as THREE from 'three';
import { CHUNKS, ENV } from '../core/constants.ts';
import type { Biome } from '../core/types.ts';
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

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Build a chunk's mesh. Positions are in world space; mesh sits at origin. */
function buildChunkMesh(cx: number, cz: number): THREE.Mesh {
  const n = CHUNKS.verts;
  const originX = cx * CHUNKS.size;
  const originZ = cz * CHUNKS.size;

  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);

  for (let j = 0; j < n; j++) {
    const z = originZ + j * STEP;
    for (let i = 0; i < n; i++) {
      const x = originX + i * STEP;
      const y = heightAt(x, z);
      const idx = (j * n + i) * 3;

      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // Shore sand below the waterline band, otherwise the biome palette.
      const c = y < ENV.sandHeight ? SAND_COLOR : BIOME_COLOR[biomeAt(x, z)];
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
