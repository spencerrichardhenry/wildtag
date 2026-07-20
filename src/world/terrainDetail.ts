import type * as THREE from 'three';
import { WORLD_SEED } from '../core/constants.ts';
import { hash2 } from '../core/rng.ts';

// ---------------------------------------------------------------------------
// Terrain detail shader (Fidelity-2 P3, deliverable 2). A textureless procedural
// detail layer injected into the smooth-shaded terrain Lambert/Standard material
// via onBeforeCompile. It modulates the ALBEDO (multiply, never replace) so the
// existing vertex-colour + baked-AO pipeline and smooth normals are all
// preserved — it only adds a subtle world-position value-noise grain that kills
// the flat-poly read up close without any tiling:
//   • coarse octave: ±`COARSE_AMP` (~5%) at ~`COARSE_SCALE` m   (medium+)
//   • fine  octave:  ±`FINE_AMP`  (~3%) at ~`FINE_SCALE`  m     (high only)
// On high a cheap fragment-normal perturbation from the same noise gradient adds
// micro surface relief. World-position based → seam-free across chunk borders
// and independent of the 1 m/2 m LOD grid.
//
// `terrainDetailFactor` is the PURE JS reference of the albedo multiplier
// (deterministic from WORLD_SEED); it defines the modulation CONTRACT the unit
// suite pins (determinism + amplitude bounds). The GLSL below implements an
// equivalent hash value-noise — its exact values need not match the JS mirror
// (float precision differs on the GPU); both share the same design and bounds.
// ---------------------------------------------------------------------------

export const COARSE_SCALE = 1.5; // metres per coarse-noise cell
export const FINE_SCALE = 0.3; // metres per fine-noise cell (high only)
export const COARSE_AMP = 0.05; // ±5% albedo
export const FINE_AMP = 0.03; // ±3% albedo (high only)

const DETAIL_SEED = (WORLD_SEED ^ 0x5eed_d17a) >>> 0;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0,1] at grid coords (u, v), hashed off DETAIL_SEED. */
function valueNoise(u: number, v: number): number {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = smooth(u - iu);
  const fv = smooth(v - iv);
  const a = hash2(DETAIL_SEED, iu, iv);
  const b = hash2(DETAIL_SEED, iu + 1, iv);
  const c = hash2(DETAIL_SEED, iu, iv + 1);
  const d = hash2(DETAIL_SEED, iu + 1, iv + 1);
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

/**
 * Albedo multiplier at world (x, z): 1 ± COARSE_AMP (always) ± FINE_AMP (when
 * `high`). Pure & deterministic. Guaranteed within [1 − COARSE_AMP − FINE_AMP,
 * 1 + COARSE_AMP + FINE_AMP]; the coarse-only band is [1 − COARSE_AMP,
 * 1 + COARSE_AMP]. The unit suite pins this contract.
 */
export function terrainDetailFactor(x: number, z: number, high: boolean): number {
  const coarse = (valueNoise(x / COARSE_SCALE, z / COARSE_SCALE) * 2 - 1) * COARSE_AMP;
  let f = 1 + coarse;
  if (high) {
    const fine = (valueNoise(x / FINE_SCALE + 37.2, z / FINE_SCALE - 19.7) * 2 - 1) * FINE_AMP;
    f += fine;
  }
  return f;
}

// --- GLSL injection ---------------------------------------------------------

/** Shared noise GLSL (hash value-noise + fbm helper). Injected once per material. */
const NOISE_GLSL = `
varying vec3 vWorldPosD;
float wtHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float wtVNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = wtHash(i);
  float b = wtHash(i + vec2(1.0, 0.0));
  float c = wtHash(i + vec2(0.0, 1.0));
  float d = wtHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/**
 * Patch a terrain material's shader so its albedo (and, on high, its fragment
 * normal) carries the procedural detail. Composes with the smooth-normal +
 * vertex-colour + AO pipeline (it multiplies `diffuseColor.rgb` AFTER the vertex
 * colour is folded in). `high` adds the fine octave + a cheap normal perturb.
 * Idempotent-safe: only touches chunks the caller hasn't patched.
 */
export function applyTerrainDetail(material: THREE.Material, high: boolean): void {
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPosD;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvWorldPosD = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

    const coarse = `
      float wtCoarse = (wtVNoise(vWorldPosD.xz / ${COARSE_SCALE.toFixed(2)}) * 2.0 - 1.0) * ${COARSE_AMP.toFixed(3)};
      float wtDetail = 1.0 + wtCoarse;`;
    const fine = high
      ? `
      float wtFine = (wtVNoise(vWorldPosD.xz / ${FINE_SCALE.toFixed(2)} + vec2(37.2, -19.7)) * 2.0 - 1.0) * ${FINE_AMP.toFixed(3)};
      wtDetail += wtFine;`
      : '';

    // Albedo modulation just after the diffuse map/vertex-colour fold.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${coarse}${fine}\n  diffuseColor.rgb *= wtDetail;`,
      );

    // High: cheap normal perturbation from the coarse-noise gradient (central
    // differences in world XZ), nudging the smooth normal for micro relief.
    if (high) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          float e = 0.35;
          float nH = wtVNoise((vWorldPosD.xz + vec2(e, 0.0)) / ${COARSE_SCALE.toFixed(2)});
          float nHx = wtVNoise((vWorldPosD.xz - vec2(e, 0.0)) / ${COARSE_SCALE.toFixed(2)});
          float nV = wtVNoise((vWorldPosD.xz + vec2(0.0, e)) / ${COARSE_SCALE.toFixed(2)});
          float nVx = wtVNoise((vWorldPosD.xz - vec2(0.0, e)) / ${COARSE_SCALE.toFixed(2)});
          vec3 wtBump = vec3((nHx - nH), 0.0, (nVx - nV)) * 0.6;
          normal = normalize(normal + wtBump);
        }`,
      );
    }
  };
  material.needsUpdate = true;
}
