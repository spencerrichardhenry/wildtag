import { AI } from '../core/constants.ts';
import type { Biome, CritterState, GroundQuery, SpeciesDef, Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Critter AI — a pure, deterministic per-critter state machine.
//
// `stepAI(c, ctx, dt)` returns a NEW CritterState (never mutates its input) so
// it stays referentially transparent and trivially testable. The machine is:
//
//   idle ⇄ wander            (timed dwell; wander walks toward a point near home)
//     │  (player ≤ awareness, species flees, not linked)
//     ▼
//   alert  ── AI.alertTime ─▶ flee ── player far AI.calmTriggerTime ─▶ calm
//                              │                                        │
//                              └── (flee style: sprint/zigzag/fly/       └─ AI.calmTime ─▶ wander
//                                   swim/ledge steering) ──────────────┘
//
// Locomotion is shared: every state sets a desired heading + target ground
// speed, then a common step turns the yaw (rate-limited), rejects steps that
// would enter water (land species) or climb too-steep ground, snaps y to the
// terrain (flyers cruise at flightHeight; swimmers to the water surface), and
// writes vel = displacement / dt for the animation layer.
// ---------------------------------------------------------------------------

export interface AIContext {
  playerPos: Vec3;
  species: SpeciesDef;
  ground: GroundQuery;
  biomeAt: (x: number, z: number) => Biome;
  /** Deterministic PRNG in [0,1); consumed only on state entry (re-rolling dwell/target). */
  rand: () => number;
}

const TWO_PI = Math.PI * 2;

/** Heading yaw for a +Z-forward model pointing along (dx, dz). */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Smallest signed difference a-b wrapped to [-PI, PI]. */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

function clone(c: CritterState): CritterState {
  return {
    ...c,
    pos: { ...c.pos },
    vel: { ...c.vel },
    home: { ...c.home },
  };
}

function randRange(rand: () => number, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

/** Pick a fresh wander target near home and return the heading toward it. */
function pickWanderYaw(c: CritterState, rand: () => number): number {
  const ang = rand() * TWO_PI;
  const rad = rand() * AI.wanderRadius;
  const tx = c.home.x + Math.cos(ang) * rad;
  const tz = c.home.z + Math.sin(ang) * rad;
  return yawTo(tx - c.pos.x, tz - c.pos.z);
}

/**
 * Design note (Task 10): the gargoyle reuses the existing idle/wander/alert/
 * flee/calm state enum rather than adding a `'perch'` CritterState.state
 * member. Its perched behaviour is entirely gated on `sp.fleeStyle ===
 * 'perch'` inside the relevant cases below plus the shared `locomote` — a
 * smaller surface than a new state would need (no new arm in every switch
 * that matches on `.state`, e.g. animation/manager code elsewhere).
 */

/**
 * Advance one critter by `dt`. Pure: returns a new state, never mutates `c`.
 */
export function stepAI(c: CritterState, ctx: AIContext, dt: number): CritterState {
  const out = clone(c);
  const sp = ctx.species;
  out.stateTime += dt;

  const dx = ctx.playerPos.x - c.pos.x;
  const dz = ctx.playerPos.z - c.pos.z;
  const dist = Math.hypot(dx, dz);
  const towardYaw = yawTo(dx, dz);
  const awayYaw = yawTo(-dx, -dz);

  // Linked critters (permanently calm) and fleeStyle:'none' species never
  // alert or flee — they only ever idle/wander.
  // Bold species (birds etc.) don't care about the player until a tracker is
  // on their back; skittish ones alert at awareness regardless.
  const canFlee = sp.fleeStyle !== 'none' && !c.linked && (!sp.bold || c.tagged);

  // Desired heading + target ground speed produced by the active state.
  let desiredYaw = c.yaw;
  let speed = 0;

  const perch = sp.fleeStyle === 'perch';

  switch (c.state) {
    case 'idle': {
      speed = 0;
      if (canFlee && dist <= sp.awareness) {
        enter(out, 'alert', ctx.rand, sp);
      } else if (out.stateTime >= c.stateDur) {
        enter(out, 'wander', ctx.rand, sp);
        out.targetYaw = perch ? ctx.rand() * TWO_PI : pickWanderYaw(out, ctx.rand);
      }
      desiredYaw = c.yaw;
      break;
    }

    case 'wander': {
      if (canFlee && dist <= sp.awareness) {
        enter(out, 'alert', ctx.rand, sp);
        speed = 0;
        desiredYaw = towardYaw;
        break;
      }
      if (perch) {
        // Glide a loop: fly out to a point on a circle of AI.perchGlideR
        // around home (angle rolled into targetYaw on entry), then fly back;
        // once close enough to home, settle into idle. Altitude itself is
        // handled uniformly for every perch state by `locomote`.
        const outTime = AI.perchGlideR / AI.perchGlideSpeed;
        speed = AI.perchGlideSpeed;
        if (out.stateTime < outTime) {
          const gx = c.home.x + Math.cos(c.targetYaw) * AI.perchGlideR;
          const gz = c.home.z + Math.sin(c.targetYaw) * AI.perchGlideR;
          desiredYaw = yawTo(gx - c.pos.x, gz - c.pos.z);
        } else {
          desiredYaw = yawTo(c.home.x - c.pos.x, c.home.z - c.pos.z);
          const homeDist = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
          if (homeDist <= AI.perchSettleDist) {
            enter(out, 'idle', ctx.rand, sp);
            speed = 0;
          }
        }
        break;
      }
      speed = sp.walkSpeed;
      desiredYaw = c.targetYaw;
      // Leash back toward home if we've wandered past the radius.
      const homeDist = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
      if (homeDist > AI.wanderRadius) {
        desiredYaw = yawTo(c.home.x - c.pos.x, c.home.z - c.pos.z);
      }
      // Non-fleeing species (e.g. bellowbuck) bias their wander away from a
      // near player rather than alerting.
      if (!canFlee && dist <= sp.awareness) desiredYaw = awayYaw;
      if (out.stateTime >= c.stateDur) {
        enter(out, 'idle', ctx.rand, sp);
        speed = 0;
      }
      break;
    }

    case 'alert': {
      // A critter linked mid-alert (the Task 10 "Linked moment") stands down
      // immediately — linked critters never chase-panic again.
      if (!canFlee) {
        enter(out, 'calm', ctx.rand, sp);
        speed = sp.walkSpeed * AI.calmSpeedFactor;
        break;
      }
      speed = 0;
      desiredYaw = towardYaw;
      out.targetYaw = towardYaw;
      if (out.stateTime >= AI.alertTime) {
        enter(out, 'flee', ctx.rand, sp);
        out.farTime = 0;
      }
      break;
    }

    case 'flee': {
      // Linked mid-flee → calm on the very next step (no flee speed).
      if (!canFlee) {
        enter(out, 'calm', ctx.rand, sp);
        out.farTime = 0;
        speed = sp.walkSpeed * AI.calmSpeedFactor;
        break;
      }
      desiredYaw = fleeYaw(c, sp, awayYaw, ctx);
      speed = fleeSpeed(c, sp);
      // Calm once the player has stayed far for long enough.
      if (dist > sp.awareness * AI.calmDistFactor) {
        out.farTime = c.farTime + dt;
      } else {
        out.farTime = 0;
      }
      if (out.farTime >= AI.calmTriggerTime) {
        enter(out, 'calm', ctx.rand, sp);
        speed = sp.walkSpeed * AI.calmSpeedFactor;
      }
      break;
    }

    case 'calm': {
      speed = sp.walkSpeed * AI.calmSpeedFactor;
      // A perch critter calms by heading back toward its perch rather than
      // holding whatever heading it fled in.
      desiredYaw = perch ? yawTo(c.home.x - c.pos.x, c.home.z - c.pos.z) : c.yaw;
      // A re-approaching player re-triggers the chase.
      if (canFlee && dist <= sp.awareness) {
        enter(out, 'alert', ctx.rand, sp);
        speed = 0;
        desiredYaw = towardYaw;
      } else if (out.stateTime >= AI.calmTime) {
        enter(out, 'wander', ctx.rand, sp);
        out.targetYaw = perch ? ctx.rand() * TWO_PI : pickWanderYaw(out, ctx.rand);
        speed = perch ? AI.perchGlideSpeed : sp.walkSpeed;
      }
      break;
    }
  }

  locomote(out, c, sp, ctx, desiredYaw, speed, dt);
  return out;
}

/** Enter a new state: reset the state timer and (re-)roll its dwell. */
function enter(
  out: CritterState,
  state: CritterState['state'],
  rand: () => number,
  sp: SpeciesDef,
): void {
  out.state = state;
  out.stateTime = 0;
  if (state === 'idle') {
    out.stateDur =
      sp.fleeStyle === 'perch'
        ? randRange(rand, AI.perchDwellMin, AI.perchDwellMax)
        : randRange(rand, AI.idleMin, AI.idleMax);
  } else if (state === 'wander') out.stateDur = randRange(rand, AI.wanderMin, AI.wanderMax);
  else if (state === 'calm') out.stateDur = AI.calmTime;
}

/** Ground speed during flee, honouring the sprint burst/pause cadence. */
function fleeSpeed(c: CritterState, sp: SpeciesDef): number {
  if (sp.fleeStyle === 'sprint') {
    const period = AI.sprintBurst + AI.sprintPause;
    const phase = c.stateTime % period;
    return phase < AI.sprintBurst ? sp.fleeSpeed : 0;
  }
  return sp.fleeSpeed;
}

/** Desired heading during flee, per the species' flee style. */
function fleeYaw(c: CritterState, sp: SpeciesDef, awayYaw: number, ctx: AIContext): number {
  switch (sp.fleeStyle) {
    case 'zigzag': {
      const leg = Math.floor(c.stateTime / AI.zigzagPeriod);
      const sign = leg % 2 === 0 ? 1 : -1;
      return awayYaw + sign * AI.zigzagAngle;
    }
    case 'fly':
    case 'perch': {
      // Wide banking arcs while generally escaping the player (the gargoyle's
      // perch flee reuses the same fly-like bank; altitude is separately
      // clamped to home.y + AI.perchAltClamp in `locomote`).
      return awayYaw + Math.sin(c.stateTime * AI.flyArcRate) * 0.8;
    }
    case 'swim':
      return swimYaw(c, awayYaw, ctx);
    case 'ledge':
      return ledgeYaw(c, awayYaw, ctx);
    default:
      return awayYaw; // sprint / none
  }
}

/** Bias the escape heading toward (and keep within) water for swimmers. */
function swimYaw(c: CritterState, awayYaw: number, ctx: AIContext): number {
  const p = AI.swimProbe;
  // Sample candidate headings around "away" and pick the one whose probe lands
  // in (or nearest to) water.
  let best = awayYaw;
  let bestScore = -Infinity;
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
    const yaw = awayYaw + off;
    const nx = c.pos.x + Math.sin(yaw) * p;
    const nz = c.pos.z + Math.cos(yaw) * p;
    const water = ctx.biomeAt(nx, nz) === 'water';
    // Prefer water, then smaller deviation from the away heading.
    const score = (water ? 100 : 0) - Math.abs(off);
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  return best;
}

/** Bias the escape heading uphill (toward the highest sampled ground). */
function ledgeYaw(c: CritterState, awayYaw: number, ctx: AIContext): number {
  const p = AI.ledgeProbe;
  let best = awayYaw;
  let bestH = -Infinity;
  for (const off of [0, 0.5, -0.5, 1.0, -1.0]) {
    const yaw = awayYaw + off;
    const nx = c.pos.x + Math.sin(yaw) * p;
    const nz = c.pos.z + Math.cos(yaw) * p;
    const h = ctx.ground.heightAt(nx, nz);
    if (h > bestH) {
      bestH = h;
      best = yaw;
    }
  }
  return best;
}

/**
 * Shared locomotion: rate-limit the turn toward `desiredYaw`, take a step at
 * `speed` while rejecting invalid steps (water for land species, too-steep
 * climbs for walkers), snap y to the terrain (flyers/swimmers excepted), and
 * write the realised velocity.
 */
function locomote(
  out: CritterState,
  prev: CritterState,
  sp: SpeciesDef,
  ctx: AIContext,
  desiredYaw: number,
  speed: number,
  dt: number,
): void {
  // Rate-limited turn.
  const maxTurn = AI.turnRate * dt;
  const d = angDiff(desiredYaw, prev.yaw);
  let yaw = prev.yaw + Math.max(-maxTurn, Math.min(maxTurn, d));

  // Perch critters (gargoyle) are treated exactly like flyers for the
  // obstacle-skip + freeform step below — they never collide with terrain —
  // but get their own altitude target (see below) instead of a
  // terrain-relative cruise band.
  const perch = sp.fleeStyle === 'perch';
  const flyer = sp.fleeStyle === 'fly' || perch;
  const swimmer = sp.fleeStyle === 'swim';

  let nx = prev.pos.x;
  let nz = prev.pos.z;

  if (speed > 0) {
    const stepLen = speed * dt;
    // Try the preferred heading; if the step is invalid, scan offsets for a
    // walkable direction (shore/contour following). Flyers move freely.
    const offsets = flyer ? [0] : [0, ...AI.avoidOffsets];
    let moved = false;
    for (const off of offsets) {
      const tryYaw = yaw + off;
      const tx = prev.pos.x + Math.sin(tryYaw) * stepLen;
      const tz = prev.pos.z + Math.cos(tryYaw) * stepLen;
      if (flyer || stepAllowed(prev, tx, tz, swimmer, ctx)) {
        nx = tx;
        nz = tz;
        yaw = tryYaw;
        moved = true;
        break;
      }
    }
    if (!moved) {
      // Boxed in — hold position but keep the intended facing.
      yaw = prev.yaw + Math.max(-maxTurn, Math.min(maxTurn, d));
    }
  }

  out.yaw = yaw;
  out.pos.x = nx;
  out.pos.z = nz;

  // Vertical: flyers cruise at flightHeight above terrain (smooth climb),
  // perch critters cruise at their fixed perch altitude (home.y — NOT
  // terrain-relative; they're circling castle towers, not the ground below
  // them), swimmers ride the water surface, walkers sit on the ground.
  const terrainY = ctx.ground.heightAt(nx, nz);
  if (perch) {
    const target = prev.home.y;
    const k = Math.min(1, AI.flyClimbRate * dt);
    const y = prev.pos.y + (target - prev.pos.y) * k;
    // Free-flight invariant (in EVERY state, not just flee): a perched
    // critter can never climb above its own perch.
    out.pos.y = Math.min(y, prev.home.y + AI.perchAltClamp);
  } else if (flyer) {
    const target = terrainY + prev.flightHeight;
    const k = Math.min(1, AI.flyClimbRate * dt);
    out.pos.y = prev.pos.y + (target - prev.pos.y) * k;
  } else if (swimmer) {
    out.pos.y = Math.max(terrainY, AI.waterSurfaceY);
  } else {
    out.pos.y = terrainY;
  }

  out.vel.x = (out.pos.x - prev.pos.x) / dt;
  out.vel.y = (out.pos.y - prev.pos.y) / dt;
  out.vel.z = (out.pos.z - prev.pos.z) / dt;
}

/** True if a land/swim critter may step to (nx, nz) from `prev`. */
function stepAllowed(
  prev: CritterState,
  nx: number,
  nz: number,
  swimmer: boolean,
  ctx: AIContext,
): boolean {
  const biome = ctx.biomeAt(nx, nz);
  if (swimmer) {
    // Swimmers stay in the water.
    return biome === 'water';
  }
  // Land species never enter water.
  if (biome === 'water') return false;
  // Walkers can't climb slopes steeper than the configured limit.
  const h0 = ctx.ground.heightAt(prev.pos.x, prev.pos.z);
  const h1 = ctx.ground.heightAt(nx, nz);
  const horiz = Math.hypot(nx - prev.pos.x, nz - prev.pos.z);
  if (horiz > 1e-4 && (h1 - h0) / horiz > AI.maxClimbTan) return false;
  return true;
}
