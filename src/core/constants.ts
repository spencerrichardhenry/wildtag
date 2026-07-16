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
 * Grapple hook (Task 12). The rope is a soft *spring* constraint the controller
 * post-processes onto the movement core's velocity each step (the pure core is
 * grapple-agnostic). Distances in m, speeds m/s; `stiffness` is inward accel
 * (m/s²) per metre of overstretch; `radialDamping` is the fraction of the
 * remaining (inward) radial velocity bled off per step; costs in stamina/s;
 * times in s.
 */
export const GRAPPLE = {
  /** Max fire distance (m); hits beyond this are rejected. */
  maxRange: 45,
  /** Rope shorten rate while reeling (m/s). */
  reelSpeed: 12,
  /** Stamina drained per second while reeling. */
  reelCostPerS: 15,
  /** Auto-release once the rope reels below this length (m). */
  minLength: 2.5,
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
  /** Terrain ray-march: distance (m) stepped per sample against heightAt. */
  marchStep: 0.75,
  /** Bisection refinement passes after a terrain-march bracket is found. */
  marchRefine: 4,
  /** Segment samples between player and anchor for the occlusion test. */
  occlusionSamples: 8,
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
  droneAnchorRadius: 1.2,
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
  /** Vertices per chunk edge (so `verts - 1` quads span `size` metres). */
  verts: 33,
  /** Keep-resident radius in chunks (Chebyshev) around the player. */
  radius: 7,
  /** Max chunk meshes built per `update()` call, to avoid frame hitches. */
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
  radius: 5,
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
   * Per-biome scatter table: ordered cumulative roll thresholds. A sub-cell's
   * roll r in [0,1) picks the first entry with r < p; if it exceeds every
   * threshold the sub-cell stays empty. Tuned so a solid forest chunk yields
   * ~14 trees (0.22 × 64), meadow ~14 flowers + ~10 fiber, etc.
   */
  biomeScatter: {
    meadow: [
      { kind: 'flower', p: 0.22 },
      { kind: 'fiber', p: 0.38 },
    ],
    forest: [
      { kind: 'tree', p: 0.22 },
      { kind: 'flower', p: 0.27 },
    ],
    wetland: [
      { kind: 'flower', p: 0.2 },
      { kind: 'fiber', p: 0.4 },
    ],
    crags: [
      { kind: 'rock', p: 0.18 },
      { kind: 'crystal', p: 0.28 },
      { kind: 'shard', p: 0.34 },
    ],
    highlands: [
      { kind: 'rock', p: 0.16 },
      { kind: 'crystal', p: 0.26 },
      { kind: 'shard', p: 0.32 },
    ],
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
  },

  /** Collision-cylinder radius factor (× scale) for blocking props. */
  obstacleRadius: { tree: 0.5, rock: 0.9 },

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
  },
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
  /** Muzzle speed along the look direction at throw (m/s). */
  speed: 28,
  /** Gravity on a dart in flight (m/s², negative = down). */
  gravity: -24,
  /** Max time a dart lives before it despawns (s). */
  maxLife: 3,
  /** Trail: number of recent positions kept for the fading streak. */
  trailLength: 10,
} as const;

/** Tag-tracking progress tuning (tracking/progress.ts). */
export const TRACKING = {
  /** Progress decay rate outside the ring, as a fraction of the accrual rate. */
  trackDecayFactor: 0.5,
} as const;
