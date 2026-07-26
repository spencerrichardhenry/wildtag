import { CASTLE, GOBLIN, WORLD_SEED } from '../core/constants.ts';
import type { DayPhase } from '../core/daylight.ts';
import { resolveCollision, type Obstacle } from '../player/collision.ts';
import { mulberry32 } from '../core/rng.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { inCastleRegion } from './layout.ts';

// ---------------------------------------------------------------------------
// Night goblin AI — a pure, deterministic per-goblin state machine (Cursed
// Castle Task 11). Goblins are NOT critters: no `CritterState`/`stepAI` reuse,
// no bond/track interplay — just patrol → notice → chase → windup → lunge →
// recover, always leashed inside `CASTLE.regionR`.
//
//   patrol ──(player ≤ noticeR)──▶ alert ──(alertS, freeze+face)──▶ chase
//     ▲                                                               │
//     │ (giveUpR / player leaves region)                    (≤ lungeRange)
//     │                                                               ▼
//   recover ◀──(recoverS)── lunge ◀──(windupS, fixed direction)── windup
//
// `stepGoblin` returns a NEW GoblinState (never mutates its input) plus
// whether this step's lunge just connected (`hitPlayer`, fired at most once
// per lunge via edge detection — see the movement block below). Every step
// re-clamps the goblin's (x, z) onto `CASTLE.regionR` around `CASTLE.center`,
// so leaving the region is structurally impossible regardless of phase.
// ---------------------------------------------------------------------------

export type GoblinPhase = 'patrol' | 'alert' | 'chase' | 'windup' | 'lunge' | 'recover';

export interface GoblinState {
  id: number;
  pos: Vec3;
  yaw: number;
  phase: GoblinPhase;
  /** Seconds elapsed in the current phase (reset to 0 on every transition). */
  phaseT: number;
  /** Patrol anchor — the goblin's spawn point. */
  home: Vec3;
}

export interface GoblinCtx {
  playerPos: Vec3;
  ground: GroundQuery;
  /** Deterministic PRNG in [0,1); reserved for future patrol variety. */
  rand: () => number;
  /**
   * Castle wall/tower/keep collision circles (final-review fix): when given,
   * every step's resulting (x, z) is pushed out of any overlapping obstacle
   * via `resolveCollision`, so goblins can't ghost through the curtain wall
   * or keep (the gate/keep-entrance gaps stay open since those obstacle sets
   * already leave them uncovered — see `castleObstacles()`). Optional so the
   * FSM stays testable with a custom obstacle set, or none at all.
   */
  obstacles?: Obstacle[];
}

export interface GoblinStep {
  g: GoblinState;
  hitPlayer: boolean;
}

/** Fresh goblin at `home`, patrolling, facing +Z. */
export function makeGoblin(id: number, home: Vec3): GoblinState {
  return { id, pos: { ...home }, yaw: 0, phase: 'patrol', phaseT: 0, home: { ...home } };
}

/** Radially clamp (x, z) to within `maxR` of (cx, cz); no-op if already inside. */
function clampRadius(x: number, z: number, cx: number, cz: number, maxR: number): { x: number; z: number } {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= maxR || d < 1e-9) return { x, z };
  const k = maxR / d;
  return { x: cx + dx * k, z: cz + dz * k };
}

