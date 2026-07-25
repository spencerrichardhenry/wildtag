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
 * Player movement tuning (m, m/s, m/s², seconds). Consumed by the pure
 * movement core in `src/player/movement.ts`. Unlock gating (glider/rocket
 * crafted?) lives in the controller, which masks input flags — the core
 * assumes an ability is allowed iff its input flag is set.
 */
export const MOVE = {
  /** Target ground speed while walking. */
  walk: 6,
  /** Target ground speed while sprinting (not exhausted). */
  sprint: 9.5,
  /** Horizontal acceleration on the ground (also friction decel rate). */
  accelGround: 40,
  /** Horizontal acceleration while airborne. */
  accelAir: 12,
  /** Planar speed forced along facing while a dash is active. */
  dashSpeed: 18,
  /** Dash active window (s); gravity is skipped while dashing. */
  dashDuration: 0.18,
  /** Flat stamina cost per dash. */
  dashCost: 25,
  /** Minimum time between dashes (s). */
  dashCooldown: 0.6,
  /** Vertical takeoff speed for a jump. */
  jumpVel: 8.5,
  /** Gravity (m/s², negative = down). */
  gravity: -24,
  /** Grace window (s) to jump after walking off a ledge. */
  coyoteTime: 0.12,
  /** Window (s) a jump press is buffered before landing. */
  jumpBufferTime: 0.15,
  /** Stamina pool cap. */
  staminaMax: 100,
  /** Stamina drain per second while sprinting and moving. */
  sprintDrain: 10,
  /** Stamina regen per second once the delay has elapsed. */
  regenRate: 22,
  /** Seconds after any drain before regen resumes. */
  regenDelay: 0.8,
  /** Entering exhaustion below this stamina. */
  exhaustEnterBelow: 1,
  /** Exhaustion clears at/above this stamina. */
  exhaustExitAbove: 20,
  /** Vertical sink rate while gliding (vy floor, m/s). */
  glideSink: -2,
  /** Target horizontal speed along facing while gliding. */
  glideForward: 14,
  /** Vertical impulse added by the rocket. */
  rocketImpulseY: 14,
  /** Horizontal impulse along facing added by the rocket. */
  rocketImpulseFwd: 4,
  /** Flat stamina cost per rocket. */
  rocketCost: 40,
  /** Minimum time between rockets (s). */
  rocketCooldown: 4,
} as const;

/**
 * Player HP (Cursed Castle Task 6). Pure state lives in
 * `src/player/health.ts`; no damage sources exist yet (goblins, Task 11).
 */
export const HEALTH = {
  max: 100,
  regenDelayS: 4,
  regenPerS: 12,
  dazedS: 3,
  /** m the dazed stumble carries the player away from the castle. */
  dazedRetreat: 16,
  /** HP bar auto-hides this long after reaching full (s). */
  barLingerS: 2,
} as const;

/**
 * Grapple hook — Terraria-style projectile model (Task 16, reworked from the
 * original hitscan/reel of Task 12 per direct user feedback). The hook now
 * *flies* as a ballistic projectile (`hookSpeed` along the look dir under
 * `hookGravity`, capped at `hookMaxFlight` seconds — ballistics IS the range
 * limit, there is no maxRange rejection). On contact it latches to terrain,
 * trees/rocks, or a drone anchor and AUTOMATICALLY pulls the player with
 * constant acceleration `zipAccel` toward it (Terraria-style; no reel, no
 * stamina — the cost is aim + travel time), perpendicular velocity damped at
 * `zipPerpDamp`/s, speed capped at `zipMaxSpeed` while attached. Momentum is
 * preserved on release, so jump/boost mid-zip → re-fire from the air chains
 * movement. Arrival at `hangLength` pins the player to the anchor (a "hang"),
 * gravity suspended because the anchor is real geometry — not free flight.
 *
 * `stiffness`/`radialDamping`/`springAccelMax` remain for the exported
 * pendulum constraint (used by tests and available for future rope modes).
 * Distances in m, speeds m/s, times s.
 */
export const GRAPPLE = {
  /** Projectile muzzle speed (m/s). 40→57 doubled the ballistic range with a
   *  geometrically similar arc (range ∝ v²/g; ×√2 speed = ×2 distance). */
  hookSpeed: 57,
  /** Gravity on the hook in flight (m/s², negative = down) — a gentle arc. */
  hookGravity: -10,
  /** Max flight time (s) before an un-latched hook fizzles (≈90m level fire). */
  hookMaxFlight: 2.0,
  /** Constant acceleration toward the anchor while attached (m/s²) —
   *  crisp Terraria yank (playtest: doubled from 45). */
  zipAccel: 90,
  /** Speed cap while attached (m/s); released momentum is uncapped. */
  zipMaxSpeed: 38,
  /** Perpendicular-velocity damping rate (per second) while attached, so the
   *  flight curves onto the anchor instead of orbiting it. */
  zipPerpDamp: 1.6,
  /** Rope length (m) at which the zip ends and the player pins into a hang. */
  hangLength: 1.2,
  /** Max distance (m) for the debug/occlusion terrain ray-march. */
  maxRange: 90,
  /** Terrain anchors are lifted this far (m) above the surface hit so the
   *  hook mesh and rope end stay visible instead of half-burying (terrain
   *  latches only; prop/drone latches sit on real geometry and need no lift). */
  anchorLift: 0.45,
  /** Spring stiffness: inward accel (m/s²) per metre of overstretch. */
  stiffness: 35,
  /** Fraction of the remaining radial velocity damped per step. */
  radialDamping: 0.3,
  /** Cap on spring accel (m/s²) so a large overstretch can't explode. */
  springAccelMax: 200,
  /** Seconds the rope may stay occluded before it auto-releases. */
  occlusionGrace: 0.5,
  /** Upward velocity bonus (m/s) when the grapple is released via a jump. */
  jumpReleaseBoost: 2,
  /**
   * Grounded auto-settle (stall detector): a hook whose pull can't lift a
   * grounded player off the terrain just jitters them in place. While grounded
   * and latched, the player→anchor distance must improve by at least
   * `settleMinProgress` m within every `settleStallWindow` s — otherwise the
   * hook auto-releases. A converging zip always makes progress (never eaten,
   * at any distance); only a genuinely stuck pull trips the release.
   */
  settleStallWindow: 0.5,
  settleMinProgress: 0.05,
  /** Terrain ray-march: distance (m) stepped per sample against heightAt. */
  marchStep: 0.75,
  /** Bisection refinement passes after a terrain-march bracket is found. */
  marchRefine: 4,
  /** Segment samples between player and anchor for the occlusion test. */
  occlusionSamples: 14,
} as const;

