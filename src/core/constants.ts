// All tuning constants live here — never inline elsewhere.

/** Single seed driving all deterministic world generation / PRNG. */
export const WORLD_SEED = 1337;

/** Fixed simulation timestep (seconds) for the accumulator-driven game loop. */
export const SIM_DT = 1 / 60;

/** Clamp on per-frame delta (seconds) so long stalls don't spiral the accumulator. */
export const MAX_FRAME_DT = 0.1;

/** Player camera projection parameters. */
export const CAMERA = { fov: 75, near: 0.1, far: 1200 };

/**
 * Procedural terrain tuning. `heightAt` is the single ground-truth height
 * field; every constant that shapes the island lives here, never inline.
 */
export const TERRAIN = {
  /** Approximate land radius (m); beyond it the coast drops below sea level. */
  islandRadius: 950,
  /** Sea level (world Y where water sits). */
  seaLevel: 0,
  /** Height below which a tile is classified as water. */
  waterHeight: 0.2,

  /** Central meadow disk radius (m): spawn area is always meadow. */
  meadowRadius: 200,
  /** Radial ramp (m) over which outer biomes fade in past the meadow. */
  outerRampStart: 120,
  outerRampEnd: 340,

  /** Radial coast falloff subtracted from raw height. */
  falloffStart: 760,
  falloffEnd: 1120,
  falloffStrength: 200,

  /** fbm settings for the primary rolling-height noise field. */
  baseFrequency: 1 / 260,
  octaves: 5,
  lacunarity: 2,
  gain: 0.5,

  /** Ridged noise used to sharpen crag spires. */
  ridgeFrequency: 1 / 130,
  ridgeOctaves: 4,
  cragSpire: 55,

  /** Moisture noise field (biome refinement). */
  moistureFrequency: 1 / 420,
  dryThreshold: 0.38,
  wetThreshold: 0.62,

  /** Central-difference epsilon (m) for ground normals. */
  normalEps: 0.5,

  /**
   * Per-biome elevation profile: base offset + noise amplitude (m).
   * base ± amp brackets the biome's intended height band.
   */
  biomeProfile: {
    meadow: { base: 6, amp: 4 },
    forest: { base: 19, amp: 11 },
    wetland: { base: 1.6, amp: 2.2 },
    crags: { base: 25, amp: 15 },
    highlands: { base: 82, amp: 25 },
  },
} as const;
