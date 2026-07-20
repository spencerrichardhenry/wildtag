import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  QUALITY,
  QUALITY_IDS,
  detectQuality,
  isSoftwareRenderer,
  loadStoredQuality,
  parseQualityOverride,
  tierBelow,
  type QualityId,
} from '../src/core/quality.ts';

// A fake WebGLRenderer exposing just the WEBGL_debug_renderer_info path that
// isSoftwareRenderer / detectQuality read. `name` is the unmasked GL renderer.
function fakeRenderer(name: string): THREE.WebGLRenderer {
  const gl = {
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
    getParameter: () => name,
  };
  return { getContext: () => gl } as unknown as THREE.WebGLRenderer;
}

/** A minimal in-memory Storage for the localStorage-backed persistence. */
function memStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('QUALITY preset table', () => {
  it('defines all three presets with the expected P1-live flags', () => {
    expect(QUALITY_IDS).toEqual(['low', 'medium', 'high']);
    // Shadow cascades ladder 0/1/2 and grass multiplier 1/4/8 are the spec's.
    expect(QUALITY.low.shadowCascades).toBe(0);
    expect(QUALITY.medium.shadowCascades).toBe(1);
    expect(QUALITY.high.shadowCascades).toBe(2);
    expect(QUALITY.low.grassMultiplier).toBe(1);
    expect(QUALITY.medium.grassMultiplier).toBe(4);
    expect(QUALITY.high.grassMultiplier).toBe(8);
    // Low is the floor: no shadows / no post / no near-LOD.
    expect(QUALITY.low.shadowRes).toBe(0);
    expect(QUALITY.low.ssao).toBe(false);
    expect(QUALITY.low.bloom).toBe(false);
    expect(QUALITY.low.nearLod).toBe(false);
    // High widens the grass ring.
    expect(QUALITY.high.grassRadius).toBeGreaterThan(QUALITY.low.grassRadius);
  });
});

describe('tierBelow', () => {
  it('steps down one tier and clamps at low', () => {
    expect(tierBelow('high')).toBe('medium');
    expect(tierBelow('medium')).toBe('low');
    expect(tierBelow('low')).toBe('low');
  });
});

describe('parseQualityOverride', () => {
  it('reads a valid ?quality= value and rejects junk', () => {
    expect(parseQualityOverride('?quality=high')).toBe('high');
    expect(parseQualityOverride('?foo=1&quality=medium')).toBe('medium');
    expect(parseQualityOverride('?quality=ultra')).toBeNull();
    expect(parseQualityOverride('')).toBeNull();
  });
});

describe('loadStoredQuality', () => {
  it('returns a stored valid preset, else null', () => {
    expect(loadStoredQuality(memStorage({ 'wildtag-quality': 'low' }))).toBe('low');
    expect(loadStoredQuality(memStorage({ 'wildtag-quality': 'bogus' }))).toBeNull();
    expect(loadStoredQuality(memStorage())).toBeNull();
    expect(loadStoredQuality(undefined)).toBeNull();
  });
});

describe('isSoftwareRenderer', () => {
  it('flags SwiftShader / llvmpipe, not a real GPU', () => {
    expect(isSoftwareRenderer(fakeRenderer('Google SwiftShader'))).toBe(true);
    expect(isSoftwareRenderer(fakeRenderer('llvmpipe (LLVM 15)'))).toBe(true);
    expect(isSoftwareRenderer(fakeRenderer('Apple M2 Pro'))).toBe(false);
    expect(isSoftwareRenderer(fakeRenderer('NVIDIA GeForce RTX 4090'))).toBe(false);
  });
});

describe('detectQuality precedence', () => {
  const gpu = fakeRenderer('Apple M2 Pro');
  const sw = fakeRenderer('Google SwiftShader');

  it('URL override wins over everything', () => {
    const id = detectQuality(gpu, {
      search: '?quality=low',
      storage: memStorage({ 'wildtag-quality': 'high' }),
      measuredFps: 120,
    });
    expect(id).toBe<QualityId>('low');
  });

  it('stored choice wins over auto-detect', () => {
    expect(detectQuality(sw, { search: '', storage: memStorage({ 'wildtag-quality': 'high' }) })).toBe(
      'high',
    );
  });

  it('software backend auto-detects to low', () => {
    expect(detectQuality(sw, { search: '', storage: memStorage() })).toBe('low');
  });

  it('real GPU auto-detects high, dropping a tier under the fps gate', () => {
    expect(detectQuality(gpu, { search: '', storage: memStorage() })).toBe('high');
    expect(detectQuality(gpu, { search: '', storage: memStorage(), measuredFps: 20 })).toBe('medium');
    expect(detectQuality(gpu, { search: '', storage: memStorage(), measuredFps: 60 })).toBe('high');
  });
});
