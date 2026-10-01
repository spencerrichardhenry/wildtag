// Creature behavior for every tier. Positions are physical units (stage 0 units).
import { makeBiomes, populate, seabedHeight, SIZES, spawnPoint, WORLD_HALF, random, type Biome } from './biomes';
import type { Species } from './species';

export type Mode = 'calm' | 'flee' | 'hunt' | 'angry' | 'return';
export interface Entity {
  id: number; spec: Species;
  x: number; y: number; z: number; hx: number; hy: number; hz: number;
  /** Height above the seabed for creatures that follow the ground. */
  groundOffset: number;
  heading: number; phase: number; hp: number; eaten: boolean;
  /** Seconds until the creature comes back after it was eaten. */
  respawn: number; mode: Mode; modeTime: number; cooldown: number;
}
export interface EcoContext {
  stage: number; dt: number; time: number;
  player: { x: number; y: number; z: number };
  /** Player body radius in physical units. */
  playerRadius: number; stealthFactor: number;
  /** False while the player can not be hurt (evolving, menu, fainted). */
  vulnerable: boolean;
}
export interface EcoEvent { type: 'attack' | 'sting'; entity: Entity; damage: number }

export const RESPAWN_TIME = [14, 22] as const;
export const HUNT_GIVE_UP = 12;
export const ANGRY_TIME = 8;
export const ATTACK_COOLDOWN = 1.4;

export function makeEntities(seed: number): Entity[] {
  return populate(seed).map(spawn => ({
    id: spawn.id, spec: spawn.spec, x: spawn.x, y: spawn.y, z: spawn.z, hx: spawn.x, hy: spawn.y, hz: spawn.z,
    groundOffset: spawn.y - seabedHeight(spawn.x, spawn.z), heading: spawn.phase, phase: spawn.phase,
    hp: spawn.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, cooldown: 0,
  }));
}
/** Physical body radius of an entity, for contact checks. */
export const entityRadius = (e: Entity) => SIZES[e.spec.tier]! * (e.spec.kind === 'planet' ? 1.6 : .7);
const follows = (e: Entity) => ['graze', 'skittish'].includes(e.spec.behavior) && e.spec.tier <= 2 && !['copepod', 'shrimp'].includes(e.spec.kind);

/** Does this entity want to hunt a player of this stage, if it notices one? */
export const isThreat = (e: Entity, stage: number) => !e.eaten && (e.spec.hunts.includes(stage) || e.mode === 'angry');
export function noticeRadius(e: Entity, stage: number, stealthFactor: number) {
  return (e.spec.tier > stage ? 2.5 : 8) * SIZES[e.spec.tier]! * stealthFactor;
}
/** The player provokes a fighter by biting it. */
export function provoke(e: Entity) { if (e.spec.fights && !e.eaten) { e.mode = 'angry'; e.modeTime = 0; } }