/** Advance one goblin by `dt`. Pure: returns a new state, never mutates `g`. */
export function stepGoblin(g: GoblinState, ctx: GoblinCtx, dt: number): GoblinStep {
  const out: GoblinState = { ...g, pos: { ...g.pos }, home: { ...g.home } };
  out.phaseT = g.phaseT + dt;

  const dx = ctx.playerPos.x - g.pos.x;
  const dz = ctx.playerPos.z - g.pos.z;
  const playerDist = Math.hypot(dx, dz);
  const towardYaw = Math.atan2(dx, dz);
  const playerOutsideRegion = !inCastleRegion(ctx.playerPos.x, ctx.playerPos.z);

  // --- 1. Decide phase transitions (no movement here) ----------------------
  switch (g.phase) {
    case 'patrol':
      if (playerDist <= GOBLIN.noticeR) {
        out.phase = 'alert';
        out.phaseT = 0;
        out.yaw = towardYaw;
      }
      break;

    case 'alert':
      out.yaw = towardYaw;
      if (out.phaseT >= GOBLIN.alertS) {
        out.phase = 'chase';
        out.phaseT = 0;
      }
      break;

    case 'chase':
      if (playerDist > GOBLIN.giveUpR || playerOutsideRegion) {
        out.phase = 'patrol';
        out.phaseT = 0;
      } else if (playerDist <= GOBLIN.lungeRange) {
        out.phase = 'windup';
        out.phaseT = 0;
        out.yaw = towardYaw;
      }
      break;

    case 'windup':
      // Keep tracking the player right up to the hop; the LAST bearing
      // written here becomes the lunge's fixed direction.
      out.yaw = towardYaw;
      if (out.phaseT >= GOBLIN.windupS) {
        out.phase = 'lunge';
        out.phaseT = 0;
      }
      break;

    case 'lunge':
      if (out.phaseT >= GOBLIN.lungeS) {
        out.phase = 'recover';
        out.phaseT = 0;
      }
      break; // yaw untouched — the lunge direction stays fixed throughout.

    case 'recover':
      if (out.phaseT >= GOBLIN.recoverS) {
        out.phase = playerDist <= GOBLIN.giveUpR && !playerOutsideRegion ? 'chase' : 'patrol';
        out.phaseT = 0;
      }
      break;
  }

  // --- 2. Movement + hit detection for the (possibly just-entered) phase ---
  let hitPlayer = false;
  if (out.phase === 'patrol') {
    // Slow circling wander around home: a steadily turning heading, stepped
    // forward and radially clamped to patrolR — settles into a loop.
    const angularSpeed = GOBLIN.patrolSpeed / Math.max(GOBLIN.patrolR, 1);
    const yaw = g.yaw + angularSpeed * dt;
    const nx = g.pos.x + Math.sin(yaw) * GOBLIN.patrolSpeed * dt;
    const nz = g.pos.z + Math.cos(yaw) * GOBLIN.patrolSpeed * dt;
    const clamped = clampRadius(nx, nz, g.home.x, g.home.z, GOBLIN.patrolR);
    out.pos.x = clamped.x;
    out.pos.z = clamped.z;
    out.yaw = yaw;
  } else if (out.phase === 'chase') {
    out.yaw = towardYaw;
    const step = GOBLIN.chaseSpeed * dt;
    out.pos.x = g.pos.x + Math.sin(out.yaw) * step;
    out.pos.z = g.pos.z + Math.cos(out.yaw) * step;
  } else if (out.phase === 'lunge') {
    const step = GOBLIN.lungeSpeed * dt;
    out.pos.x = g.pos.x + Math.sin(out.yaw) * step;
    out.pos.z = g.pos.z + Math.cos(out.yaw) * step;

    const newDist = Math.hypot(ctx.playerPos.x - out.pos.x, ctx.playerPos.z - out.pos.z);
    const wasLunging = g.phase === 'lunge';
    if (!wasLunging) {
      // Just entered the lunge this step (windup → lunge): fire immediately
      // if already within range (a player parked very close at windup end).
      hitPlayer = newDist <= GOBLIN.hitRange;
    } else {
      // Continuing an existing lunge: fire only on the step the distance
      // CROSSES into range, so a hop that stays close for several frames
      // still reports exactly one hit.
      const prevDist = Math.hypot(ctx.playerPos.x - g.pos.x, ctx.playerPos.z - g.pos.z);
      hitPlayer = prevDist > GOBLIN.hitRange && newDist <= GOBLIN.hitRange;
    }
  }
  // alert / windup / recover: hold position (already cloned above).

  // --- 2b. Wall/tower/keep collision (final-review fix) ---------------------
  // Applies uniformly to whatever step 2 just produced — patrol drift, chase
  // pursuit, or a lunge hop alike — so a lunge through a wall line is clamped
  // at the rim exactly like every other movement. `pos.y` at the PREVIOUS
  // ground height is a fine probe for the yTop glide-over check: goblins
  // never leave ground level, so it tracks the new (x, z)'s height closely
  // enough over one step.
  if (ctx.obstacles && ctx.obstacles.length > 0) {
    const probe = resolveCollision({ x: out.pos.x, y: g.pos.y, z: out.pos.z }, GOBLIN.bodyR, ctx.obstacles);
    out.pos.x = probe.x;
    out.pos.z = probe.z;
  }

  // --- 3. Invariants: ground truth + never leave the castle region ----------
  const clampedXZ = clampRadius(out.pos.x, out.pos.z, CASTLE.center.x, CASTLE.center.z, CASTLE.regionR);
  out.pos.x = clampedXZ.x;
  out.pos.z = clampedXZ.z;
  out.pos.y = ctx.ground.heightAt(out.pos.x, out.pos.z);

  return { g: out, hitPlayer };
}

/**
 * Deterministic ring spawn positions for night `nightIndex` (0-based, one per
 * spawned night): `count` points at radius [30, 60] around `CASTLE.center` —
 * inside `CASTLE.regionR` (130) and clear of the keep (half-diagonal ~14 m).
 * Seeded by `mulberry32(WORLD_SEED ^ nightIndex)` so the same night always
 * reproduces the same ring. `y` is a placeholder (the castle pad height,
 * accurate for this radius band); `CastleSystem` resolves the real ground
 * height via `GroundQuery.heightAt` when it actually spawns a goblin there.
 */
export function goblinSpawnPoints(nightIndex: number, count: number): Vec3[] {
  const rand = mulberry32((WORLD_SEED ^ nightIndex) >>> 0);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 30 + rand() * 30; // [30, 60]
    out.push({
      x: CASTLE.center.x + Math.sin(ang) * r,
      y: CASTLE.padHeight,
      z: CASTLE.center.z + Math.cos(ang) * r,
    });
  }
  return out;
}

/**
 * Should goblins be present right now? True whenever the castle isn't
 * purified and the phase is dusk or night — a presence check (not just a
 * dusk-edge trigger) so a save loaded mid-night, or `setTimeOfDay('night')`
 * jumping straight past dusk, still spawns goblins the very next update
 * (Task 14 preview: purifying the castle stops all future spawns).
 */
export function shouldSpawnGoblins(purified: boolean, phase: DayPhase): boolean {
  return !purified && (phase === 'dusk' || phase === 'night');
}
