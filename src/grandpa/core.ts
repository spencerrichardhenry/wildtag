import type { GroundQuery, MoveState, Vec3 } from '../core/types.ts';
import { resolveCollision, type Obstacle } from '../player/collision.ts';
import { GRANDPA, TERRAIN } from '../core/constants.ts';

export interface GrandpaInput {
  forward: number;
  strafe: number;
  yaw: number;
  jumpId: number;
  sprintId: number;
  vault: boolean;
  sneeze: boolean;
}
export const REST_INPUT: GrandpaInput = { forward: 0, strafe: 0, yaw: 0, jumpId: 0, sprintId: 0, vault: false, sneeze: false };
export interface Updraft { id: number; pos: Vec3; yaw: number; remaining: number }
export interface GrandpaState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  grounded: boolean;
  energy: number;
  charge: number;
  sprintRemaining: number;
  sprintCooldown: number;
  jumpId: number;
  sprintId: number;
  jumpBuffer: number;
  coyote: number;
  bounceSerial: number;
  sneezeWindup: number;
  sneezeCooldown: number;
  vaultCooldown: number;
  recovery: number;
  reboundBuffer: number;
  canRebound: boolean;
  airSneezeUsed: boolean;
  vaultHeld: boolean;
  sneezeHeld: boolean;
  stunt: 'waddle' | 'jump' | 'vault' | 'sprint' | 'bounce' | 'sneeze' | 'wobble';
  updraft: Updraft | null;
  sneezeSerial: number;
}
export interface ChaseState { phase: 'roaming' | 'tracking' | 'caught'; progress: number; surrender: number; rounds: number }
export interface GrandpaReward { caught: boolean; statue: { pos: Vec3; yaw: number } | null }
export interface GrandpaWorld {
  ground: GroundQuery;
  obstacles(pos: Vec3): Obstacle[];
  resolve?: (from: Vec3, next: MoveState, radius: number) => MoveState;
  bounce?: (from: Vec3, to: Vec3, velY: number) => { pos: Vec3; velocity: number } | null;
}

