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
import { worldHull } from '../../src/tiny-tide/sim';
import { newAiState } from '../../src/tiny-tide/combat-ai';
import { hullOverlap, SEPARATION_SLOP } from '../../src/tiny-tide/separation';
import { speciesCombatPose } from '../../src/tiny-tide/mount';
import { SPECIES, species, type Species } from '../../src/tiny-tide/species';
import type { Vec3 } from '../../src/tiny-tide/combat-types';
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
  const eco = { entities, consume: (e: Entity) => { e.eaten = true; }, planetIndex: () => 0, step: () => [], giveUps, giveUpAll: (now: number, seconds: number) => { giveUps.push([now, seconds]); },
    givingUp: () => false, lineOfSight: () => true } as unknown as Ecosystem;
  return { eco, startGrace: 0, isOnScreen: () => true, legality: stage => ({ queries: FLAT, bounds: stageBounds(stage) }) };
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
  it('an alpha kill pays its reward DNA and unlocks its rare part, once, also for a herbivore (spec §10.4, D23)', () => {
    for (const mouth of [undefined, 'mouth_nibbler']) {
      const alpha = { ...FX_FLEER, hp: 1, dna: 10, alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 } }, mother = entity(1, alpha, { x: 0, y: 0, z: 0 }), { s, w } = begun([mother], mouth);
      Object.assign(mother, ahead(s, 2.1)); mother.mode = 'angry';
      const stageDna = s.run.stageDna, events: SimEvent[] = [...frame(s, w, { basicPressed: true, basicHeld: true })];
      for (let i = 0; i < 40; i++) events.push(...frame(s, w));
      expect(events.filter(e => e.type === 'killed')).toEqual([{ type: 'killed', entity: mother, dna: 40, drop: 'claw_mother' }]);
      expect(s.run.unlocked).toEqual(['claw_mother']); expect(s.run.stageDna).toBe(stageDna + 40);
      const again = entity(2, alpha, { x: 0, y: 0, z: 0 }); w.eco.entities.push(again); Object.assign(again, ahead(s, 2.1)); again.mode = 'angry';
      const later: SimEvent[] = []; for (let i = 0; i < 30; i++) later.push(...frame(s, w)); later.push(...frame(s, w, { basicPressed: true, basicHeld: true })); for (let i = 0; i < 40; i++) later.push(...frame(s, w));
      expect(later.filter(e => e.type === 'killed')).toEqual([{ type: 'killed', entity: again, dna: 0, drop: null }]); expect(s.run.stageDna).toBe(stageDna + 40);
    }
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

describe('soft body separation (T17 fix round 1)', () => {
  const MOTHER = SPECIES.find(x => x.key === '1:clawmother')!, CRAB = species(1, 'crab'), DRIFTER = species(0, 'drifter');
  /** A shipped-behaviour Speck sim with `e` placed so that its hull centre is at the Speck's hull centre plus `offset`. */
  function setup(spec: Species, offset: Vec3) {
    const e = entity(1, spec, { x: 0, y: 0, z: 0 }), { s, w } = begun([e]); s.combat = new CombatWorld();
    const actor = playerActorCached(s), pc = hullCentreOf(worldHull(s, actor)), ec = speciesCombatPose(e, 0).hull[0]!.start;
    Object.assign(e, { x: pc.x + offset.x - (ec.x - e.x), y: pc.y + offset.y - (ec.y - e.y), z: pc.z + offset.z - (ec.z - e.z) });
    return { e, s, w, actor };
  }
  const hullCentreOf = (h: readonly { start: Vec3; end: Vec3 }[]) => ({ x: h.reduce((a, c) => a + c.start.x + c.end.x, 0) / (2 * h.length), y: h.reduce((a, c) => a + c.start.y + c.end.y, 0) / (2 * h.length), z: h.reduce((a, c) => a + c.start.z + c.end.z, 0) / (2 * h.length) });
  it('a player pushed into the Clawmother ends outside her hull within 0.2 s, and every installed pose is admitted', () => {
    const { e, s, w, actor } = setup(MOTHER, { x: .15, y: .5, z: .1 });
    expect(hullOverlap(worldHull(s, actor), speciesCombatPose(e, 0).hull)).toBeGreaterThan(actor.bodyLength);   // deep inside her
    const legal = w.legality(0);
    for (let i = 0; i < 12; i++) {
      frame(s, w);
      expect(legal.queries.overlapHull(actor, s.physical, s.rt.orientation, { time: s.time, bounds: legal.bounds }).ok).toBe(true);
    }
    expect(hullOverlap(worldHull(s, actor), speciesCombatPose(e, s.time).hull)).toBeLessThanOrEqual((SEPARATION_SLOP + .02) * actor.bodyLength);
  });
  it('a crab pinch hits a player who tried to stand at the crab\'s centre', () => {
    const { e, s, w } = setup(CRAB, { x: 0, y: 0, z: 0 }); e.mode = 'hunt'; s.run.health = 50;
    const outcomes: string[] = [];
    for (let i = 0; i < 6 * 60; i++) for (const ev of frame(s, w)) if (ev.type === 'combat') outcomes.push(...ev.tick.events.filter(x => x.attackerId === 'e1' && x.targetId === 'player').map(x => x.outcome));
    expect(outcomes).toContain('hit');
  });
  it('a Clawmother pinch hits a player who keeps trying to stand at her centre (the review case)', () => {
    const { e, s, w } = setup(MOTHER, { x: .15, y: .5, z: .1 }); s.run.health = 50;
    const outcomes: string[] = [];
    for (let i = 0; i < 8 * 60; i++) {
      const c = speciesCombatPose(e, s.time).hull[0]!.start, d = { x: c.x - s.physical.x, y: 0, z: c.z - s.physical.z }, l = Math.hypot(d.x, d.z) || 1;
      for (const ev of simFrame(s, w, { dt: DT, intent: { ...RELEASED }, wish: { x: d.x / l, y: 0, z: d.z / l }, held: false }))
        if (ev.type === 'combat') outcomes.push(...ev.tick.events.filter(x => x.attackerId === 'e1' && x.targetId === 'player').map(x => x.outcome));
    }
    expect(outcomes).toContain('hit');
  });
  it('no separation jitter: a body at rest touching a species keeps still (< 1e-3 L over 60 frames)', () => {
    const { s, w, actor } = setup(DRIFTER, { x: 0, y: 0, z: .8 * actor0().bodyLength });
    for (let i = 0; i < 60; i++) frame(s, w);   // settle out of the overlap
    const at = { ...s.physical }, path: number[] = [];
    for (let i = 0; i < 60; i++) { frame(s, w); path.push(Math.hypot(s.physical.x - at.x, s.physical.y - at.y, s.physical.z - at.z)); }
    expect(Math.max(...path)).toBeLessThan(1e-3 * actor.bodyLength);
  });
  it('no separation from an alpha under the sand (burrowed); the same alpha above the sand pushes', () => {
    const moved = (name: 'burrowed' | 'approach') => {
      const { e, s, w } = setup(MOTHER, { x: .15, y: .5, z: .1 }), c = s.combat.stateOf(e)!;
      c.ai = newAiState(1, e.id, 0); c.ai.name = name; c.ai.since = 0; c.ai.home = { x: e.x, y: e.y, z: e.z }; if (name === 'burrowed') { c.ai.phase = 1; e.hp = .5 * c.maxHp; }
      const before = { ...s.physical }; frame(s, w);
      expect(c.ai.name).toBe(name === 'burrowed' ? 'burrowed' : c.ai.name);
      return Math.hypot(s.physical.x - before.x, s.physical.z - before.z);
    };
    expect(moved('burrowed')).toBeLessThan(1e-6); expect(moved('approach')).toBeGreaterThan(.01);
  });
});
const actor0 = () => playerActorCached(speck());
