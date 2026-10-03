// Combat world fixtures: a Speck with a Snapper (and optional parts) on a flat sea floor, and fixture entities placed in front of it.
import { CombatWorld, type CombatContext } from '../../src/tiny-tide/combat-world';
import type { Entity } from '../../src/tiny-tide/ecosystem';
import { dietOf, starterGenome, type PlacedPart } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { freshRun } from '../../src/tiny-tide/state';
import { newSimState, playerActorCached, playerBody, playerMoves, type SimState } from '../../src/tiny-tide/sim';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import type { Species } from '../../src/tiny-tide/species';
import { FX_BEHAVIOURS } from './combat-fixture';

export const FLAT = makeWorldQueries({ groundAt: () => 0, surface: 85, space: false, slopeBound: 0 });
/** A Speck facing +z at (0, 1, 0) with a Snapper (or `mouth`); `extra` parts are added (uids p10…). */
export function speck(extra: Omit<PlacedPart, 'uid' | 'roll'>[] = [], mouth = 'mouth_snapper'): SimState {
  const run = freshRun(1), g = starterGenome();
  g.parts = g.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, id: mouth, scale: 1 } : p);
  extra.forEach((p, i) => g.parts.push({ ...p, uid: `p${10 + i}`, roll: 0 }));
  run.genome = g; run.diet = dietOf(g);
  const s = newSimState(run); s.combat = new CombatWorld(FX_BEHAVIOURS); s.mode = 'playing'; s.physical = { x: 0, y: 1, z: 0 };
  return s;
}
export function entity(id: number, spec: Species, at: Vec3, heading = Math.PI): Entity {
  return { id, spec, x: at.x, y: at.y, z: at.z, hx: at.x, hy: at.y, hz: at.z, groundOffset: 0, heading, phase: 0, hp: spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0,
    lastKnown: null, lastKnownHull: null, lastSeenAt: 0, reachable: false, reachableSince: null, blockedSince: null, returnUntil: 0, hazardReadyAt: 0, active: true };
}
/** One combat tick for the Speck at time `now`. */
export function tick(s: SimState, entities: Entity[], now: number, intent: Partial<CombatInput> = {}, dt = 1 / 60) {
  const actor = playerActorCached(s), body = playerBody(s, actor), m = playerMoves(s);
  const ctx: CombatContext = { now, dt, playing: true, intent: { ...RELEASED, ...intent }, wish: { x: 0, y: 0, z: 0 }, previousMove: { x: 0, y: 0, z: 0 }, player: body, moves: m.set, slots: m.slots,
    entities, stage: s.run.stage, diet: dietOf(s.run.genome), queries: FLAT };
  const r = s.combat.tick(ctx); s.run.health = body.health;
  return { r, body };
}
/** The context a species start at the player must give (spec §9.4): on screen, the player not held, a 60 Hz tick. */
export const AT_PLAYER = { onScreen: true, playerHeld: false, tick: 1 / 60 } as const;
