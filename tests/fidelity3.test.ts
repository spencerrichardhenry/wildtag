import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planShadows } from '../src/world/lighting.ts';
import {
  terrainDetailFactor,
  COARSE_AMP,
  FINE_AMP,
} from '../src/world/terrainDetail.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../src/core/materials.ts';
import { QUALITY, setQuality, _resetQualityForTest } from '../src/core/quality.ts';
import { ENV } from '../src/core/constants.ts';

// ---------------------------------------------------------------------------
// Fidelity-2 P3 pure-logic suite: cascade split math, terrain detail-noise
// determinism/bounds, and the quality-gated material choice + flag wiring.
// ---------------------------------------------------------------------------

describe('planShadows (cascade split math)', () => {
  it('low / cascades 0 → no cascades', () => {
    expect(planShadows(0, 0).cascades).toBe(0);
    expect(planShadows(0, 2048).specs).toEqual([]);
    // A zero shadowRes also disables (defensive).
    expect(planShadows(2, 0).cascades).toBe(0);
  });

  it('medium → one ~80 m cascade carrying the whole sun', () => {
    const plan = planShadows(1, 1024);
    expect(plan.cascades).toBe(1);
    expect(plan.specs).toHaveLength(1);
    expect(plan.specs[0]!.half).toBe(40); // 2 × 40 = 80 m coverage
    expect(plan.specs[0]!.res).toBe(1024);
    expect(plan.specs[0]!.intensityShare).toBe(1);
  });

  it('high → near(~40 m sharp) + far(~160 m soft), shares sum to 1', () => {
    const plan = planShadows(2, 2048);
    expect(plan.cascades).toBe(2);
    expect(plan.specs).toHaveLength(2);
    const [far, near] = plan.specs;
    expect(far!.half).toBe(80); // 160 m far cascade
    expect(near!.half).toBe(20); // 40 m near cascade
    expect(far!.res).toBe(2048);
    expect(near!.res).toBe(2048);
    // Intensity shares sum to 1 so total sun brightness is preset-independent.
    expect(far!.intensityShare + near!.intensityShare).toBeCloseTo(1, 6);
    // Near cascade is the sharper (tighter) one.
    expect(near!.half).toBeLessThan(far!.half);
    // Each cascade's far plane clears the light standoff distance.
    for (const s of plan.specs) expect(s.far).toBeGreaterThan(ENV.shadowLightDist);
  });
});

describe('terrainDetailFactor (detail noise)', () => {
  it('is deterministic for a given (x, z, high)', () => {
    for (const [x, z] of [[0, 0], [12.3, -4.7], [1000.5, 88.2]] as const) {
      expect(terrainDetailFactor(x, z, false)).toBe(terrainDetailFactor(x, z, false));
      expect(terrainDetailFactor(x, z, true)).toBe(terrainDetailFactor(x, z, true));
    }
  });

  it('coarse-only stays within ±COARSE_AMP of 1', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i * 13.37) % 617;
      const z = (i * 7.91) % 421;
      const f = terrainDetailFactor(x, z, false);
      expect(f).toBeGreaterThanOrEqual(1 - COARSE_AMP - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + COARSE_AMP + 1e-9);
    }
  });

  it('high adds the fine octave (wider band, still bounded)', () => {
    const bound = COARSE_AMP + FINE_AMP;
    for (let i = 0; i < 500; i++) {
      const x = (i * 4.2) % 300;
      const z = (i * 9.6) % 300;
      const f = terrainDetailFactor(x, z, true);
      expect(f).toBeGreaterThanOrEqual(1 - bound - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + bound + 1e-9);
    }
  });

  it('actually varies across space (not a constant)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(terrainDetailFactor(i * 1.5, 0, false));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('quality flag wiring (P3)', () => {
  it('standardMaterials off on low, on for medium+; terrainDetailHigh only high', () => {
    expect(QUALITY.low.standardMaterials).toBe(false);
    expect(QUALITY.medium.standardMaterials).toBe(true);
    expect(QUALITY.high.standardMaterials).toBe(true);
    expect(QUALITY.low.terrainDetailHigh).toBe(false);
    expect(QUALITY.medium.terrainDetailHigh).toBe(false);
    expect(QUALITY.high.terrainDetailHigh).toBe(true);
    // terrainDetailShader (coarse) rides medium+ (unchanged from P2 wiring).
    expect(QUALITY.low.terrainDetailShader).toBe(false);
    expect(QUALITY.medium.terrainDetailShader).toBe(true);
  });
});

describe('makeSurfaceMaterial (quality-gated Lambert↔Standard)', () => {
  afterEach(() => _resetQualityForTest());

  it('low → flat-shaded Lambert (floor look preserved)', () => {
    setQuality('low', false);
    const m = makeSurfaceMaterial({ color: 0x808080, flatShading: true, roughness: ROUGHNESS.rock });
    expect(m).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(m.flatShading).toBe(true);
    // Roughness is a no-op on the Lambert floor (property absent).
    expect((m as THREE.MeshStandardMaterial).roughness).toBeUndefined();
  });

  it('medium+ → Standard with the requested roughness', () => {
    setQuality('high', false);
    const m = makeSurfaceMaterial({ color: 0x808080, roughness: ROUGHNESS.crystal });
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((m as THREE.MeshStandardMaterial).roughness).toBeCloseTo(ROUGHNESS.crystal, 6);
    expect((m as THREE.MeshStandardMaterial).metalness).toBe(0);
  });

  it('carries emissive, opacity, vertexColors + flatShading across both paths', () => {
    for (const q of ['low', 'high'] as const) {
      setQuality(q, false);
      const m = makeSurfaceMaterial({
        vertexColors: true,
        flatShading: true,
        emissive: 0x9be8ff,
        emissiveIntensity: 1.4,
        opacity: 0.8,
      });
      expect(m.vertexColors).toBe(true);
      expect(m.flatShading).toBe(true);
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeCloseTo(0.8, 6);
      const em = (m as THREE.MeshStandardMaterial).emissive;
      expect(em.getHex()).toBe(0x9be8ff);
      expect((m as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(1.4, 6);
    }
  });
});
