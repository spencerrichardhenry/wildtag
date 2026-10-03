// tests/tiny-tide-core/sim-combat.test.ts — T8b: simFrame runs the combat tick after the player step and before the chomp (spec §3.1):
// kills are consumed and forgotten, combat damage faints once, a held basic input on food still chomps, and one combat pose per frame.
import { describe, expect, it, vi } from 'vitest';
import * as mount from '../../src/tiny-tide/mount';
import { SIZES } from '../../src/tiny-tide/biomes';
import { CombatWorld } from '../../src/tiny-tide/combat-world';
import type { Ecosystem, Entity } from '../../src/tiny-tide/ecosystem';
import { RELEASED } from '../../src/tiny-tide/input';
import { applyHitStop, bufferPress, holdingAction } from '../../src/tiny-tide/action-engine';
import { stageBounds } from '../../src/tiny-tide/world-queries';
import type { CombatInput } from '../../src/tiny-tide/combat-types';
import { FAINT_GIVE_UP, playerActorCached, playerMotionBody, REGEN_AFTER, simBegin, simEvolve, simFrame, simSuspend, type SimEvent, type SimState, type SimWorld } from '../../src/tiny-tide/sim';
import { earn } from '../../src/tiny-tide/economy';
import { RESPAWN_GRACE } from '../../src/tiny-tide/lifecycle';
import { currentPlan, mealDna } from '../../src/tiny-tide/state';
import { FX_BEHAVIOURS, FX_FLEER, FX_HUNTER, POKE, WRAP } from './combat-fixture';
import { AT_PLAYER, entity, FLAT, speck } from './combat-fixture-world';

const DT = 1 / 60;
/** A flat stage-0 world whose ecosystem only holds `entities` (it never moves them). */
function flatWorld(entities: Entity[]): SimWorld {
  const giveUps: [number, number][] = [];
  const eco = { entities, consume: (e: Entity) => { e.eaten = true; }, planetIndex: () => 0, step: () => [], giveUps, giveUpAll: (now: number, seconds: number) => { giveUps.push([now, seconds]); } } as unknown as Ecosystem;
  return { eco, startGrace: 0, legality: stage => ({ queries: FLAT, bounds: stageBounds(stage) }) };
}
function begun(entities: Entity[], mouth?: string): { s: SimState; w: SimWorld } {
  const s = speck([], mouth), w = flatWorld(entities);
  simBegin(s, w, s.run, null); s.combat = new CombatWorld(FX_BEHAVIOURS);
  return { s, w };
}
const frame = (s: SimState, w: SimWorld, intent: Partial<CombatInput> = {}) => simFrame(s, w, { dt: DT, intent: { ...RELEASED, ...intent }, wish: { x: 0, y: 0, z: 0 }, held: false });
const ahead = (s: SimState, d: number, tier = 0) => ({ x: s.physical.x, y: s.physical.y - .35 * SIZES[tier]!, z: s.physical.z + d });