/**
 * Deployable structures (Task 13): ziplines + drones + their placement mode.
 * The pure cores (`validateZipline`/`zipRide`/`zipPoint`) consume these; the
 * three.js systems layer them on. Distances in m, speeds m/s, times s.
 */
export const STRUCTURES = {
  /** Hard cap on concurrently-placed ziplines. */
  maxZiplines: 3,
  /** Hard cap on concurrently-deployed drones. */
  maxDrones: 2,
  /** Max zipline span (m); a longer A→B is rejected. */
  ziplineMaxLen: 80,
  /** Base ride speed along a zipline (m/s), before slope assist. */
  ziplineSpeed: 14,
  /** Ride-speed bonus/penalty (m/s) at full downhill/uphill slope (±1). */
  slopeAssist: 6,
  /** Ride-speed floor (m/s) after slope assist — a steep uphill still crawls. */
  minSpeed: 6,
  /** Quadratic sag: how far (m) the cable's midpoint dips below the chord. */
  sag: 1.5,
  /** Minimum clearance (m) the cable must keep above terrain along its span. */
  losClearance: 0.5,
  /** Interior samples taken along the cable for the line-of-sight check. */
  losSamples: 24,
  /** Drone station-keeping altitude above the ground beneath it (m). */
  droneHover: 25,
  /** Radius (m) of the grapple anchor sphere a hovering drone registers. */
  droneAnchorRadius: 4.8,
  /** Max terrain-aim distance (m) for placing a structure. */
  placeRange: 30,
  /** Hold-F duration (s) at a post to recall a zipline (refund the kit). */
  recallHold: 1.0,
  /** Tap-F below this (s) mounts; a longer hold arms the recall. */
  recallTap: 0.4,
  /** A post counts as "mountable" within this distance of the player (m). */
  mountRange: 2.5,
  /** Height (m) of the support posts a zipline's endpoints sit atop. */
  postHeight: 4,
  /** Player feet hang this far (m) below the cable while riding. */
  ziplineHang: 1.2,
  /** Drone vertical climb rate while ascending to altitude (m/s). */
  droneAscent: 3,
  /** Gentle station-keeping bob amplitude (± m) once a drone is at altitude. */
  droneBob: 0.5,
  /** Bob angular rate (rad/s) — purely cosmetic. */
  droneBobRate: 1.5,
  /** Rotor spin rate (rad/s) — purely cosmetic. */
  droneRotorRate: 30,
  /** Recall a drone while standing within this horizontal distance beneath it (m). */
  droneRecallRange: 8,
} as const;

/**
 * First-person input + camera tuning. Mouse look and camera placement are
 * owned by the player input/controller layer (not the pure movement core).
 */
export const INPUT = {
  /** Radians of yaw/pitch per pixel of raw mouse movement. */
  mouseSensitivity: 0.0022,
  /** Pitch clamp (radians) so the camera can't flip past straight up/down. */
  pitchClamp: 1.52,
  /** Camera height above the player's feet position (m). */
  eyeHeight: 1.65,
  /** Player collision-cylinder radius (m) for obstacle pushout. */
  playerRadius: 0.4,
} as const;

/**
 * Streaming terrain-mesh chunks. The world is tiled into `size`-metre square
 * chunks; each is a `verts`×`verts` grid sampled from `heightAt`. Chunks within
 * `radius` chunks of the player (Chebyshev distance) are kept resident.
 */
export const CHUNKS = {
  /** Chunk edge length (m). */
  size: 64,
  /** Vertices per chunk edge (so `verts - 1` quads span `size` metres). 2 m
   *  grid — the FAR LOD used everywhere the near-LOD ring doesn't reach. */
  verts: 33,
  /**
   * Near-LOD vertices per chunk edge (F2 P2): a 1 m grid (64 quads span the
   * 64 m chunk) built for chunks close to the player when the `nearLod` quality
   * flag is on. 4× the vertex density of the far grid, so the ground near the
   * player reads as smooth rolling landscape rather than 2 m polygon plates.
   */
  nearVerts: 65,
  /**
   * Near-LOD ring hysteresis (m, chunk-centre → player). A far chunk PROMOTES
   * to the 1 m grid once its centre is within `lodPromote`; a near chunk
   * DEMOTES back to 2 m only past `lodDemote`. The gap between them keeps a
   * chunk sitting on the boundary from thrashing rebuilds as the player jitters.
   */
  lodPromote: 88,
  lodDemote: 104,
  /**
   * Edge-skirt drop (m): every chunk's rim vertices are duplicated and pushed
   * this far straight down, skinned with a vertical wall (rim colour + normal),
   * so the sub-metre height mismatch at a 1 m↔2 m LOD boundary hides behind a
   * skirt instead of showing a see-through T-junction crack. No stitching.
   */
  skirtDrop: 0.6,
  /** Keep-resident radius in chunks (Chebyshev) around the player. */
  radius: 7,
  /** Max chunk meshes built per `update()` call, to avoid frame hitches.
   *  LOD promotions queue against the same budget as fresh builds. */
  buildsPerUpdate: 8,
} as const;

