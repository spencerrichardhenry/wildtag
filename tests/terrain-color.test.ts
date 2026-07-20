import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNKS, ENV } from '../src/core/constants.ts';
import {
  blendBiomeColors,
  buildChunkGeometry,
  sampleChunk,
  terrainVertexColor,
  vertexAO,
  vertexLightnessJitter,
} from '../src/world/chunks.ts';

// ---------------------------------------------------------------------------
// Terrain vertex-colour pipeline (pure, position-only → seam-safe). Covers the
// weighted biome blend, bounded per-vertex jitter, and full-colour determinism.
// ---------------------------------------------------------------------------

const BIOME = {
  meadow: new THREE.Color(ENV.biomeColors.meadow),
  forest: new THREE.Color(ENV.biomeColors.forest),
};

describe('blendBiomeColors', () => {
  it('reproduces the palette colour for a single (repeated) biome', () => {
    const out = blendBiomeColors(['meadow', 'meadow', 'meadow'], new THREE.Color());
    expect(out.r).toBeCloseTo(BIOME.meadow.r, 6);
    expect(out.g).toBeCloseTo(BIOME.meadow.g, 6);
    expect(out.b).toBeCloseTo(BIOME.meadow.b, 6);
  });

  it('blends to the midpoint at a synthetic 50/50 border', () => {
    const out = blendBiomeColors(['meadow', 'forest'], new THREE.Color());
    // Each channel is the average of the two palette colours.
    expect(out.r).toBeCloseTo((BIOME.meadow.r + BIOME.forest.r) / 2, 6);
    expect(out.g).toBeCloseTo((BIOME.meadow.g + BIOME.forest.g) / 2, 6);
    expect(out.b).toBeCloseTo((BIOME.meadow.b + BIOME.forest.b) / 2, 6);
  });

  it('lands strictly between the two colours at a 3:1 border (weighted)', () => {
    const out = blendBiomeColors(['meadow', 'meadow', 'meadow', 'forest'], new THREE.Color());
    const lo = Math.min(BIOME.meadow.g, BIOME.forest.g);
    const hi = Math.max(BIOME.meadow.g, BIOME.forest.g);
    expect(out.g).toBeGreaterThan(lo);
    expect(out.g).toBeLessThan(hi);
    // Weighted 3:1 toward meadow → closer to the meadow channel.
    expect(Math.abs(out.g - BIOME.meadow.g)).toBeLessThan(Math.abs(out.g - BIOME.forest.g));
  });
});

describe('vertexLightnessJitter', () => {
  it('is bounded to [1 - jitter, 1 + jitter] across a grid', () => {
    for (let x = -200; x <= 200; x += 7) {
      for (let z = -200; z <= 200; z += 11) {
        const j = vertexLightnessJitter(x, z);
        expect(j).toBeGreaterThanOrEqual(1 - ENV.vertexJitter - 1e-9);
        expect(j).toBeLessThanOrEqual(1 + ENV.vertexJitter + 1e-9);
      }
    }
  });

  it('is deterministic for the same position and varies across positions', () => {
    expect(vertexLightnessJitter(12, -34)).toBe(vertexLightnessJitter(12, -34));
    // Two generic points are extremely unlikely to collide.
    expect(vertexLightnessJitter(12, -34)).not.toBe(vertexLightnessJitter(13, -34));
  });
});