describe('the combat tick in simFrame', () => {
  it('a Bite kills a combat prey: one combat event with the kill; the prey is consumed and forgotten, and no chomp runs', () => {
    const prey = entity(1, { ...FX_FLEER, hp: 3 }, { x: 0, y: 0, z: 0 }), { s, w } = begun([prey]);
    Object.assign(prey, ahead(s, 2.1));
    const events: SimEvent[] = [...frame(s, w, { basicPressed: true, basicHeld: true })];
    for (let i = 0; i < 40; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'chomp')).toEqual([]);
    const kills = events.flatMap(e => e.type === 'combat' ? e.tick.killed : []);
    expect(kills).toEqual([prey]); expect(prey.eaten).toBe(true); expect(s.combat.entities.has(1)).toBe(false);
  });
  it('without a combat species in the cone the basic input chomps as before', () => {
    const { s, w } = begun([]);
    expect(frame(s, w, { basicPressed: true, basicHeld: true }).map(e => e.type)).toContain('chomp');
  });
  it('combat damage that empties the hearts faints once, with a fainted event', () => {
    const squid = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([squid]);
    Object.assign(squid, ahead(s, 1.2, 1)); s.run.health = .5;
    const c = s.combat.stateOf(squid)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    expect(typeof s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre })).toBe('object');
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && s.mode === 'playing'; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'fainted')).toHaveLength(1);
    expect(s.mode).toBe('fainted'); expect(s.run.deaths).toBe(1); expect(s.faintLog).toHaveLength(1);
    // Spec §9.4, §13: the faint ends every attack at the player and returns its token.
    expect(s.combat.director.tokens).toEqual([]); expect(c.rt.actions.filter(a => a.phase !== 'interrupted')).toEqual([]);
  });
  it('the faint event reports the at-risk DNA it took; hunters give up for FAINT_GIVE_UP (D27)', () => {
    const squid = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([squid]);
    Object.assign(squid, ahead(s, 1.2, 1)); s.run.health = .5; s.run.economy = earn(s.run.economy, 9); s.run.stageDna = 9;
    const uid = Object.keys(s.run.economy.parts)[0]!; s.run.economy.parts[uid]!.credit.atRisk += 5;   // part credit bought at this size
    const c = s.combat.stateOf(squid)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre });
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && s.mode === 'playing'; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'fainted')).toEqual([{ type: 'fainted', lost: 14 }]);   // the true loss: wallet 9 + part credit 5
    expect(s.run.economy.wallet.atRisk).toBe(0); expect(s.run.stageDna).toBe(0);
    expect((w.eco as unknown as { giveUps: [number, number][] }).giveUps).toEqual([[s.time - DT, FAINT_GIVE_UP]]);
  });
  it('a respawn keeps hunters off for the grace plus FAINT_GIVE_UP: from the faint timer and from a save loaded during a faint', () => {
    const squid = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([squid]), giveUps = (w.eco as unknown as { giveUps: [number, number][] }).giveUps;
    Object.assign(squid, ahead(s, 1.2, 1)); s.run.health = .5;
    const c = s.combat.stateOf(squid)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre });
    const events: SimEvent[] = [];
    for (let i = 0; i < 400 && !events.some(e => e.type === 'respawned'); i++) events.push(...frame(s, w));
    expect(giveUps.map(g => g[1])).toEqual([FAINT_GIVE_UP, RESPAWN_GRACE + FAINT_GIVE_UP]);
    s.run.pendingRespawn = true; giveUps.length = 0; simBegin(s, w, s.run, null);
    expect(s.run.pendingRespawn).toBe(false); expect(giveUps).toEqual([[s.time, RESPAWN_GRACE + FAINT_GIVE_UP]]);
  });
  it('holds on the player end AT the faint, in the same frame (spec §13)', () => {
    const squid = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([squid]);
    Object.assign(squid, ahead(s, 1.2, 1)); s.run.health = 3;
    const c = s.combat.stateOf(squid)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre });
    for (let i = 0; i < 60 && s.rt.heldBy === null; i++) frame(s, w);
    expect(s.rt.heldBy).toBe('e2'); s.run.health = .5;   // the next squeeze empties the hearts
    for (let i = 0; i < 60 && s.mode === 'playing'; i++) frame(s, w);
    expect(s.mode).toBe('fainted'); expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0); expect(holdingAction(c.rt, 'player')).toBeUndefined();
  });
  it('holds on the player end AT an evolution (spec §13)', () => {
    const squid = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([squid]);
    Object.assign(squid, ahead(s, 1.2, 1)); s.run.health = 3;
    const c = s.combat.stateOf(squid)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre });
    for (let i = 0; i < 60 && s.rt.heldBy === null; i++) frame(s, w);
    expect(s.rt.heldBy).toBe('e2');
    simEvolve(s, { position: s.physical, orientation: s.rt.orientation });
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0); expect(holdingAction(c.rt, 'player')).toBeUndefined();
  });
  it('combat damage resets the regeneration wait (T8 carry, spec §10.2)', () => {
    const crab = entity(2, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([crab]);
    Object.assign(crab, ahead(s, 1.2, 1)); s.run.health = 2; expect(s.derived.maxHealth).toBeGreaterThan(2);
    const c = s.combat.stateOf(crab)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre });
    for (let i = 0; i < 120 && s.run.health === 2; i++) frame(s, w);
    const hitAt = s.rt.lastDamageAt, health = s.run.health; expect(health).toBe(1);   // POKE: 2 half-hearts
    expect(hitAt).toBeGreaterThan(0);
    while (s.time < hitAt + REGEN_AFTER - .05) frame(s, w);
    expect(s.run.health).toBe(health);   // no heart comes back inside the wait
    while (s.time < hitAt + REGEN_AFTER + 2.1) frame(s, w);
    expect(s.run.health).toBe(health + .5);
  });
  it('a carnivore kill pays the meal DNA through simFrame: a killed event, growth and a bite (spec §10.4)', () => {
    const prey = entity(1, { ...FX_FLEER, hp: 1, dna: 10 }, { x: 0, y: 0, z: 0 }), { s, w } = begun([prey]);
    expect(s.run.diet).toBe('carnivore'); Object.assign(prey, ahead(s, 2.1));
    const before = { stageDna: s.run.stageDna, bites: s.run.bites, atRisk: s.run.economy.wallet.atRisk }, dna = mealDna(currentPlan(s.run), s.run.diet, prey.spec);
    expect(dna).toBeGreaterThan(0);
    const events: SimEvent[] = [...frame(s, w, { basicPressed: true, basicHeld: true })];
    for (let i = 0; i < 40; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'killed')).toEqual([{ type: 'killed', entity: prey, dna, drop: null }]);
    expect(s.run.stageDna).toBe(before.stageDna + dna); expect(s.run.bites).toBe(before.bites + 1); expect(s.run.economy.wallet.atRisk).toBe(before.atRisk + dna);
    expect(prey.eaten).toBe(true);
  });
  it('a herbivore kill pays nothing: dna 0, no bite, no growth; the creature is still removed', () => {
    const prey = entity(1, { ...FX_FLEER, hp: 1, dna: 10 }, { x: 0, y: 0, z: 0 }), { s, w } = begun([prey], 'mouth_nibbler');
    expect(s.run.diet).toBe('herbivore'); Object.assign(prey, ahead(s, 2.1)); prey.mode = 'angry';   // a herbivore Bites only a creature engaged with it (R17)
    const before = { stageDna: s.run.stageDna, bites: s.run.bites, economy: structuredClone(s.run.economy) };
    const events: SimEvent[] = [...frame(s, w, { basicPressed: true, basicHeld: true })];
    for (let i = 0; i < 40; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'killed')).toEqual([{ type: 'killed', entity: prey, dna: 0, drop: null }]);
    expect(s.run.stageDna).toBe(before.stageDna); expect(s.run.bites).toBe(before.bites); expect(s.run.economy).toEqual(before.economy);
    expect(prey.eaten).toBe(true);
  });
  it('an attacker eaten on any path is forgotten after the frame: its token returns (fix round 1)', () => {
    const crab = entity(4, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([crab]);
    Object.assign(crab, ahead(s, 4, 1));
    const c = s.combat.stateOf(crab)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    expect(typeof s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre })).toBe('object');
    frame(s, w); expect(s.combat.director.tokens).toHaveLength(1);
    w.eco.consume(crab); frame(s, w);
    expect(s.combat.entities.has(4)).toBe(false); expect(s.combat.director.tokens).toEqual([]);
    crab.eaten = false; frame(s, w);
    expect(s.combat.stateOf(crab)!.rt.actions).toEqual([]);
  });
  it('an evolution ends every attack at the player and returns its token (spec §9.4, §13)', () => {
    const crab = entity(3, FX_HUNTER, { x: 0, y: 0, z: 0 }), { s, w } = begun([crab]);
    Object.assign(crab, ahead(s, 4, 1));
    const c = s.combat.stateOf(crab)!, centre = playerMotionBody(s, playerActorCached(s)).centre;
    expect(typeof s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', s.time, { ...AT_PLAYER, targetAt: centre })).toBe('object');
    frame(s, w); expect(s.combat.director.tokens).toHaveLength(1);
    simEvolve(s, { position: s.physical, orientation: s.rt.orientation });
    expect(s.combat.director.tokens).toEqual([]); expect(c.rt.actions.filter(a => a.phase !== 'interrupted')).toEqual([]);
  });
  it('samples the player\'s combat pose once per playing frame (review R18)', () => {
    const { s, w } = begun([]);
    let n = 0; const original = mount.sampleCombatPose;
    const spy = vi.spyOn(mount, 'sampleCombatPose').mockImplementation(i => { n++; return original(i); });
    try { for (let i = 0; i < 10; i++) frame(s, w, { basicHeld: true }); } finally { spy.mockRestore(); }
    expect(n).toBe(10);
  });
  it('an empty slot press next to a basic press still chomps (T7 carry)', () => {
    const { s, w } = begun([]);
    expect(frame(s, w, { basicPressed: true, basicHeld: true, activePressed: [false, false, false, true] }).map(e => e.type)).toContain('chomp');
  });
  it('a pause or an edit drops the buffered press (spec §5.7, review R19)', () => {
    for (const mode of ['paused', 'editing'] as const) {
      const { s } = begun([]);
      applyHitStop(s.rt, s.time, .07); expect(bufferPress(s.rt, 0, s.time)).toBe(true);
      simSuspend(s, mode);
      expect(s.mode).toBe(mode); expect(s.rt.buffered).toBeNull();
    }
  });
});