/**
 * Deterministic scatter + harvestable-resource tuning. Every chunk is diced
 * into a `grid`×`grid` sub-cell lattice; each sub-cell rolls (via hash2) for a
 * single prop whose kind depends on the biome at the jittered sample point.
 * Trees/rocks emit collision cylinders; fiber/resin/shard/spark are harvestable
 * nodes with a `respawnS`-second cooldown. Nothing is placed on the `water`
 * biome or below `minPlacementY`.
 */
export const SCATTER = {
  /** Sub-cells per chunk edge (grid² candidate slots per chunk). */
  grid: 8,
  /** Max fraction of a sub-cell a sample point jitters from its cell centre. */
  jitter: 0.42,
  /** Never place a prop where the ground is below this height (m). */
  minPlacementY: 0.4,

  /** Resource node respawn cooldown after harvest (s). */
  respawnS: 180,
  /** Max distance (m) from the camera to harvest a node. */
  harvestRange: 3,
  /** Look-cone half-angle (deg): a node harvests only when within this of the aim. */
  harvestConeDeg: 60,
  /** Instance scale applied to a depleted node until it respawns. */
  depletedScale: 0.2,

  /** Keep-resident radius (chunks) for prop meshes — smaller than terrain. */
  radius: 4,
  /** Max prop chunks built per update() call (steady state builds none). */
  buildsPerUpdate: 6,
  /** Obstacles are supplied to the player only within this many chunks. */
  obstacleRangeChunks: 2,

  /** Chance per chunk of a single rare spark mote (placed anywhere valid). */
  sparkChancePerChunk: 0.15,
  /** Chance a forest tree also spawns a resin node at its base. */
  resinChancePerTree: 0.35,
  /** Horizontal offset (m) of a resin node from its host tree's base. */
  resinOffset: 0.75,

  /**
   * Permanent meadow ground-cover: per-sub-cell chance a meadow sub-cell sprouts
   * one static, non-colliding grass tuft (an independent roll appended after the
   * prop scatter — see scatter.ts). At grid² = 64 sub-cells this yields ~60
   * tufts per fully-meadow chunk: sparse world-space cover, roughly 1/20 of the
   * old near-player grass ring's full density, with no ring/bubble to follow.
   */
  grasstuftChance: 0.95,

  /**
   * Per-biome scatter table: ordered cumulative roll thresholds. A sub-cell's
   * roll r in [0,1) picks the first entry with r < p; if it exceeds every
   * threshold the sub-cell stays empty. F2 scenery pass: trees carry a per-
   * biome geometry `variant` (see treeVariants); crags/highlands gain mesa slab
   * formations, boulder stacks and scree patches; wetland gains reeds + willow
   * + lake lily pads; forest gains glow mushrooms; meadow gains rare lone trees
   * + erratic boulders. Densities favour variety over raw count (replace, not
   * add) so a spawn-area sample stays within ~1.5× the pre-F2 instance total.
   */
  biomeScatter: {
    meadow: [
      { kind: 'tree', p: 0.03 }, // rare lone oak / flowering shrub
      { kind: 'boulder', p: 0.045 }, // rare glacial erratic
      { kind: 'flower', p: 0.25 },
      { kind: 'fiber', p: 0.4 },
    ],
    forest: [
      { kind: 'tree', p: 0.22 }, // pine / broadleaf dome / dead snag
      { kind: 'mushroom', p: 0.25 }, // glow-mushroom clusters
      { kind: 'flower', p: 0.3 },
    ],
    wetland: [
      { kind: 'reed', p: 0.14 },
      { kind: 'tree', p: 0.17 }, // drooping willow
      { kind: 'flower', p: 0.32 },
      { kind: 'fiber', p: 0.46 },
    ],
    crags: [
      { kind: 'tree', p: 0.03 }, // rare gnarled juniper snag
      { kind: 'boulder', p: 0.07 },
      { kind: 'mesa', p: 0.09 }, // stacked slab formation
      { kind: 'rock', p: 0.21 },
      { kind: 'crystal', p: 0.31 },
      { kind: 'shard', p: 0.37 },
      { kind: 'scree', p: 0.47 },
    ],
    highlands: [
      { kind: 'tree', p: 0.05 }, // wind-bent pine / boulder-pine cluster
      { kind: 'boulder', p: 0.09 },
      { kind: 'mesa', p: 0.12 }, // elongated rock ribs
      { kind: 'rock', p: 0.22 },
      { kind: 'crystal', p: 0.3 },
      { kind: 'shard', p: 0.36 },
      { kind: 'scree', p: 0.44 },
    ],
  },

  /**
   * Per-biome tree geometry variants (cumulative roll on the S_VARIANT channel).
   * `v` is the mesh bucket key (props.ts builder), independent of the `tree`
   * gameplay kind (obstacle/grapple/resin all still key off kind === 'tree').
   */
  treeVariants: {
    forest: [
      { v: 'pine', p: 0.45 },
      { v: 'broadleaf', p: 0.8 },
      { v: 'snag', p: 1 },
    ],
    meadow: [
      { v: 'shrub', p: 0.7 },
      { v: 'oak', p: 1 },
    ],
    highlands: [
      { v: 'windpine', p: 0.6 },
      { v: 'boulderpine', p: 1 },
    ],
    wetland: [{ v: 'willow', p: 1 }],
    crags: [{ v: 'juniper', p: 1 }],
  },

  /** Crystal size/colour variants (crags/highlands crystal + shard fields). */
  crystalVariants: [
    { v: 'crystalA', p: 0.4 },
    { v: 'crystalB', p: 0.75 },
    { v: 'crystalC', p: 1 },
  ],

  /** Mesa formation flavour per biome: crag slab mesa vs highlands rock rib. */
  mesaVariants: { crags: 'mesa', highlands: 'rib' },

  /** Chance a wetland-lake water sub-cell floats a lily pad. */
  lilypadChance: 0.5,
  /** Max shallow-water depth (m below sea) that still reads as a lily-pad lake. */
  lilypadMaxDepth: 3,

  /** Hard per-chunk instance cap per kind — variety over density. */
  caps: {
    tree: 24,
    rock: 30,
    crystal: 20,
    flower: 28,
    fiber: 28,
    mesa: 4,
    boulder: 8,
    scree: 18,
    reed: 14,
    lilypad: 18,
    mushroom: 8,
    shard: 18,
  },

  /** Per-kind instance scale range [min, max] (uniform hash pick). */
  scale: {
    tree: [0.85, 1.6],
    rock: [0.6, 1.5],
    crystal: [0.5, 1.15],
    flower: [0.7, 1.3],
    fiber: [0.7, 1.2],
    resin: [0.7, 1.1],
    shard: [0.7, 1.35],
    spark: [0.85, 1.2],
    mesa: [0.8, 1.5],
    boulder: [0.7, 1.4],
    scree: [0.7, 1.3],
    reed: [0.8, 1.3],
    lilypad: [0.7, 1.4],
    mushroom: [0.7, 1.2],
    /** Grass tufts: ±25% scale jitter about 1.0. */
    grasstuft: [0.75, 1.25],
  },

  /** Collision-cylinder radius factor (× scale) for blocking props. */
  obstacleRadius: { tree: 0.5, rock: 0.9, mesa: 1.6, boulder: 1.1 },

  /** Per-kind base colours (hex) for flat-shaded instanced meshes. */
  colors: {
    trunk: 0x6b4a2f,
    foliage: 0x2f6d3a,
    rock: 0x8b8378,
    crystal: 0x7fb0d8,
    flower: 0xe27ba8,
    reed: 0x8aa15b,
    fiber: 0xbcae6b,
    resin: 0xe0932a,
    shard: 0xb07fe0,
    spark: 0xffe06a,
    // --- F2 scenery-variety palette ---
    pineFoliage: 0x2b6238,
    broadleaf: 0x4f8f3d,
    oakLeaf: 0x5c8a34,
    snag: 0x7a6a58,
    shrub: 0x6f9d4a,
    shrubBloom: 0xe89bc0,
    windPine: 0x35704a,
    willowLeaf: 0x7fa25a,
    juniper: 0x40634a,
    mesa: 0x9a8a72,
    rib: 0x8f8778,
    boulder: 0x847c70,
    scree: 0x9c9284,
    lily: 0x3f8f57,
    lilyBloom: 0xf0e7f5,
    mushroomStem: 0xd8cdb4,
    mushroomCap: 0x9c5bd0,
    /** Meadow grass-tuft base green: ENV.biomeColors.meadow (0x7fb069) darkened
     *  ~8% so tufts blend into the terrain as texture (per-instance yellowed→
     *  deeper-green jitter applied in props). */
    grassTuft: 0x75a261,
    crystalA: 0x7fb0d8,
    crystalB: 0x9d86e0,
    crystalC: 0x6fd8c0,
  },
} as const;

