import { WORLD_SEED, TERRAIN } from '../core/constants.ts';
import type { Biome, Vec3 } from '../core/types.ts';
import { makeNoise2D } from './noise.ts';

// ---------------------------------------------------------------------------
// The island height field. `heightAt(x, z)` is THE ground-truth used by mesh
// building, player collision and creature AI: pure, fast, deterministic from
// WORLD_SEED. No `three` import — vectors are plain { x, y, z } objects.
//
// Construction: blend per-biome elevation profiles by an angular-sector +
// radial weight, add fbm detail (plus ridged spires in the crags), then
// subtract a radial coast falloff so the terrain drops below sea level
// beyond the island radius.
// ---------------------------------------------------------------------------

// Seeded noise channels (module singletons — allocation-free per query).
const heightNoise = makeNoise2D(WORLD_SEED);
const ridgeNoise = makeNoise2D((WORLD_SEED ^ 0x9e3779b9) >>> 0);
const moistureNoise = makeNoise2D((WORLD_SEED * 7 + 13) >>> 0);

const TWO_PI = Math.PI * 2;

// Angular lobe centres (radians), using atan2(z, x): +x = East, +z = South,
// so North = -PI/2, NW = -3PI/4, W = ±PI. Matches the required geography:
// meadow spawn/east, forest N/NE, wetland S, crags W, highlands NW.
const ANG_MEADOW = Math.PI / 8; // E / SE
const ANG_FOREST = (-3 * Math.PI) / 8; // N / NE
const ANG_WETLAND = Math.PI / 2; // S
const ANG_CRAGS = Math.PI; // W (wraps)
const ANG_HIGHLANDS = (-3 * Math.PI) / 4; // NW
const LOBE_HALF_WIDTH = 2.0; // radians; lobes overlap for smooth blends

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite smoothstep of t normalized between edges a and b. */
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep (zero 1st/2nd derivative at edges). */
function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smallest signed angular difference a - b, wrapped to [-PI, PI]. */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Smooth angular membership of `ang` in a lobe centred at `center`. */
function lobe(ang: number, center: number): number {
  const d = Math.abs(angDiff(ang, center));
  if (d >= LOBE_HALF_WIDTH) return 0;
  const t = 1 - d / LOBE_HALF_WIDTH;
  return t * t * (3 - 2 * t);
}

/** Fractional Brownian motion in [-1, 1] (normalized by summed amplitude). */
function fbm(
  noise: (x: number, y: number) => number,
  x: number,
  z: number,
  freq: number,
  octaves: number,
): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, z * f);
    norm += amp;
    amp *= TERRAIN.gain;
    f *= TERRAIN.lacunarity;
  }
  return sum / norm;
}

/** Ridged fbm in [0, 1] — sharp peaks along noise zero-crossings. */
function ridgedFbm(
  noise: (x: number, y: number) => number,
  x: number,
  z: number,
  freq: number,
  octaves: number,
): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(noise(x * f, z * f));
    sum += amp * r * r;
    norm += amp;
    amp *= TERRAIN.gain;
    f *= TERRAIN.lacunarity;
  }
  return sum / norm;
}

/**
 * Ground height (m) at world (x, z). Pure & deterministic from WORLD_SEED.
 * Sea level is 0; values below 0 are underwater.
 */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ang = Math.atan2(z, x);
  const p = TERRAIN.biomeProfile;

  // Radial mix: meadow dominates the centre, outer biomes fade in with radius.
  const outer = smoothstep(TERRAIN.outerRampStart, TERRAIN.outerRampEnd, r);
  let wMeadow = 1 - outer + lobe(ang, ANG_MEADOW) * outer;
  let wForest = lobe(ang, ANG_FOREST) * outer;
  let wWetland = lobe(ang, ANG_WETLAND) * outer;
  let wCrags = lobe(ang, ANG_CRAGS) * outer;
  let wHighlands = lobe(ang, ANG_HIGHLANDS) * outer;

  const wSum = wMeadow + wForest + wWetland + wCrags + wHighlands || 1;
  wMeadow /= wSum;
  wForest /= wSum;
  wWetland /= wSum;
  wCrags /= wSum;
  wHighlands /= wSum;

  const base =
    wMeadow * p.meadow.base +
    wForest * p.forest.base +
    wWetland * p.wetland.base +
    wCrags * p.crags.base +
    wHighlands * p.highlands.base;
  const amp =
    wMeadow * p.meadow.amp +
    wForest * p.forest.amp +
    wWetland * p.wetland.amp +
    wCrags * p.crags.amp +
    wHighlands * p.highlands.amp;

  const n = fbm(heightNoise, x, z, TERRAIN.baseFrequency, TERRAIN.octaves);
  let h = base + n * amp;

  // Crag spires: sharp ridged peaks weighted by crag influence.
  if (wCrags > 0.001) {
    const ridge = ridgedFbm(ridgeNoise, x, z, TERRAIN.ridgeFrequency, TERRAIN.ridgeOctaves);
    h += wCrags * ridge * TERRAIN.cragSpire;
  }

  // Radial coast falloff: everything drops below sea level past the shore.
  h -= TERRAIN.falloffStrength * smootherstep(TERRAIN.falloffStart, TERRAIN.falloffEnd, r);

  return h;
}

/** Moisture channel in [0, 1] used to refine biome classification. */
function moistureAt(x: number, z: number): number {
  return (moistureNoise(x * TERRAIN.moistureFrequency, z * TERRAIN.moistureFrequency) + 1) * 0.5;
}

/** Categorical biome for the angular sector containing `ang` (radians). */
function sectorBiome(ang: number): Biome {
  const q = Math.PI / 8;
  if (ang >= 5 * q || ang < -7 * q) return 'crags'; // W / SW (wraps at ±PI)
  if (ang < -5 * q) return 'highlands'; // NW
  if (ang < -q) return 'forest'; // N / NE
  if (ang < 3 * q) return 'meadow'; // E / SE (spawn overflow)
  return 'wetland'; // S
}

/**
 * Biome at world (x, z), derived from height + moisture + radial sector.
 * Water wherever `heightAt` dips below the water threshold; the central
 * disk is always meadow; outer land follows the angular geography.
 */
export function biomeAt(x: number, z: number): Biome {
  const h = heightAt(x, z);
  if (h < TERRAIN.waterHeight) return 'water';

  const r = Math.hypot(x, z);
  if (r < TERRAIN.meadowRadius) return 'meadow';

  const ang = Math.atan2(z, x);
  const sector = sectorBiome(ang);
  const m = moistureAt(x, z);

  // Moisture refinement (does not remove any biome's core region):
  // dry, low forest fringes read as meadow; damp meadow lowlands as wetland.
  if (sector === 'forest' && m < TERRAIN.dryThreshold && h < 14) return 'meadow';
  if (sector === 'meadow' && m > TERRAIN.wetThreshold && h < 3) return 'wetland';

  return sector;
}

/**
 * Surface normal at (x, z) via central differences (eps = TERRAIN.normalEps).
 * Returns a unit vector; up-dominant on gentle ground.
 */
export function groundNormalAt(x: number, z: number): Vec3 {
  const e = TERRAIN.normalEps;
  const hL = heightAt(x - e, z);
  const hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e);
  const hU = heightAt(x, z + e);

  const nx = -(hR - hL) / (2 * e);
  const nz = -(hU - hD) / (2 * e);
  const ny = 1;
  const inv = 1 / Math.hypot(nx, ny, nz);
  return { x: nx * inv, y: ny * inv, z: nz * inv };
}
