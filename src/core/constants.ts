// All tuning constants live here — never inline elsewhere.

/** Single seed driving all deterministic world generation / PRNG. */
export const WORLD_SEED = 1337;

/** Fixed simulation timestep (seconds) for the accumulator-driven game loop. */
export const SIM_DT = 1 / 60;

/** Clamp on per-frame delta (seconds) so long stalls don't spiral the accumulator. */
export const MAX_FRAME_DT = 0.1;

/** Player camera projection parameters. */
export const CAMERA = { fov: 75, near: 0.1, far: 1200 };