/**
 * Environment visuals: lighting, fog, sky dome and water plane. Colors are
 * hex ints. The per-biome ground palette (+ sand near the shore) lives with
 * the chunk mesh builder.
 */
export const ENV = {
  /**
   * ACES filmic tone-mapping exposure (main.ts). ACES compresses highlights and
   * gently desaturates midtones, so the raw light intensities below are pushed
   * BRIGHTER than a pre-tone-map pipeline would want — the golden-hour warmth
   * has to survive the curve. Tuned by eye against the biome screenshots.
   */
  exposure: 1.12,

  /** Hemisphere light: sky-facing and ground-facing tints (warm bounce). */
  hemiSky: 0xcfe2ff,
  hemiGround: 0x7a6446,
  hemiIntensity: 0.95,

  /** Warm low-angle "golden hour" directional sun (brightened for ACES). */
  sunColor: 0xffdca0,
  sunIntensity: 2.9,
  /** Sun position (world) — low angle for long, warm light. */
  sunPos: { x: 260, y: 180, z: 120 },
  /** Soft sun disc + additive glow sprite along the sun direction. */
  sunDiscColor: 0xfff4d8,
  sunGlowColor: 0xffcf8a,
  /** Sun sprite sizes (world units at the dome radius): tight disc, broad glow. */
  sunDiscSize: 62,
  sunGlowSize: 260,

  /** Linear fog: color, near and far distances (m). Warm golden-hour haze. */
  fogColor: 0xe0d6c2,
  fogNear: 190,
  fogFar: 1080,

  /**
   * Sky dome: big backface sphere with a THREE-stop vertical gradient
   * (horizon → mid → zenith). Radius sits just inside CAMERA.far (1200) so the
   * dome renders instead of being far-plane clipped; its material ignores fog
   * so it stays a clean gradient while distant terrain fades into the matching
   * horizon colour.
   */
  skyRadius: 1150,
  skyTop: 0x3f6fbe,
  skyMid: 0x93b6e0,
  skyHorizon: 0xf0dcc0,
  /** Height fraction [0,1] of the mid gradient stop over the dome. */
  skyMidStop: 0.3,

  /** Per-biome ground vertex colors + shore sand. */
  biomeColors: {
    meadow: 0x7fb069,
    forest: 0x3e7d4f,
    wetland: 0x6d8a5b,
    crags: 0x8d8577,
    highlands: 0xa8b6a0,
    water: 0x4a6b7a,
    sand: 0xdccba0,
  },
  /** Height (m) below which land is tinted with shore sand. */
  sandHeight: 1.2,
  /** Terrain colour blend: sample offset (m) for the 4-tap biome border blend. */
  blendOffset: 6,
  /** Per-vertex micro lightness jitter (± fraction) from a position hash. */
  vertexJitter: 0.04,
  /** Ground-normal Y below which the surface tints toward crag rock (steep). */
  slopeRockThreshold: 0.75,
  /** Max blend fraction toward rock on the steepest slopes. */
  slopeRockMax: 0.6,

  /**
   * Vertex ambient occlusion (F2 P2), baked into the terrain vertex colour from
   * height-grid concavity: `d = (avg of the 4 ±STEP neighbour heights) − vertex
   * height`. A positive `d` is a concavity (the vertex sits below its
   * surroundings → a valley/pit) and DARKENS; a negative `d` is a convexity (a
   * ridge/bump) and gently LIGHTENS. `aoScale` is the height delta (m) that
   * saturates the effect; the two strengths cap the multiplier at
   * `1 − aoDarken` (valleys) and `1 + aoLighten` (ridges). Pure & seam-safe
   * (same ±STEP taps on both sides of a shared edge).
   */
  aoScale: 2.2,
  aoDarken: 0.18,
  aoLighten: 0.06,

  /** Translucent water plane (two-tone: shallow near, deep far). */
  waterY: 0.05,
  waterSize: 2200,
  waterColor: 0x3a6b82,
  waterColorDeep: 0x244c63,
  waterOpacity: 0.8,
  /** Radial distance (m) over which the water fades shallow→deep tone. */
  waterToneRadius: 900,

  /**
   * Water 1.5 (F2 P2). The plane is subdivided (`waterSegments`) so a per-vertex
   * shore-fade alpha (baked from the seabed depth = `waterY − heightAt` at each
   * vertex, ramping 0→1 over `waterShoreFade` m of depth) softens the shoreline
   * instead of a hard cut. A Phong material carries a shader (onBeforeCompile)
   * that perturbs the surface normal with two scrolling procedural ripples
   * (amplitude `waterRippleAmp`, spatial freq `waterRippleFreq`, scroll speed
   * `waterRippleSpeed`) so the sun specular shimmers, plus a view-angle
   * (fresnel-ish) rim that lifts opacity at grazing angles by `waterFresnel`.
   * True reflections stay OFF (P3/high).
   */
  waterSegments: 128,
  waterShoreFade: 2.5,
  waterSpecular: 0x9fd8e8,
  waterShininess: 90,
  waterRippleAmp: 0.06,
  waterRippleFreq: 0.14,
  waterRippleSpeed: 0.8,
  waterFresnel: 0.28,

  /**
   * Optional directional shadow map (perf-gated in main.ts). A single tight
   * ortho frustum follows the player. Enabled at boot; if the measured average
   * fps over the first `shadowGateFrames` frames is below `shadowFpsGate`, it is
   * disabled for the session (SwiftShader/e2e falls under the gate → auto-off).
   */
  shadowMapSize: 1024,
  /** Ortho half-extent (m) → ~2× this metres of shadow coverage around the player. */
  shadowFrustum: 32,
  /** Distance (m) the shadow light sits from the player along the sun direction. */
  shadowLightDist: 110,
  /** Shadow camera near/far planes (m). */
  shadowNear: 1,
  shadowFar: 240,
  /** Small depth bias to curb shadow acne on the low-poly terrain. */
  shadowBias: -0.0006,
  /** Perf gate: measure this many frames after boot, disable shadows below the fps floor. */
  shadowGateFrames: 120,
  shadowFpsGate: 40,
} as const;

