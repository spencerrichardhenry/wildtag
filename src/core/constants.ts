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

  /**
   * Wetland lakes: where the raw wetland-weighted height falls below
   * lakeThreshold, the deficit is amplified by lakeDip (scaled by wetland
   * influence) so low basins dip below sea level and become lakes.
   */
  lakeThreshold: 0.4,
  lakeDip: 3,

  /** Ridged noise used to sharpen crag spires. */
  ridgeFrequency: 1 / 130,
  ridgeOctaves: 4,
  cragSpire: 55,

  /** Moisture noise field (biome refinement). */
  moistureFrequency: 1 / 420,
  dryThreshold: 0.38,
  wetThreshold: 0.62,
  /** Max height (m) at which a dry forest fringe reads as meadow. */
  fringeForestMaxH: 14,
  /** Max height (m) at which a damp meadow lowland reads as wetland. */
  fringeWetlandMaxH: 3,

  /**
   * Angular lobe centres (radians) for the biome geography, using
   * atan2(z, x): +x = East, +z = South, so North = -PI/2, NW = -3PI/4,
   * W = ±PI. Meadow spawn/east, forest N/NE, wetland S, crags W,
   * highlands NW.
   */
  lobeAngles: {
    meadow: Math.PI / 8, // E / SE
    forest: (-3 * Math.PI) / 8, // N / NE
    wetland: Math.PI / 2, // S
    crags: Math.PI, // W (wraps)
    highlands: (-3 * Math.PI) / 4, // NW
  },
  /** Angular lobe half-width (radians); lobes overlap for smooth blends. */
  lobeHalfWidth: 1.3,

  /** Central-difference epsilon (m) for ground normals. */
  normalEps: 0.5,

  /**
   * Per-biome elevation profile: base offset + noise amplitude (m).
   * base ± amp brackets the biome's intended height band.
   */
  biomeProfile: {
    meadow: { base: 6, amp: 4 },
    forest: { base: 19, amp: 11 },
    wetland: { base: 1.4, amp: 3.0 },
    crags: { base: 25, amp: 15 },
    highlands: { base: 82, amp: 25 },
  },
} as const;

/**
 * Streaming terrain-mesh chunks. The world is tiled into `size`-metre square
 * chunks; each is a `verts`×`verts` grid sampled from `heightAt`. Chunks within
 * `radius` chunks of the player (Chebyshev distance) are kept resident.
 */
export const CHUNKS = {
  /** Chunk edge length (m). */
  size: 64,
  /** Vertices per chunk edge (so `verts - 1` quads span `size` metres). */
  verts: 33,
  /** Keep-resident radius in chunks (Chebyshev) around the player. */
  radius: 7,
  /** Max chunk meshes built per `update()` call, to avoid frame hitches. */
  buildsPerUpdate: 8,
} as const;

/**
 * Environment visuals: lighting, fog, sky dome and water plane. Colors are
 * hex ints. The per-biome ground palette (+ sand near the shore) lives with
 * the chunk mesh builder.
 */
export const ENV = {
  /** Hemisphere light: sky-facing and ground-facing tints. */
  hemiSky: 0xbfd9ff,
  hemiGround: 0x6b5b47,
  hemiIntensity: 1.0,

  /** Warm low-angle "golden hour" directional sun. */
  sunColor: 0xffe8b0,
  sunIntensity: 1.4,
  /** Sun position (world) — low angle for long, warm light. */
  sunPos: { x: 260, y: 180, z: 120 },

  /** Linear fog: color, near and far distances (m). */
  fogColor: 0xcfd8e8,
  fogNear: 150,
  fogFar: 1000,

  /**
   * Sky dome: big backface sphere with a vertical gradient. Radius sits just
   * inside CAMERA.far (1200) so the dome renders instead of being far-plane
   * clipped; its material ignores fog so it stays a clean gradient while
   * distant terrain fades into the matching horizon colour.
   */
  skyRadius: 1150,
  skyTop: 0x4a78c0,
  skyHorizon: 0xcfd8e8,

  /** Per-biome ground vertex colors + shore sand. */
  biomeColors: {
    meadow: 0x7fb069,
    forest: 0x3e7d4f,
    wetland: 0x6d8a5b,
    crags: 0x8d8577,
    highlands: 0xa8b6a0,
    water: 0x4a6b7a,
    sand: 0xd9c9a3,
  },
  /** Height (m) below which land is tinted with shore sand. */
  sandHeight: 1.2,

  /** Translucent water plane. */
  waterY: 0.05,
  waterSize: 2200,
  waterColor: 0x3a6b82,
  waterOpacity: 0.72,
} as const;
