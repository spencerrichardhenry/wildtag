import type * as THREE from 'three';
import { ENV, SCATTER } from './constants.ts';

// ---------------------------------------------------------------------------
// Quality presets (Fidelity-2 P1). One place that maps a preset id → the
// feature flags/values every render system reads. Auto-detected at boot
// (generalising the old shadow fps-gate: a software WebGL backend → `low`; a
// measured sub-40fps window drops a tier), overridable via `?quality=`, and
// persisted to a localStorage side-key (NOT the save) when the player picks
// one from the Esc menu.
//
// P1 wires only the flags that already have a consumer: `shadowCascades`
// (>0 → shadow map on) + `shadowRes` (map size) feed main.ts's shadow gate,
// and `grassMultiplier` + `grassRadius` feed the near-player grass ring. The
// remaining flags (ssao/bloom/waterReflections/terrainDetailShader/nearLod)
// are present but dormant — P2/P3 grow their consumers.
// ---------------------------------------------------------------------------

export type QualityId = 'low' | 'medium' | 'high';

export const QUALITY_IDS: readonly QualityId[] = ['low', 'medium', 'high'] as const;

/** localStorage side-key holding the player's explicit Esc-menu choice. */
export const QUALITY_STORAGE_KEY = 'wildtag-quality';

/** Feature flags/values resolved from a preset. Consumed by the render systems. */
export interface QualityFlags {
  /** Shadow cascades: 0 = no shadow map, 1 = single follow-light (P1), 2 = CSM (P3). */
  shadowCascades: 0 | 1 | 2;
  /** Shadow map resolution (px per cascade); 0 when shadowCascades === 0. */
  shadowRes: number;
  /** Half-res SSAO in the post pipeline (P3/high). */
  ssao: boolean;
  /** Soft bloom in the post pipeline (P3/high). */
  bloom: boolean;
  /** True planar water reflections (P3/high). */
  waterReflections: boolean;
  /** Triplanar procedural terrain detail shader (P3/medium+). */
  terrainDetailShader: boolean;
  /** Near-LOD 1m terrain grid within range (P2/medium+). */
  nearLod: boolean;
  /** Grass-ring density multiplier (1 / 4 / 8). */
  grassMultiplier: 1 | 4 | 8;
  /** Grass-ring radius (m); high widens the meadow ring. */
  grassRadius: number;
}

/**
 * The preset table. `shadowRes`/`shadowCascades` and `grassMultiplier`/
 * `grassRadius` are LIVE in P1; the rest are declared here so P2/P3 only add
 * consumers, never reshape the table.
 */
export const QUALITY: Record<QualityId, QualityFlags> = {
  low: {
    shadowCascades: 0,
    shadowRes: 0,
    ssao: false,
    bloom: false,
    waterReflections: false,
    terrainDetailShader: false,
    nearLod: false,
    grassMultiplier: 1,
    grassRadius: SCATTER.grass.radius,
  },
  medium: {
    shadowCascades: 1,
    shadowRes: 1024,
    ssao: false,
    bloom: false,
    waterReflections: false,
    terrainDetailShader: true,
    nearLod: true,
    grassMultiplier: 4,
    grassRadius: SCATTER.grass.radius,
  },
  high: {
    shadowCascades: 2,
    shadowRes: 2048,
    ssao: true,
    bloom: true,
    waterReflections: true,
    terrainDetailShader: true,
    nearLod: true,
    grassMultiplier: 8,
    grassRadius: 32,
  },
};

/** Highest grass multiplier across presets — grass buffers size for this once. */
export const MAX_GRASS_MULTIPLIER = 8;

function isQualityId(v: string | null | undefined): v is QualityId {
  return v === 'low' || v === 'medium' || v === 'high';
}

/** The preset one tier below `id` (clamped at `low`). */
export function tierBelow(id: QualityId): QualityId {
  if (id === 'high') return 'medium';
  if (id === 'medium') return 'low';
  return 'low';
}

/**
 * Detect a software WebGL backend (SwiftShader/llvmpipe/Microsoft Basic Render)
 * via the unmasked renderer string. Such backends can't afford the heavier
 * presets, so auto-detect forces `low` on them (this is what keeps the headless
 * e2e on the floor preset). Any failure to read the string is treated as "not
 * software" so real GPUs are never wrongly downgraded.
 */
export function isSoftwareRenderer(r: THREE.WebGLRenderer): boolean {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

/** `?quality=low|medium|high` override, or null if absent/invalid. */
export function parseQualityOverride(search: string): QualityId | null {
  const v = new URLSearchParams(search).get('quality');
  return isQualityId(v) ? v : null;
}

/** The stored Esc-menu choice, or null if none/invalid/unavailable. */
export function loadStoredQuality(storage: Storage | undefined): QualityId | null {
  try {
    const v = storage?.getItem(QUALITY_STORAGE_KEY) ?? null;
    return isQualityId(v) ? v : null;
  } catch {
    return null;
  }
}

export interface DetectOpts {
  /** URL query string (defaults to window.location.search). */
  search?: string;
  /** Persistence store (defaults to window.localStorage). */
  storage?: Storage;
  /**
   * A recently-measured average fps, if known. When auto-detecting (no override
   * / no stored choice) a value below `fpsGate` drops the base preset one tier.
   */
  measuredFps?: number | null;
  /** fps floor below which the auto base tier drops (default ENV.shadowFpsGate). */
  fpsGate?: number;
}

/**
 * Resolve the active preset. Precedence: explicit `?quality=` override >
 * stored Esc-menu choice > auto-detect. Auto-detect: software backend → `low`;
 * otherwise `high`, dropped one tier if `measuredFps` is below the gate. Pure —
 * `initQuality` applies the result to module state.
 */
export function detectQuality(renderer: THREE.WebGLRenderer, opts: DetectOpts = {}): QualityId {
  const override = parseQualityOverride(opts.search ?? '');
  if (override) return override;
  const stored = loadStoredQuality(opts.storage);
  if (stored) return stored;

  if (isSoftwareRenderer(renderer)) return 'low';
  const gate = opts.fpsGate ?? ENV.shadowFpsGate;
  if (opts.measuredFps != null && opts.measuredFps < gate) return tierBelow('high');
  return 'high';
}

// --- module-held active preset ---------------------------------------------

let _current: QualityId = 'high';

/**
 * Resolve + install the boot preset (detectQuality with live window inputs).
 * Returns the chosen id. `search`/`storage` are injectable for tests.
 */
export function initQuality(renderer: THREE.WebGLRenderer, opts: DetectOpts = {}): QualityId {
  const search =
    opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage =
    'storage' in opts
      ? opts.storage
      : typeof window !== 'undefined'
        ? window.localStorage
        : undefined;
  _current = detectQuality(renderer, { ...opts, search, storage });
  return _current;
}

/** The active preset id. */
export function currentQuality(): QualityId {
  return _current;
}

/** The active preset's resolved feature flags. */
export function qualityFlags(): QualityFlags {
  return QUALITY[_current];
}

/**
 * Switch the active preset. When `persist` is true the choice is written to the
 * localStorage side-key so it wins over auto-detect on the next boot. Returns
 * the new id.
 */
export function setQuality(id: QualityId, persist = true): QualityId {
  _current = id;
  if (persist) {
    try {
      window.localStorage.setItem(QUALITY_STORAGE_KEY, id);
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  }
  return _current;
}

/** Test-only: reset module state to the default (no persistence side-effects). */
export function _resetQualityForTest(): void {
  _current = 'high';
}