/**
 * Day/night cycle timing (seconds) and night look. Consumed by core/daylight.ts and world/environment.ts.
 */
export const DAYLIGHT = {
  /** Day phase duration (seconds). */
  dayS: 480,
  /** Dusk phase duration (seconds) — darkness ramps from 0 to 1. */
  duskS: 60,
  /** Night phase duration (seconds) — full darkness. */
  nightS: 240,
  /** Dawn phase duration (seconds) — darkness ramps from 1 to 0. */
  dawnS: 60,
  /** Night sky/fog/light targets, lerped by darkness. */
  night: {
    skyTop: 0x070d1f,
    skyMid: 0x101c38,
    skyHorizon: 0x1d2942,
    fogColor: 0x0d1424,
    fogNear: 110,
    fogFar: 720,
    sunIntensity: 0.22,
    sunColor: 0x9db4e0,
    hemiIntensity: 0.25,
    moonColor: 0xe8efff,
    moonSize: 46,
    starCount: 350,
    starSize: 1.5,
  },
} as const;

/**
 * Procedural critter animation tuning (critters/animation.ts). Pure math on
 * Object3D poses; gait/flap frequency and amplitude scale with move speed and
 * saturate at `speedCap` so sprints don't blur.
 */
export const ANIM = {
  /** Speed (m/s) above which a critter counts as "moving" (walk gait kicks in). */
  movingThreshold: 0.05,
  /** Speed (m/s) beyond which gait/flap scaling saturates. */
  speedCap: 10,

  /** Leg gait: frequency (Hz-ish) = base + speed * perSpeed; idle wobble rate. */
  gaitFreqBase: 4,
  gaitFreqPerSpeed: 0.9,
  gaitFreqIdle: 1.4,
  /** Leg swing amplitude (rad) = base + speed * perSpeed, clamped to max. */
  swingBase: 0.35,
  swingPerSpeed: 0.06,
  swingMax: 0.85,

  /** Body bob while moving: height (m) = base + speed * perSpeed, at stride rate. */
  bobBase: 0.02,
  bobPerSpeed: 0.004,
  /** Idle breathing bob: rate (rad/s) and amplitude (m). */
  idleBobFreq: 1.6,
  idleBobAmp: 0.012,

  /** Moving head bob amplitude (rad, at half stride rate). */
  headBobAmp: 0.05,
  /** Idle head glance (about Z) and nod (about X): rates (rad/s) + amplitudes (rad). */
  glanceFreq: 0.7,
  glanceAmp: 0.12,
  nodFreq: 0.5,
  nodAmp: 0.06,

  /** Tail sway amplitude (rad) moving / idle, at half stride rate. */
  tailMoveAmp: 0.25,
  tailIdleAmp: 0.12,

  /** Wing flap: frequency = base + speed * perSpeed; amplitude likewise; folded idle amp. */
  flapFreqBase: 14,
  flapFreqPerSpeed: 1.5,
  flapAmpBase: 0.5,
  flapAmpPerSpeed: 0.06,
  flapIdleAmp: 0.06,

  // --- Haven Village whimsy pass (per-species specials) ---------------------
  /** Prismhorse: extra phase (rad) added per leg index so the 16-leg gait reads
   *  as a wave skittering head→tail rather than a synchronised trot. */
  prismLegPhaseStep: 0.55,
  /** Prismhorse: base leg-wave amplitude (rad) even when barely moving. */
  prismLegAmp: 0.5,
  /** Prismhorse antennae: sway rate (rad/s) and amplitude (rad); a movement-lag
   *  term sweeps them back proportional to speed. */
  antennaSwayFreq: 3,
  antennaSwayAmp: 0.18,
  antennaLagPerSpeed: 0.06,
  /** Bumblewhale: gentle hover bob — rate (rad/s) and amplitude (m). Plus a
   *  lazy flipper flap (slow, small). */
  hoverBobFreq: 1.1,
  hoverBobAmp: 0.14,
  whaleFlapFreq: 2.2,
  whaleFlapAmp: 0.35,
  /** Snickerdoodle: flop period (s) per 180° flip and its base tumble amplitude. */
  flipPeriod: 0.5,
  /** Gloomgobbler: exaggerated slow stride — freq (Hz-ish) and amplitude (rad). */
  gloomStrideFreq: 2.2,
  gloomStrideAmp: 0.7,
} as const;