export class Ecosystem {
  readonly entities: Entity[];
  readonly biomes: Biome[][];
  private rand: () => number;
  constructor(readonly seed: number) {
    this.entities = makeEntities(seed);
    this.biomes = SIZES.map((_, tier) => makeBiomes(seed, tier));
    this.rand = random(seed ^ 0x51ed);
  }
  /** Restores a run: planets already eaten stay eaten, everything else is fresh. */
  reset(eatenPlanets: readonly number[]) {
    const fresh = makeEntities(this.seed);
    this.entities.forEach((e, i) => Object.assign(e, fresh[i]!));
    let planet = 0;
    for (const e of this.entities) if (e.spec.kind === 'planet') { e.eaten = eatenPlanets.includes(planet); planet++; }
  }
  /** The planet index (0–11) of a planet entity. */
  planetIndex(e: Entity) { return this.entities.filter(other => other.spec.kind === 'planet').indexOf(e); }
  consume(e: Entity) {
    e.eaten = true; e.mode = 'calm'; e.modeTime = 0;
    e.respawn = e.spec.kind === 'planet' ? -1 : RESPAWN_TIME[0] + this.rand() * (RESPAWN_TIME[1] - RESPAWN_TIME[0]);
  }
  step(ctx: EcoContext): EcoEvent[] {
    const events: EcoEvent[] = [];
    for (const e of this.entities) {
      if (e.eaten) { this.tickRespawn(e, ctx); continue; }
      e.cooldown = Math.max(0, e.cooldown - ctx.dt); e.modeTime += ctx.dt;
      const size = SIZES[e.spec.tier]!;
      // Far tiers keep their ambient motion only; they never notice the player.
      const relevant = Math.abs(e.spec.tier - ctx.stage) <= 1;
      const dx = ctx.player.x - e.x, dy = ctx.player.y - e.y, dz = ctx.player.z - e.z, distance = Math.hypot(dx, dy, dz);
      const contact = distance < entityRadius(e) + ctx.playerRadius;
      if (relevant) this.think(e, ctx, distance);
      switch (e.mode) {
        case 'hunt': case 'angry': this.moveToward(e, ctx.player.x, ctx.player.y, ctx.player.z, e.spec.speed * size * (e.mode === 'angry' ? 1.15 : 1), ctx.dt); break;
        case 'flee': this.moveToward(e, e.x - dx, e.y - (follows(e) ? 0 : dy * .3), e.z - dz, e.spec.speed * size * 1.25, ctx.dt); break;
        case 'return': this.moveToward(e, e.hx, e.hy, e.hz, e.spec.speed * size * .7, ctx.dt); break;
        default: this.ambient(e, ctx);
      }
      if (follows(e)) e.y = seabedHeight(e.x, e.z) + e.groundOffset;
      const half = WORLD_HALF * size; e.x = Math.max(-half, Math.min(half, e.x)); e.z = Math.max(-half, Math.min(half, e.z));
      if (!relevant || !ctx.vulnerable || !contact || e.cooldown > 0) continue;
      if ((e.mode === 'hunt' || e.mode === 'angry') && e.spec.damage > 0) {
        events.push({ type: 'attack', entity: e, damage: e.spec.damage + Math.max(0, e.spec.tier - ctx.stage) }); e.cooldown = ATTACK_COOLDOWN;
      } else if (e.spec.stingsStages.includes(ctx.stage)) {
        events.push({ type: 'sting', entity: e, damage: e.spec.damage }); e.cooldown = ATTACK_COOLDOWN + .4;
      }
    }
    return events;
  }
  private think(e: Entity, ctx: EcoContext, distance: number) {
    const size = SIZES[e.spec.tier]!, notice = noticeRadius(e, ctx.stage, ctx.stealthFactor);
    if (e.mode === 'angry') { if (e.modeTime > ANGRY_TIME || distance > notice * 3) this.setMode(e, 'return'); return; }
    if (e.mode === 'hunt') { if (!ctx.vulnerable || e.modeTime > HUNT_GIVE_UP || distance > notice * 2.2) this.setMode(e, 'return'); return; }
    if (e.mode === 'return') { if (e.modeTime > 6 || Math.hypot(e.x - e.hx, e.z - e.hz) < size) this.setMode(e, 'calm'); return; }
    if (e.mode === 'flee') { if (e.modeTime > 2.5) this.setMode(e, 'calm'); return; }
    if (!ctx.vulnerable) return;
    if (e.spec.hunts.includes(ctx.stage) && distance < notice) { this.setMode(e, 'hunt'); return; }
    // Prey runs from a player that can eat it, but tires quickly so it can be caught.
    const prey = e.spec.tier <= ctx.stage && ['skittish', 'school'].includes(e.spec.behavior);
    if (prey && e.modeTime > 1.5 && distance < 7 * Math.max(size, SIZES[ctx.stage]!) * ctx.stealthFactor) this.setMode(e, 'flee');
  }
  private setMode(e: Entity, mode: Mode) { e.mode = mode; e.modeTime = 0; }
  private moveToward(e: Entity, x: number, y: number, z: number, speed: number, dt: number) {
    const dx = x - e.x, dy = y - e.y, dz = z - e.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return;
    const step = Math.min(length, speed * dt);
    e.x += dx / length * step; e.z += dz / length * step; if (!follows(e)) e.y += dy / length * step;
    if (Math.hypot(dx, dz) > 1e-4) e.heading = Math.atan2(dx, dz);
  }
  private ambient(e: Entity, ctx: EcoContext) {
    const size = SIZES[e.spec.tier]!, kind = e.spec.kind;
    switch (e.spec.behavior) {
      case 'drift': case 'school': case 'flyer': {
        const rate = kind === 'plane' ? .18 : .22, t = ctx.time * rate + e.phase;
        const tx = e.hx + Math.sin(t) * size * (e.spec.behavior === 'flyer' ? 1.6 : .75), tz = e.hz + Math.cos(t) * size * (e.spec.behavior === 'flyer' ? 1.2 : .55);
        const ty = e.hy + Math.sin(ctx.time * .6 + e.phase) * size * .12;
        // Ease back onto the loop after a chase instead of jumping.
        const k = 1 - Math.exp(-ctx.dt * 2.5);
        e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.z += (tz - e.z) * k;
        e.heading = Math.atan2(Math.cos(t), -Math.sin(t) * .73); break;
      }
      case 'graze': case 'skittish': {
        e.heading += Math.sin(ctx.time * .7 + e.phase * 3) * ctx.dt * 1.2;
        const away = Math.hypot(e.x - e.hx, e.z - e.hz);
        if (away > size * 5) e.heading = Math.atan2(e.hx - e.x, e.hz - e.z);
        const speed = e.spec.speed * size * .35;
        e.x += Math.sin(e.heading) * speed * ctx.dt; e.z += Math.cos(e.heading) * speed * ctx.dt;
        if (!follows(e)) e.y += (e.hy + Math.sin(ctx.time * .8 + e.phase) * size * .3 - e.y) * (1 - Math.exp(-ctx.dt));
        break;
      }
      default: break;
    }
  }
  private tickRespawn(e: Entity, ctx: EcoContext) {
    if (e.respawn < 0 || e.spec.tier > 3) return;
    e.respawn -= ctx.dt; if (e.respawn > 0) return;
    // New food arrives out of sight, so the world never visibly pops.
    // Plants, palms and lighthouses grow back where they were.
    const size = SIZES[e.spec.tier]!, away = 16 * size;
    if (e.spec.behavior === 'still') {
      if (Math.hypot(e.hx - ctx.player.x, e.hz - ctx.player.z) < away) { e.respawn = 0; return; }
      Object.assign(e, { x: e.hx, y: e.hy, z: e.hz, hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, cooldown: 0 }); return;
    }
    const point = spawnPoint(e.spec, this.biomes[e.spec.tier]!, this.rand, { x: ctx.player.x, z: ctx.player.z, radius: away });
    Object.assign(e, { x: point.x, y: point.y, z: point.z, hx: point.x, hy: point.y, hz: point.z, groundOffset: point.y - seabedHeight(point.x, point.z), hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, cooldown: 0 });
  }
}