describe('terrainVertexColor', () => {
  it('is deterministic (position-pure → seam-safe)', () => {
    const a = terrainVertexColor(128, -64, 20, new THREE.Color());
    const b = terrainVertexColor(128, -64, 20, new THREE.Color());
    expect(a.getHex()).toBe(b.getHex());
  });

  it('uses the shore-sand tint below the sand height', () => {
    // Below the sand band, the colour is the (jittered, AO-shaded) sand tone —
    // much warmer (higher red) than any green biome; assert it sits near sand,
    // not meadow. The band widens for the per-vertex jitter AND the concavity AO
    // (valleys darken up to aoDarken, ridges lighten up to aoLighten).
    const sand = new THREE.Color(ENV.biomeColors.sand);
    const meadow = new THREE.Color(ENV.biomeColors.meadow);
    const out = terrainVertexColor(300, 300, ENV.sandHeight - 0.5, new THREE.Color());
    expect(out.r).toBeGreaterThan(sand.r * (1 - ENV.vertexJitter) * (1 - ENV.aoDarken) - 1e-6);
    expect(out.r).toBeLessThan(sand.r * (1 + ENV.vertexJitter) * (1 + ENV.aoLighten) + 1e-6);
    // Unambiguously sand, not a green biome: sand red far exceeds meadow red.
    expect(out.r).toBeGreaterThan(meadow.r);
  });

  it('produces a positive, in-gamut colour on open ground', () => {
    const out = terrainVertexColor(50, 50, 8, new THREE.Color());
    for (const ch of [out.r, out.g, out.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(1.5); // jitter can nudge just past 1 in linear
    }
  });
});

describe('vertexAO (concavity darkening)', () => {
  it('has no effect on flat ground (avg neighbour == vertex height)', () => {
    expect(vertexAO(10, 10)).toBeCloseTo(1, 12);
    expect(vertexAO(-3.2, -3.2)).toBeCloseTo(1, 12);
  });

  it('darkens a concavity (a pit — neighbours sit above the vertex)', () => {
    // Vertex 2 m below its surroundings → concave → multiplier < 1.
    const m = vertexAO(0, 2);
    expect(m).toBeLessThan(1);
    // Bounded by the max darken.
    expect(m).toBeGreaterThanOrEqual(1 - ENV.aoDarken - 1e-9);
    // A deeper pit is at least as dark, saturating at 1 − aoDarken.
    expect(vertexAO(0, 50)).toBeCloseTo(1 - ENV.aoDarken, 12);
    expect(vertexAO(0, 50)).toBeLessThanOrEqual(m + 1e-9);
  });

  it('lightens a convexity (a ridge — neighbours sit below the vertex)', () => {
    const m = vertexAO(2, 0);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThanOrEqual(1 + ENV.aoLighten + 1e-9);
    expect(vertexAO(50, 0)).toBeCloseTo(1 + ENV.aoLighten, 12);
  });

  it('is deterministic (pure)', () => {
    expect(vertexAO(1.5, 3.7)).toBe(vertexAO(1.5, 3.7));
  });
});

describe('buildChunkGeometry — edge skirt', () => {
  it('appends a dropped skirt ring below the perimeter rim, with copied normals', () => {
    const n = CHUNKS.verts;
    const grid = n * n;
    const perim = 4 * (n - 1);
    const geo = buildChunkGeometry(3, -2, n);

    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    // Interior grid + one skirt vertex per perimeter (rim) vertex.
    expect(pos.count).toBe(grid + perim);
    expect(nrm.count).toBe(pos.count);

    // The first rim vertex is grid corner (0,0) → grid index 0; its skirt copy
    // is the first appended vertex (index `grid`): same XZ, dropped Y, same normal.
    const rimGridIdx = 0;
    const skirtIdx = grid;
    expect(pos.getX(skirtIdx)).toBeCloseTo(pos.getX(rimGridIdx), 6);
    expect(pos.getZ(skirtIdx)).toBeCloseTo(pos.getZ(rimGridIdx), 6);
    expect(pos.getY(skirtIdx)).toBeCloseTo(pos.getY(rimGridIdx) - CHUNKS.skirtDrop, 6);
    // Skirt normal copied from the rim (so the wall shades like the edge).
    expect(nrm.getX(skirtIdx)).toBeCloseTo(nrm.getX(rimGridIdx), 6);
    expect(nrm.getY(skirtIdx)).toBeCloseTo(nrm.getY(rimGridIdx), 6);
    expect(nrm.getZ(skirtIdx)).toBeCloseTo(nrm.getZ(rimGridIdx), 6);

    // Reconstruct the perimeter rim order (top → right → bottom → left) and
    // assert every skirt vertex is exactly its rim vertex dropped by skirtDrop.
    const rim: number[] = [];
    for (let i = 0; i < n; i++) rim.push(i);
    for (let j = 1; j < n; j++) rim.push(j * n + (n - 1));
    for (let i = n - 2; i >= 0; i--) rim.push((n - 1) * n + i);
    for (let j = n - 2; j >= 1; j--) rim.push(j * n);
    expect(rim.length).toBe(perim);
    for (let k = 0; k < perim; k++) {
      const si = grid + k;
      const gi = rim[k]!;
      expect(pos.getX(si)).toBeCloseTo(pos.getX(gi), 6);
      expect(pos.getZ(si)).toBeCloseTo(pos.getZ(gi), 6);
      expect(pos.getY(si)).toBeCloseTo(pos.getY(gi) - CHUNKS.skirtDrop, 6);
    }
  });

  it('near (1 m) grid has 4× the interior quads of the far (2 m) grid', () => {
    const far = buildChunkGeometry(0, 0, CHUNKS.verts);
    const near = buildChunkGeometry(0, 0, CHUNKS.nearVerts);
    const farQuads = (CHUNKS.verts - 1) * (CHUNKS.verts - 1);
    const nearQuads = (CHUNKS.nearVerts - 1) * (CHUNKS.nearVerts - 1);
    expect(nearQuads).toBe(farQuads * 4); // 64² == 4 × 32²
    // Index buffers reflect that (interior quads + skirt, ×6 indices per quad).
    const farIdx = far.getIndex()!.count;
    const nearIdx = near.getIndex()!.count;
    expect(nearIdx).toBeGreaterThan(farIdx);
  });

  it('is seam-safe across a LOD-agnostic shared edge at the 2 m grid', () => {
    // The far-grid geometry's shared column must still match its neighbour
    // (skirts don't disturb the interior grid vertices).
    const n = CHUNKS.verts;
    const a = buildChunkGeometry(3, -2, n).getAttribute('position');
    const b = buildChunkGeometry(4, -2, n).getAttribute('position');
    for (let j = 0; j < n; j++) {
      const ai = j * n + (n - 1);
      const bi = j * n + 0;
      expect(a.getX(ai)).toBeCloseTo(b.getX(bi), 6);
      expect(a.getY(ai)).toBeCloseTo(b.getY(bi), 6);
      expect(a.getZ(ai)).toBeCloseTo(b.getZ(bi), 6);
    }
  });
});

describe('sampleChunk grid path === direct terrainVertexColor path', () => {
  // The chunk builder caches heightAt/biomeAt once per grid point (with an
  // apron) and assembles each vertex colour from array lookups. That must
  // reproduce the direct per-vertex reference bit-for-bit: identical ±blendOffset
  // biome taps and identical ±STEP central-difference slope normal.
  const n = CHUNKS.verts;
  const STEP = CHUNKS.size / (n - 1);

  it('matches the direct path at probe vertices (interior, edges, corners)', () => {
    // A chunk offset off-origin so probes span biome borders + varied slope.
    const cx = 3;
    const cz = -2;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    sampleChunk(cx, cz, positions, colors);

    const probes: Array<[number, number]> = [
      [0, 0], // corner (max apron reach)
      [n - 1, n - 1], // opposite corner
      [0, n - 1],
      [n - 1, 0],
      [n >> 1, n >> 1], // centre
      [5, 20], // arbitrary interior
    ];
    const ref = new THREE.Color();
    for (const [i, j] of probes) {
      const vidx = (j * n + i) * 3;
      const x = positions[vidx];
      const y = positions[vidx + 1];
      const z = positions[vidx + 2];
      // Sanity: grid coords are world-position-pure.
      expect(x).toBeCloseTo(cx * CHUNKS.size + i * STEP, 6);
      expect(z).toBeCloseTo(cz * CHUNKS.size + j * STEP, 6);

      terrainVertexColor(x, z, y, ref);
      const grid = new THREE.Color(colors[vidx], colors[vidx + 1], colors[vidx + 2]);
      expect(grid.getHex()).toBe(ref.getHex());
    }
  });

  it('is seam-safe: a vertex shared with the neighbour chunk gets the same colour', () => {
    // Chunk (cx,cz) right edge (i = n-1) shares its world column with chunk
    // (cx+1,cz) left edge (i = 0). World-pure sampling → identical colours.
    const cx = 3;
    const cz = -2;
    const a = { p: new Float32Array(n * n * 3), c: new Float32Array(n * n * 3) };
    const b = { p: new Float32Array(n * n * 3), c: new Float32Array(n * n * 3) };
    sampleChunk(cx, cz, a.p, a.c);
    sampleChunk(cx + 1, cz, b.p, b.c);
    for (let j = 0; j < n; j++) {
      const ai = (j * n + (n - 1)) * 3;
      const bi = (j * n + 0) * 3;
      expect(a.p[ai]).toBeCloseTo(b.p[bi], 6); // same world x
      expect(a.p[ai + 2]).toBeCloseTo(b.p[bi + 2], 6); // same world z
      expect(a.c[ai]).toBe(b.c[bi]);
      expect(a.c[ai + 1]).toBe(b.c[bi + 1]);
      expect(a.c[ai + 2]).toBe(b.c[bi + 2]);
    }
  });
});