/**
 * Per-individual critter model variation (critters/models.ts): uniform scale
 * in [scaleMin, scaleMin + scaleRange) and slight per-part colour jitter so a
 * herd never looks cloned. Geometry dimensions/tessellation stay in models.ts
 * — they're shape definitions, not tuning.
 */
export const CRITTER_VARIATION = {
  scaleMin: 0.9,
  scaleRange: 0.2,
  /** Default hue jitter (fraction of the hue wheel) and lightness jitter. */
  hueJitter: 0.04,
  lightnessJitter: 0.08,
} as const;

/**
 * Critter AI (critters/ai.ts) + world manager (critters/manager.ts) tuning.
 * `stepAI` is a pure per-critter state machine (idle↔wander → alert → flee →
 * calm → wander); the manager streams deterministic per-cell spawn tables in
 * and out around the player. All timers in seconds, distances/speeds in m, m/s.
 */
export const AI = {
  /** Idle (graze) dwell before wandering: uniform in [idleMin, idleMax] (s). */
  idleMin: 2,
  idleMax: 5,
  /** Wander leg duration before settling back to idle (s). */
  wanderMin: 3,
  wanderMax: 6,
  /** A wander target is picked within this radius of `home` (m). */
  wanderRadius: 30,
  /** Max yaw turn rate (rad/s) — critters swing toward their heading gradually. */
  turnRate: 2.5,
  /** Alert dwell: freeze facing the player this long before fleeing (s). */
  alertTime: 0.8,
  /** Player must stay beyond awareness × this factor to start calming. */
  calmDistFactor: 1.6,
  /** …for this long (s) before flee → calm. */
  calmTriggerTime: 3,
  /** Calm (recover) dwell before returning to wander (s). */
  calmTime: 2,
  /** Gentle drift speed while calming (× species walkSpeed). */
  calmSpeedFactor: 0.35,

  /** Sprint flee: straight dash bursts of `sprintBurst` s split by `sprintPause` s. */
  sprintBurst: 1.2,
  sprintPause: 0.4,
  /** Zigzag flee: swerve angle (rad) flipped every `zigzagPeriod` s. */
  zigzagAngle: (55 * Math.PI) / 180,
  zigzagPeriod: 0.7,
  /** Fly flee: cruise altitude band above terrain (m), picked per-individual. */
  flyHeightMin: 10,
  flyHeightMax: 16,
  /** Low-hover flyers (bumblewhale) drift this far above terrain (m). */
  hoverHeightLow: 3,
  /** Vertical approach rate toward the target flight altitude (1/s lerp). */
  flyClimbRate: 1.5,
  /** Wide-arc yaw sweep rate while a flyer loops (rad/s). */
  flyArcRate: 0.55,
  /** Ledge flee: probe distance ahead (m) when sampling for higher ground. */
  ledgeProbe: 3,
  /** Swim flee: probe distance ahead (m) when steering toward water. */
  swimProbe: 4,
  /** Water surface Y for swimmers (matches ENV.waterY). */
  waterSurfaceY: 0.05,

  /**
   * Max ground slope a walker will climb; steeper steps are rejected and it
   * steers along the contour. Stored as the tangent of ~50°.
   */
  maxClimbTan: Math.tan((50 * Math.PI) / 180),
  /** Candidate yaw offsets (rad) scanned when a step is blocked (water/cliff). */
  avoidOffsets: [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6, Math.PI],

  /** Spawn-table cell edge (m). Each cell rolls 0–maxSlotsPerCell spawn slots. */
  cellSize: 128,
  maxSlotsPerCell: 3,
  /** Fraction of the cell a slot may jitter from centre (keeps it inside). */
  slotJitter: 0.42,
  /** Activate slots within this radius of the player (m). */
  activeRadius: 400,
  /** Deactivate beyond this radius (m) — hysteresis so streaming doesn't churn. */
  deactivateRadius: 450,
  /** Hard cap on concurrently-active critters (nearest kept). */
  maxActive: 70,
  /** Lumen stag only spawns in cells whose centre is beyond this from origin (m). */
  lumenMinDist: 500,
} as const;

