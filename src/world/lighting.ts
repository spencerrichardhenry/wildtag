import * as THREE from 'three';
import { ENV } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Cascade shadows (Fidelity-2 P3, deliverable 1) — HAND-ROLLED, not three's CSM
// addon. The addon's `setupMaterial` REPLACES a material's onBeforeCompile and
// its `_injectInclude` globally monkey-patches the lighting ShaderChunks; that
// fights our terrain-detail / water-ripple onBeforeCompile shaders
// and would need per-material re-wrapping across six material families for a
// feature that never runs in the headless suite (SwiftShader gates shadows off).
// So we hand-roll with plain DirectionalLights — zero shader surgery, composes
// with every custom material for free (standard multi-light shadow path).
//
// The double-diffuse problem of two same-direction lights is solved by SPLITTING
// the sun's intensity across the cascades (shares sum to 1), so total ground
// illumination is identical to a single sun at ENV.sunIntensity — only the
// SHADOW sampling differs per cascade:
//   • medium → 1 cascade  (~80 m coverage, 1024 px), share 1.0
//   • high   → 2 cascades: FAR (~160 m, soft, share .6) + NEAR (~40 m, sharp,
//              share .4). Both point down the sun direction and follow the
//              player; the near cascade's tight frustum gives crisp contact
//              shadows, the far one carries the softer distance shadow.
//   • low    → 0 cascades (shadowless floor; the sun stays at full intensity).
// The far cascade also covers the near region, so within ~40 m both cascades
// shadow (full dark) and beyond it only the far cascade does (softer, share .6).
// `planShadows` is the PURE split/frustum math the unit suite pins.
// ---------------------------------------------------------------------------

export interface CascadeSpec {
  /** Ortho half-extent (m): ground coverage ≈ 2 × this around the player. */
  half: number;
  /** Shadow camera near/far planes (m). */
  near: number;
  far: number;
  /** Shadow map resolution (px per side). */
  res: number;
  /** Fraction of ENV.sunIntensity this cascade's light carries (shares sum to 1). */
  intensityShare: number;
  /** Distance (m) the light sits from the player along the sun direction. */
  lightDist: number;
  /** Depth bias (curbs acne on the smooth terrain). */
  bias: number;
  /** World-space normal bias (pushes the sample along the surface normal). */
  normalBias: number;
}

export interface ShadowPlan {
  cascades: 0 | 1 | 2;
  /** Per-cascade specs; index 0 = far/base cascade, index 1 = near sharp cascade. */
  specs: CascadeSpec[];
}

/**
 * Resolve the cascade plan from the preset's `shadowCascades` (0/1/2) and
 * `shadowRes`. Pure & deterministic — the intensity shares always sum to 1 for
 * any non-zero cascade count (so total sun brightness is preset-independent),
 * and each cascade's coverage (2 × half) matches the spec bands (medium ~80 m;
 * high near ~40 m / far ~160 m).
 */
export function planShadows(shadowCascades: 0 | 1 | 2, shadowRes: number): ShadowPlan {
  if (shadowCascades <= 0 || shadowRes <= 0) return { cascades: 0, specs: [] };
  const dist = ENV.shadowLightDist;
  if (shadowCascades === 1) {
    // Medium: one ~80 m cascade (half 40) carrying the full sun.
    return {
      cascades: 1,
      specs: [
        {
          half: 40,
          near: 1,
          far: dist + 120,
          res: shadowRes,
          intensityShare: 1,
          lightDist: dist,
          bias: ENV.shadowBias,
          normalBias: 0.9,
        },
      ],
    };
  }
  // High: FAR (~160 m, soft, .6) + NEAR (~40 m, sharp, .4).
  return {
    cascades: 2,
    specs: [
      {
        half: 80,
        near: 1,
        far: dist + 220,
        res: shadowRes,
        intensityShare: 0.6,
        lightDist: dist,
        bias: ENV.shadowBias,
        normalBias: 1.4,
      },
      {
        half: 20,
        near: 1,
        far: dist + 100,
        res: shadowRes,
        intensityShare: 0.4,
        lightDist: dist,
        bias: ENV.shadowBias,
        normalBias: 0.5,
      },
    ],
  };
}

