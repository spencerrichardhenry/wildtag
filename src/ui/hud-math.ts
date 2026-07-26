import type { SpeciesDef, Vec3 } from '../core/types.ts';
import type { CritterView } from '../critters/manager.ts';

// ---------------------------------------------------------------------------
// Pure HUD geometry (Task 11). No three, no DOM — every three.js dependency is
// injected as a callback so this module stays unit-testable in Node. The HUD
// DOM layer (hud.ts) consumes these results and maps the normalised device
// coordinates (NDC, [-1, 1] with +y up) they return onto pixels.
// ---------------------------------------------------------------------------

/** Tuning for the on-screen HUD geometry (compass span, ring reach). */
export const HUD = {
  /** Only draw tracking rings for critters within this distance (m). */
  ringMaxDist: 120,
  /** Angular span (deg) the compass strip covers edge-to-edge. */
  compassSpanDeg: 150,
  /** Compass tick spacing (deg); every 45° gets an N/E/S/W/NE… label. */
  compassTickStepDeg: 15,
  /** Critter head offset above its feet position, as a factor of species size. */
  ringHeadFactor: 1.2,
  /** Number of selectable hotbar slots (Cursed Castle Task 13 added Purify). */
  hotbarSlots: 5,
} as const;

/** A projected point in normalised device coordinates ([-1, 1], +y up). */
export interface Projected {
  x: number;
  y: number;
  /** True when the world point is behind the camera (NDC is then unreliable). */
  behind: boolean;
}

/** Injected world→NDC projector (closes over the three camera in hud.ts). */
export type ProjectFn = (world: Vec3) => Projected;

/** Clamp `v` to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Validate a requested hotbar slot: `slot` is accepted (returned as-is) when
 * it falls within [1, max]; otherwise `null` (the request is ignored).
 * Extracted from `HUD.selectHotbar` so the clamp is unit-testable without DOM
 * (mirrors `EdgeLatch`'s extraction from `Input`).
 */
export function clampHotbarSlot(slot: number, max: number = HUD.hotbarSlots): number | null {
  return slot >= 1 && slot <= max ? slot : null;
}

/** Wrap `deg` into (-180, 180]. */
export function wrap180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d <= -180) d += 360;
  return d;
}

/** Normalise `deg` into [0, 360). */
export function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Compass bearing (deg, 0=N, 90=E, 180=S, 270=W) the camera faces for a given
 * mouse `yaw` (radians). yaw=0 looks down -Z (== North); +X is East. The
 * camera forward is (-sin yaw, 0, -cos yaw), so bearing = -yaw.
 */
export function facingBearingDeg(yaw: number): number {
  return mod360((-yaw * 180) / Math.PI);
}

/** Compass bearing (deg) of a world direction (dx, dz): +X East, -Z North. */
export function worldBearingDeg(dx: number, dz: number): number {
  return mod360((Math.atan2(dx, -dz) * 180) / Math.PI);
}

/**
 * Where a world `bearing` sits on a `width`-px compass strip whose centre is
 * the camera `facing` bearing, spanning `spanDeg` edge-to-edge. `visible` is
 * false once the bearing falls outside the strip's angular window.
 */
export function bearingToStripX(
  bearing: number,
  facing: number,
  width: number,
  spanDeg: number,
): { x: number; visible: boolean } {
  const delta = wrap180(bearing - facing);
  const x = width / 2 + (delta / spanDeg) * width;
  return { x, visible: Math.abs(delta) <= spanDeg / 2 };
}

/** One compass tick: its bearing, x on the strip, and (for majors) a label. */
export interface CompassTick {
  deg: number;
  x: number;
  label: string;
  major: boolean;
}

/** Bearing (deg) → cardinal/intercardinal label for the 45° major ticks. */
export const CARDINALS: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/**
 * Visible compass ticks for a camera `yaw` on a `width`-px strip. Ticks sit
 * every `stepDeg`; a tick on a 45° boundary is a `major` and carries an
 * N/E/S/W/NE… label. Only ticks inside the strip's span are returned.
 */
export function compassTicks(
  yaw: number,
  width: number,
  spanDeg: number = HUD.compassSpanDeg,
  stepDeg: number = HUD.compassTickStepDeg,
): CompassTick[] {
  const facing = facingBearingDeg(yaw);
  const out: CompassTick[] = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const { x, visible } = bearingToStripX(deg, facing, width, spanDeg);
    if (!visible) continue;
    const major = deg % 45 === 0;
    out.push({ deg, x, label: major ? (CARDINALS[deg] ?? '') : '', major });
  }
  return out;
}

/** Screen placement for one critter's tracking ring. */
export interface RingState {
  /** NDC x ([-1, 1]); when offscreen this is clamped to the edge box. */
  x: number;
  /** NDC y ([-1, 1], +y up); clamped to the edge box when offscreen. */
  y: number;
  /** True when the critter projects inside the viewport. */
  onScreen: boolean;
  /** Tracking progress fraction in [0, 1]. */
  pct: number;
  /** True while the player is within the species' track radius. */
  inRadius: boolean;
  /** 3D player↔critter distance (m). */
  dist: number;
}

/**
 * HP bar hide-eligibility (Cursed Castle spec §4 / final-review fix): the bar
 * is otherwise eligible to auto-hide (after `HEALTH.barLingerS`, handled by
 * the caller's own timer) only when HP is full, the player isn't dazed, AND
 * they aren't standing in the castle's night "danger zone" — so the bar stays
 * up at full HP while `dangerZone` is true (a live threat, even before any
 * damage lands), and still lingers `barLingerS` after leaving before hiding.
 * Pure — the timer/`performance.now()` bookkeeping stays in hud.ts.
 */
export function healthBarHideEligible(full: boolean, dazed: boolean, dangerZone: boolean): boolean {
  return full && !dazed && !dangerZone;
}

/**
 * Screen state for a tagged critter's tracking ring. Projects a point above
 * the critter's head via `projectFn`; if it lands offscreen (or behind the
 * camera) the returned x/y is clamped onto the [-1, 1] edge box so the HUD can
 * draw an edge arrow pip pointing at it. Pure — the only three dependency is
 * the injected `projectFn`.
 */
export function ringScreenState(
  view: CritterView,
  sp: SpeciesDef,
  playerPos: Vec3,
  projectFn: ProjectFn,
): RingState {
  const head: Vec3 = {
    x: view.pos.x,
    // Anchor at the per-species model-height estimate when supplied, else the
    // size-based default — so tall species (stag/buck/prismhorse) ring high.
    y: view.pos.y + (sp.ringHeight ?? sp.size * HUD.ringHeadFactor),
    z: view.pos.z,
  };
  const p = projectFn(head);

  const dx = view.pos.x - playerPos.x;
  const dy = view.pos.y - playerPos.y;
  const dz = view.pos.z - playerPos.z;
  const dist = Math.hypot(dx, dy, dz);

  const pct = clamp(sp.trackTime > 0 ? view.trackProgress / sp.trackTime : 1, 0, 1);
  const inRadius = dist <= sp.trackRadius;

  let x = p.x;
  let y = p.y;
  // A point behind the camera has mirrored NDC — flip it so the edge pip
  // points the correct way, then treat it as offscreen.
  if (p.behind) {
    x = -x;
    y = -y;
  }

  const onScreen = !p.behind && x >= -1 && x <= 1 && y >= -1 && y <= 1;
  if (!onScreen) {
    const m = Math.max(Math.abs(x), Math.abs(y), 1e-6);
    x /= m;
    y /= m;
  }

  return { x, y, onScreen, pct, inRadius, dist };
}