/**
 * Tracker dart ballistics + tag/track loop (Task 10). A thrown dart launches
 * at `speed` along the camera look direction, falls under `gravity`, and dies
 * on ground contact or after `maxLife` seconds. A dart within a critter's
 * (species.size) sphere tags it; the player then stays within the species'
 * trackRadius for a cumulative trackTime to Link it (progress accrues at +dt
 * inside the ring, decays at −dt/2 outside).
 */
export const DART = {
  /** Muzzle speed along the look direction at throw (m/s). Crossbow-bolt
   *  fast — a flat, aimable shot rather than a lobbed ball. */
  speed: 55,
  /** Gravity on a dart in flight (m/s², negative = down). Deliberately light
   *  so the trajectory reads as a bolt with gentle drop, not an arc. */
  gravity: -9,
  /** Max time a dart lives before it despawns (s). */
  maxLife: 3,
  /** Trail: number of recent positions kept for the fading streak. */
  trailLength: 10,
} as const;

/** Tag-tracking progress tuning (tracking/progress.ts). */
export const TRACKING = {
  /** Progress decay rate outside the ring, as a fraction of the accrual rate. */
  trackDecayFactor: 0.5,
  /** Golden Dart Tip reward (Haven V4): inside-ring fill-rate multiplier. */
  goldenDartFill: 1.5,
} as const;

/**
 * Haven Village (Task V3): a fixed, seeded settlement in the NE spawn meadow.
 * `layout.ts` derives everything deterministically from WORLD_SEED: it snaps the
 * nominal centre to the flattest meadow pocket nearby (sampling `heightAt`), then
 * rings 5 buildings around a central plaza with dirt paths, lamp posts, a fenced
 * farm plot grid and a pen beside each home. All distances in metres, angles in
 * radians. Buildings/lamps become collision obstacles (buildings.ts).
 */
export const VILLAGE = {
  /** Nominal centre (m): NE of origin (+x East, −z North-ish per atan2(z,x)). */
  nominalCenter: { x: 40, z: -40 },
  /** Half-extent (m) of the flattest-pocket search box around the nominal centre. */
  searchRadius: 80,
  /** Coarse grid step (m) for the flatness search. */
  searchStep: 8,
  /** Footprint half-window (m) sampled for local height variance at a candidate. */
  flatWindow: 24,
  /** Samples per axis over the flat window (variance stencil resolution). */
  flatSamples: 5,
  /** Max acceptable height range (m) over the footprint — verified per building. */
  flatThreshold: 3.0,
  /** Village influence radius (m): inVillage() + (future) spawn exclusion. */
  radius: 55,
  /** Building ring radius (m) from the plaza centre. */
  ringRadius: 16,
  /** Central plaza radius (m). */
  plazaRadius: 6,
  /** Seeded placement jitter caps (radians / m) — small, so nothing overlaps. */
  angleJitter: 0.08,
  radiusJitter: 1.0,
  /** Min AABB gap (m) enforced/verified between building footprints. */
  overlapMargin: 1.0,
  /** Building footprints (m): width (along local X) × depth (along local Z). */
  footprints: {
    farmhouse: { w: 8, d: 6 },
    barter: { w: 5, d: 4 },
    home: { w: 4.2, d: 4 },
  },
  /** Wall height (m) per building kind (roof sits on top). */
  wallHeight: { farmhouse: 3.4, barter: 3.0, home: 2.8 },
  /** Lamp posts: count ringed around the plaza + their ring radius (m) & height (m). */
  lampCount: 6,
  lampRadius: 9.5,
  lampHeight: 3.2,
  /** Farm plot grid beside the farmhouse. */
  farm: {
    /** Outward offset (m) of the grid centre from the farmhouse centre. */
    offset: 8.5,
    cols: 3,
    rows: 2,
    /** Centre-to-centre plot spacing (m). */
    spacing: 2.4,
    /** Plot tile size (m). */
    tile: 1.8,
    /** Plots unlocked at the start (rest emitted but locked). */
    unlocked: 2,
    /** Fence margin (m) around the plot grid bounding box. */
    fenceMargin: 1.4,
  },
  /** Pen beside each home (traded critters live here — Task V4). */
  pen: { w: 4, d: 3, gap: 1.4 },
  /** Warm procedural building palette (hex) — flat-shaded Lambert. */
  colors: {
    farmhouseWall: 0xcaa87a,
    barterWall: 0xbf9d6a,
    homeWall: 0xc0a488,
    roofFarmhouse: 0x9c4b34,
    roofBarter: 0x7a5a3a,
    roofHome: 0x8a5230,
    door: 0x5a3b26,
    window: 0x8fd0e0,
    trim: 0x6b4a2f,
    lampPost: 0x3f3630,
    lampHead: 0xffd27a,
    fence: 0x7a5a3a,
    plaza: 0xbcae8f,
    path: 0xb0a17c,
    penPost: 0x6b5236,
    plot: 0x6a4a30,
    plotLocked: 0x554738,
  },
} as const;