/**
 * Manages the sun's shadow cascades. Wraps the always-present primary sun light
 * (created in environment.ts — it must light the scene even on the shadowless
 * low floor) as cascade 0, and lazily creates a second DirectionalLight for the
 * high preset's near cascade. `apply` reconfigures both from a ShadowPlan;
 * `follow` brackets every active cascade around the player each frame.
 */
export class ShadowRig {
  private readonly scene: THREE.Scene;
  private readonly sun: THREE.DirectionalLight;
  private readonly baseIntensity: number;
  private nearLight: THREE.DirectionalLight | null = null;
  private active = 0;

  constructor(scene: THREE.Scene, sun: THREE.DirectionalLight) {
    this.scene = scene;
    this.sun = sun;
    this.baseIntensity = sun.intensity;
  }

  /** True when at least one cascade is casting shadows. */
  get enabled(): boolean {
    return this.active > 0;
  }

  private ensureNear(): THREE.DirectionalLight {
    if (!this.nearLight) {
      const l = new THREE.DirectionalLight(ENV.sunColor, 0);
      l.name = 'sunLightNear';
      l.castShadow = true;
      this.scene.add(l);
      this.scene.add(l.target);
      this.nearLight = l;
    }
    return this.nearLight;
  }

  /**
   * Apply a shadow plan: configure cascade 0 onto the primary sun and cascade 1
   * (if any) onto the near light, splitting the sun intensity by each cascade's
   * share. `renderShadows` is the live shadow gate (false on software backends /
   * the low preset) — when false, all shadows are off and the sun keeps its full
   * intensity so lighting is unchanged.
   */
  apply(plan: ShadowPlan, renderShadows: boolean): void {
    this.active = renderShadows ? plan.cascades : 0;

    if (this.active === 0) {
      // Shadowless: sun at full intensity, no cascade maps allocated.
      this.sun.intensity = this.baseIntensity;
      this.sun.castShadow = false;
      this.disposeMap(this.sun);
      if (this.nearLight) {
        this.nearLight.intensity = 0;
        this.nearLight.castShadow = false;
        this.disposeMap(this.nearLight);
      }
      return;
    }

    const far = plan.specs[0]!;
    this.configureCascade(this.sun, far);
    this.sun.intensity = this.baseIntensity * far.intensityShare;

    if (this.active >= 2) {
      const near = plan.specs[1]!;
      const nl = this.ensureNear();
      this.configureCascade(nl, near);
      nl.intensity = this.baseIntensity * near.intensityShare;
    } else if (this.nearLight) {
      this.nearLight.intensity = 0;
      this.nearLight.castShadow = false;
      this.disposeMap(this.nearLight);
    }
  }

  private configureCascade(light: THREE.DirectionalLight, spec: CascadeSpec): void {
    light.castShadow = true;
    light.shadow.mapSize.set(spec.res, spec.res);
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    cam.left = -spec.half;
    cam.right = spec.half;
    cam.top = spec.half;
    cam.bottom = -spec.half;
    cam.near = spec.near;
    cam.far = spec.far;
    cam.updateProjectionMatrix();
    light.shadow.bias = spec.bias;
    light.shadow.normalBias = spec.normalBias;
    // Force a reallocation of the shadow map at the (possibly new) resolution.
    this.disposeMap(light);
  }

  private disposeMap(light: THREE.DirectionalLight): void {
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
  }

  /** Bracket every active cascade's light + target around the player. */
  follow(p: THREE.Vector3Like, sunDir: THREE.Vector3): void {
    if (this.active === 0) return;
    this.place(this.sun, p, sunDir, ENV.shadowLightDist);
    if (this.active >= 2 && this.nearLight) {
      this.place(this.nearLight, p, sunDir, ENV.shadowLightDist);
    }
  }

  private place(
    light: THREE.DirectionalLight,
    p: THREE.Vector3Like,
    sunDir: THREE.Vector3,
    dist: number,
  ): void {
    light.target.position.set(p.x, p.y, p.z);
    light.position.set(p.x + sunDir.x * dist, p.y + sunDir.y * dist, p.z + sunDir.z * dist);
    light.target.updateMatrixWorld();
  }
}
