import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENV } from '../src/core/constants.ts';
import { blendBiomeColors, terrainVertexColor, vertexLightnessJitter } from '../src/world/chunks.ts';

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
    // Below the sand band, the colour is the (jittered) sand tone — much warmer
    // (higher red) than any green biome; assert it sits near sand, not meadow.
    const sand = new THREE.Color(ENV.biomeColors.sand);
    const out = terrainVertexColor(300, 300, ENV.sandHeight - 0.5, new THREE.Color());
    // Within the jitter band of the sand colour on the red channel.
    expect(out.r).toBeGreaterThan(sand.r * (1 - ENV.vertexJitter) - 1e-6);
    expect(out.r).toBeLessThan(sand.r * (1 + ENV.vertexJitter) + 1e-6);
  });

  it('produces a positive, in-gamut colour on open ground', () => {
    const out = terrainVertexColor(50, 50, 8, new THREE.Color());
    for (const ch of [out.r, out.g, out.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(1.5); // jitter can nudge just past 1 in linear
    }
  });
});
