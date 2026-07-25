import { HEALTH } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Player HP (Cursed Castle Task 6). Pure state + transitions — no three
// import, no damage sources yet (goblins arrive in Task 11, which will call
// `applyHit`). `main.ts` owns one `HealthState` and steps it each frame;
// the HUD renders it via a cloned stamina-bar pattern.
// ---------------------------------------------------------------------------

/** Player health snapshot. `sinceHit` (s) drives the regen delay gate. */
export interface HealthState {
  hp: number;
  /** Seconds since the last hit (Infinity if never hit / fully recovered). */
  sinceHit: number;
  /** Seconds remaining in the post-death stumble; > 0 while dazed. */
  dazedFor: number;
}

/** Full health, undazed, never hit. */
export function createHealth(): HealthState {
  return { hp: HEALTH.max, sinceHit: Infinity, dazedFor: 0 };
}

export function isDazed(h: HealthState): boolean {
  return h.dazedFor > 0;
}

/**
 * Apply damage. Pure — returns a new state (or the same one, ignored, while
 * dazed). HP floors at 0; hitting 0 starts the daze window.
 */
export function applyHit(h: HealthState, dmg: number): HealthState {
  if (isDazed(h)) return h; // invulnerable while dazed
  const hp = Math.max(0, h.hp - dmg);
  const dazedFor = hp <= 0 ? HEALTH.dazedS : h.dazedFor;
  return { hp, sinceHit: 0, dazedFor };
}

/**
 * Advance one frame: ticks the daze timer down (refilling to full HP the
 * instant it ends) and, once undazed, regenerates HP at `HEALTH.regenPerS`
 * for whatever portion of `dt` falls after `HEALTH.regenDelayS` has elapsed
 * since the last hit — so a step that straddles the delay boundary still
 * credits partial regen instead of an all-or-nothing cliff.
 */
export function stepHealth(h: HealthState, dt: number): HealthState {
  if (h.dazedFor > 0) {
    const dazedFor = Math.max(0, h.dazedFor - dt);
    if (dazedFor <= 0) return createHealth(); // daze over: refill to full
    return { hp: h.hp, sinceHit: h.sinceHit + dt, dazedFor };
  }

  const sinceHit = h.sinceHit + dt;
  const overDelay = Math.max(0, Math.min(dt, sinceHit - HEALTH.regenDelayS));
  const hp = Math.min(HEALTH.max, h.hp + overDelay * HEALTH.regenPerS);
  return { hp, sinceHit, dazedFor: 0 };
}