export function createGrandpa(pos: Vec3, yaw = 0): GrandpaState {
  return { pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw, grounded: true, energy: 100,
    charge: 0, sprintRemaining: 0, sprintCooldown: 0, jumpId: 0, sprintId: 0, jumpBuffer: 0, coyote: 0, bounceSerial: 0,
    sneezeWindup: 0, sneezeCooldown: 0, vaultCooldown: 0, recovery: 0, reboundBuffer: 0, canRebound: false,
    airSneezeUsed: false, vaultHeld: false, sneezeHeld: false, stunt: 'waddle', updraft: null, sneezeSerial: 0 };
}
export function createChase(): ChaseState { return { phase: 'roaming', progress: 0, surrender: 0, rounds: 0 }; }
export function tagGrandpa(chase: ChaseState): ChaseState {
  return chase.phase === 'roaming' ? { ...chase, phase: 'tracking', progress: 0 } : chase;
}
export function stepChase(chase: ChaseState, dt: number, close: boolean): ChaseState {
  if (chase.phase === 'caught') {
    const surrender = Math.max(0, chase.surrender - dt);
    return surrender === 0 ? { ...createChase(), rounds: chase.rounds } : { ...chase, surrender };
  }
  if (chase.phase !== 'tracking' || !close) return chase;
  const progress = Math.min(1, chase.progress + dt / GRANDPA.trackSeconds);
  return progress >= 1 ? { phase: 'caught', progress: 1, surrender: GRANDPA.surrenderSeconds, rounds: chase.rounds + 1 } : { ...chase, progress };
}
export function earnStatue(reward: GrandpaReward): GrandpaReward {
  return reward.caught ? reward : { caught: true, statue: null };
}
export function parseReward(value: unknown): GrandpaReward {
  const empty = { caught: false, statue: null };
  if (!value || typeof value !== 'object') return empty;
  const r = value as Partial<GrandpaReward>;
  if (r.caught !== true) return empty;
  const s = r.statue;
  return { caught: true, statue: s && finiteVec(s.pos) && Number.isFinite(s.yaw) ? { pos: { ...s.pos }, yaw: s.yaw } : null };
}
export function finiteVec(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const p = value as Vec3;
  return [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100_000);
}
export function angleDelta(a: number, b: number): number { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const approach = (a: number, b: number, step: number) => a + clamp(b - a, -step, step);

/** Same fixed-step movement on the host and in the guest's input prediction. */
export function stepGrandpa(prev: GrandpaState, input: GrandpaInput, dt: number, world: GrandpaWorld, caught = false): GrandpaState {
  const s: GrandpaState = { ...prev, pos: { ...prev.pos }, vel: { ...prev.vel }, updraft: prev.updraft ? { ...prev.updraft, pos: { ...prev.updraft.pos } } : null };
  dt = clamp(dt, 0, 1 / 30);
  for (const k of ['sneezeCooldown', 'vaultCooldown', 'sprintCooldown', 'sprintRemaining', 'jumpBuffer', 'coyote', 'recovery', 'reboundBuffer'] as const) s[k] = Math.max(0, s[k] - dt);
  if (prev.sprintRemaining > 0 && s.sprintRemaining === 0 && !['vault', 'sneeze', 'bounce'].includes(s.stunt)) {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    if (speed > GRANDPA.walkSpeed) { s.vel.x *= GRANDPA.walkSpeed / speed; s.vel.z *= GRANDPA.walkSpeed / speed; }
  }
  if (s.updraft && (s.updraft.remaining -= dt) <= 0) s.updraft = null;
  const i = caught ? { ...REST_INPUT, yaw: s.yaw } : input;
  const jumpPress = input.jumpId > s.jumpId;
  const sprintPress = input.sprintId > s.sprintId;
  s.jumpId = Math.max(s.jumpId, input.jumpId); s.sprintId = Math.max(s.sprintId, input.sprintId);
  if (jumpPress && !caught) s.jumpBuffer = GRANDPA.jumpBuffer;
  if (prev.grounded) s.coyote = GRANDPA.coyoteTime;
  const vaultPress = i.vault && !prev.vaultHeld;
  s.vaultHeld = i.vault;
  s.sneezeHeld = i.sneeze;
  s.yaw += clamp(angleDelta(s.yaw, i.yaw), -dt * 10, dt * 10);
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const len = Math.max(1, Math.hypot(i.forward, i.strafe));
  const dx = (-Math.sin(i.yaw) * i.forward + Math.cos(i.yaw) * i.strafe) / len;
  const dz = (-Math.cos(i.yaw) * i.forward - Math.sin(i.yaw) * i.strafe) / len;
  const ready = !caught && s.recovery === 0 && s.sneezeWindup === 0;
  let launched = false;

  if (sprintPress && !caught && s.sprintCooldown === 0) {
    s.sprintRemaining = GRANDPA.sprintSeconds;
    s.sprintCooldown = GRANDPA.sprintCooldown;
  }

  if (vaultPress && !s.grounded && s.canRebound) s.reboundBuffer = GRANDPA.reboundWindow;
  if (i.sneeze && !prev.sneezeHeld && ready && s.sneezeCooldown === 0 && s.energy >= GRANDPA.sneezeCost && (s.grounded || !s.airSneezeUsed)) {
    s.sneezeWindup = GRANDPA.sneezeWindup;
    s.energy -= GRANDPA.sneezeCost;
    s.sneezeCooldown = GRANDPA.sneezeCooldown;
    s.charge = 0;
  }
  if (s.sneezeWindup > 0) {
    s.sneezeWindup = Math.max(0, s.sneezeWindup - dt);
    if (s.sneezeWindup === 0) {
      s.vel = { x: -fx * GRANDPA.sneezeSpeed, y: GRANDPA.sneezeLift, z: -fz * GRANDPA.sneezeSpeed };
      s.grounded = false;
      s.airSneezeUsed = true;
      s.canRebound = false;
      s.jumpBuffer = 0; s.coyote = 0;
      s.stunt = 'sneeze';
      s.updraft = { id: ++s.sneezeSerial, pos: { ...s.pos }, yaw: s.yaw, remaining: GRANDPA.updraftSeconds };
      launched = true;
    }
  } else if (ready && s.grounded && s.vaultCooldown === 0 && s.energy >= GRANDPA.vaultCost && i.vault) {
    s.charge = Math.min(GRANDPA.vaultCharge, s.charge + dt);
  } else if (s.charge > 0 && !i.vault && !caught) {
    const amount = s.charge / GRANDPA.vaultCharge;
    const speed = GRANDPA.vaultSpeed + amount * GRANDPA.vaultChargeSpeed;
    s.vel = { x: (Math.hypot(dx, dz) > .1 ? dx : fx) * speed, y: GRANDPA.vaultLift + amount * 8, z: (Math.hypot(dx, dz) > .1 ? dz : fz) * speed };
    s.charge = 0;
    s.energy -= GRANDPA.vaultCost;
    s.vaultCooldown = GRANDPA.vaultCooldown;
    s.grounded = false;
    s.canRebound = true;
    s.jumpBuffer = 0; s.coyote = 0;
    s.stunt = 'vault';
    launched = true;
  }
  if (caught) { s.charge = 0; s.sneezeWindup = 0; s.sprintRemaining = 0; s.jumpBuffer = 0; }
  if (!launched && !caught && s.jumpBuffer > 0 && s.coyote > 0 && s.charge === 0 && s.sneezeWindup === 0) {
    s.vel.y = GRANDPA.jumpSpeed; s.grounded = false; s.jumpBuffer = 0; s.coyote = 0;
    s.recovery = 0; s.canRebound = false; s.stunt = 'jump';
    // A normal hop keeps normal air steering, rather than stunt momentum.
  }
  if (!launched) {
    const restricted = caught || s.charge > 0 || s.sneezeWindup > 0 || s.recovery > 0;
    const runSpeed = GRANDPA.walkSpeed * (s.sprintRemaining > 0 ? GRANDPA.sprintMultiplier : 1);
    if (s.grounded) {
      const speed = restricted ? 0 : runSpeed;
      const acceleration = s.sprintRemaining > 0 ? GRANDPA.sprintAcceleration : 40;
      s.vel.x = approach(s.vel.x, dx * speed, dt * (restricted ? 40 : acceleration));
      s.vel.z = approach(s.vel.z, dz * speed, dt * (restricted ? 40 : acceleration));
      if (!restricted) { s.stunt = s.sprintRemaining > 0 ? 'sprint' : 'waddle'; s.energy = Math.min(100, s.energy + dt * GRANDPA.energyRegen); }
    } else {
      // Only stunts retain their launch momentum. A normal jump does not
      // inexplicably accelerate toward the former 18 m/s air-walk speed.
      const momentum = s.stunt === 'vault' || s.stunt === 'sneeze' || s.stunt === 'bounce';
      const speed = momentum ? Math.max(runSpeed, Math.hypot(s.vel.x, s.vel.z)) : runSpeed;
      if (!momentum || Math.hypot(dx, dz) > .1) {
        s.vel.x = approach(s.vel.x, dx * speed, dt * GRANDPA.airControl);
        s.vel.z = approach(s.vel.z, dz * speed, dt * GRANDPA.airControl);
      }
    }
  }
  s.vel.y += GRANDPA.gravity * dt;
  // Short collision steps keep the faster vault/sprint from crossing a thin
  // rock or post between samples. Trampolines use a swept vertical contact.
  const steps = Math.max(1, Math.ceil(Math.hypot(s.vel.x, s.vel.z) * dt / GRANDPA.collisionStep));
  for (let step = 0; step < steps; step++) {
    const from = { ...s.pos };
    s.pos = { x: s.pos.x + s.vel.x * dt / steps, y: s.pos.y + s.vel.y * dt / steps, z: s.pos.z + s.vel.z * dt / steps };
    s.pos = resolveCollision(s.pos, GRANDPA.radius, world.obstacles(s.pos));
    if (world.resolve) {
      const next = world.resolve(from, { pos: s.pos, vel: s.vel, grounded: s.grounded } as MoveState, GRANDPA.radius);
      s.pos = next.pos; s.vel = next.vel;
    }
    const bounce = !caught ? world.bounce?.(from, s.pos, s.vel.y) : null;
    if (bounce) {
      s.pos = bounce.pos; s.vel.y = bounce.velocity; s.grounded = false;
      s.stunt = 'bounce'; s.bounceSerial++; s.recovery = 0;
      s.canRebound = false; s.reboundBuffer = 0; s.jumpBuffer = 0; s.coyote = 0; s.airSneezeUsed = false;
      continue;
    }
    const floor = Math.max(TERRAIN.seaLevel, world.ground.heightBelow?.(s.pos.x, s.pos.z, Math.max(from.y, s.pos.y) + .45) ?? world.ground.heightAt(s.pos.x, s.pos.z));
    const wasAirborne = !s.grounded;
    // An uphill launch can meet rising terrain before its apex. Keep the feet
    // outside the hillside without consuming upward momentum or a rebound.
    if (s.pos.y < floor && s.vel.y > 0) s.pos.y = floor;
    // Long legs follow small downhill steps. Without adhesion every terrain dip
    // becomes a flight/landing and repeatedly applies the stunt recovery penalty.
    // Only an already grounded walker can adhere: vaults and actual ledges fall.
    const followsGround = s.grounded && !launched && s.pos.y - floor <= GRANDPA.groundFollow;
    if ((s.pos.y <= floor || followsGround) && s.vel.y <= 0) {
      const heavyLanding = ['vault', 'sneeze', 'bounce'].includes(s.stunt) || s.vel.y < -20;
      s.pos.y = floor; s.vel.y = 0; s.grounded = true; s.airSneezeUsed = false;
      if (wasAirborne) {
        if (s.jumpBuffer > 0 && !caught) {
          s.vel.y = GRANDPA.jumpSpeed; s.grounded = false; s.jumpBuffer = 0; s.coyote = 0; s.stunt = 'jump';
        } else if (s.canRebound && s.reboundBuffer > 0 && s.energy >= 12 && !caught) {
          s.vel.y = GRANDPA.reboundLift; s.vel.x *= .8; s.vel.z *= .8;
          s.grounded = false; s.energy -= 12; s.stunt = 'vault';
        } else if (heavyLanding) { s.recovery = GRANDPA.landingRecovery; s.stunt = 'wobble'; }
        s.canRebound = false; s.reboundBuffer = 0;
      }
    } else s.grounded = false;
  }
  if (!finiteVec(s.pos)) return createGrandpa(prev.pos, prev.yaw);
  return s;
}

/** A finite volume of lift, usable with the child's existing equipment. */
export function updraftImpulse(wind: Updraft | null, pos: Vec3, vy: number, dt: number): Vec3 | null {
  if (!wind || wind.remaining <= 0 || pos.y < wind.pos.y - 1 || pos.y > wind.pos.y + GRANDPA.updraftHeight || Math.hypot(pos.x - wind.pos.x, pos.z - wind.pos.z) > GRANDPA.updraftRadius) return null;
  return { x: Math.sin(wind.yaw) * dt * 4, y: Math.max(0, Math.min(GRANDPA.updraftLift - vy, GRANDPA.updraftAcceleration * dt)), z: Math.cos(wind.yaw) * dt * 4 };
}