/**
 * Farm (Task V5). Pure production/aura/hopper math lives in `src/farm/farm.ts`;
 * these are its only tuning knobs (project convention: never inline). Plots are
 * 2 at baseline + 2 per Plot Deed (spec §4), capped at `maxPlots`. An assigned
 * produce-role critter accrues `producePeriod` seconds of progress (scaled by
 * adjacent speed auras) then drops `amount` of its resource into the plot hopper
 * (total capped at `hopperCap`, +`bumblewhaleHopperBonus` when an adjacent plot
 * hosts a bumblewhale). Adjacency is true 2D grid adjacency among unlocked plots
 * (row-major over the VILLAGE.farm cols×rows grid: same row ±1 column or same
 * column ±1 row — no diagonals, no row-wrap pairs), computed in farm.ts.
 */
export const FARM = {
  /** Plots unlocked with zero deeds (spec §4: "2 plots at start"). */
  basePlots: 2,
  /** Extra plots unlocked per Plot Deed reward. */
  plotsPerDeed: 2,
  /** Hard cap on total farm plots. */
  maxPlots: 6,
  /** Seconds of accrued (speed-scaled) progress per production cycle. */
  producePeriod: 90,
  /** Max total items a single plot hopper holds before production stalls. */
  hopperCap: 10,
  /** Cap on the summed speed-aura bonus (spec §4: "cap +50%"). */
  speedCapBonus: 0.5,
  /** Hopper-cap bump granted by each adjacent bumblewhale (hopperCap aura). */
  bumblewhaleHopperBonus: 1,
  // --- visuals (farm/visuals.ts) --------------------------------------------
  /** Scale applied to the buildCritterModel puppet standing on an assigned plot. */
  puppetScale: 0.7,
  /** Hopper indicator: one small cube per this many items in the hopper. */
  itemsPerCube: 2,
  /** Hopper indicator cube edge (m) and vertical gap between stacked cubes. */
  cubeSize: 0.22,
  cubeGap: 0.28,
  /** Height (m) the hopper cube stack floats above a plot corner. */
  hopperFloat: 1.4,
  /** Horizontal distance (m) to harvest a plot hopper with F. */
  collectRange: 3,
  /** Faded "deed" sign for a locked plot: post height + board size (m). */
  signPostH: 1.1,
  signBoardW: 0.7,
  signBoardH: 0.5,
  /** Per-resource hopper-cube colours (hex), matching the world palette. */
  cubeColors: {
    fiber: 0xbcae6b,
    resin: 0xe0932a,
    shard: 0xb07fe0,
    spark: 0xffe06a,
    // Mushrooms aren't farmable (forage-only) but ResourceKind is exhaustive
    // here — reuse the mushroom cap colour so this compiles meaningfully.
    mushroom: 0x9c5bd0,
  },
} as const;

/**
 * Prismhorse mount tuning (Haven V6) — m, m/s, m/s², s. Consumed by the pure
 * ride core (`src/player/mount.ts` mountStep/canMount) and the actor owner
 * (`src/player/mount-system.ts`). Turning is camera-yaw driven exactly like
 * walking (no separate steer rate); `turnRate` only smooths the *model's*
 * visual facing toward the camera yaw.
 */
export const MOUNT = {
  /** Target ground speed while ridden (m/s). Planar accel converges here. */
  speed: 15,
  /** Planar acceleration toward the target (m/s²). */
  accel: 30,
  /** Vertical takeoff speed for a mount jump (m/s). */
  jumpVel: 11,
  /** Rad/s the actor model lerps its yaw toward the camera (visual only). */
  turnRate: 7,
  /** Camera is raised this far (m) above the normal eye height while riding. */
  eyeHeightBonus: 1.1,
  /** The mount refuses to move into terrain below this height (m) — deep water. */
  waterBlockDepth: -0.5,
  /** Hold Space this long (s) while riding to dismount (KeyV also dismounts). */
  dismountHold: 0.5,
  /** Upward hop (m/s) added on dismount so hopping off flows, never dead-stops. */
  dismountHop: 2,
  /** Seconds the camera lerps from the mounted eye height down to the normal eye. */
  dismountEyeLerp: 0.25,
  /** Side offset (m) the dismount places the player beside the mount (clears the collider). */
  dismountOffset: 1.9,
  /** Walk within this distance (m) of your idle mount to mount up with KeyV. */
  mountRange: 4,
  /** The idle actor loosely follows the player and never lags beyond this (m). */
  followRange: 30,
  /** Idle-follow ground speed (m/s) — a lazy trail behind the player. */
  followSpeed: 7,
  /** Standoff distance (m) the idle actor keeps from the player while following. */
  followStandoff: 3,
  /**
   * While riding, the model sits this far (m) ahead of the camera along the
   * heading: the rider sits above/behind mid-body looking over the head. Must
   * clear the model's rearward rump/dorsal-ridge crystals (local z −0.15..−0.78
   * at radius ~0.35–0.6, ×1.1 max individual scale) so the crest never wraps
   * the eye.
   */
  rideForwardOffset: 2.0,
  /**
   * Camera-proximity fade net: any mount mesh whose origin comes within
   * `fadeFar` of the camera fades out (opacity lerp, fully transparent by
   * `fadeNear`); originals restored on dismount. Keeps the view legible even
   * when terrain/turning momentarily swings a crystal through the eye.
   */
  fadeNear: 0.35,
  fadeFar: 0.8,
} as const;

/**
 * Player starting loadout (Task 14). Applied by main.ts only on a brand-new
 * game (no valid save present, or `?fresh=1`) — a loaded save's own inventory
 * counts always win, and `createInventory()` itself stays a pure zero ctor
 * (tests treat it as the empty-inventory constructor).
 */
export const PLAYER_START = {
  /** Tracker darts granted at the very start of a fresh game. */
  startingDarts: 4,
} as const;
