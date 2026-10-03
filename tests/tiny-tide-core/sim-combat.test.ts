// tests/tiny-tide-core/sim-combat.test.ts — T8b: simFrame runs the combat tick after the player step and before the chomp (spec §3.1):
// kills are consumed and forgotten, combat damage faints once, a held basic input on food still chomps, and one combat pose per frame.
import { describe, expect, it, vi } from 'vitest';
import * as mount from '../../src/tiny-tide/mount';
import { SIZES } from '../../src/tiny-tide/biomes';
import { CombatWorld } from '../../src/tiny-tide/combat-world';
import type { Ecosystem, Entity } from '../../src/tiny-tide/ecosystem';
import { RELEASED } from '../../src/tiny-tide/input';
import { stageBounds } from '../../src/tiny-tide/world-queries';
import type { CombatInput } from '../../src/tiny-tide/combat-types';
import { playerActorCached, playerMotionBody, simBegin, simFrame, type SimEvent, type SimState, type SimWorld } from '../../src/tiny-tide/sim';
import { FX_BEHAVIOURS, FX_FLEER, FX_HUNTER, WRAP } from './combat-fixture';
import { entity, FLAT, speck } from './combat-fixture-world';

const DT = 1 / 60;
/** A flat stage-0 world whose ecosystem only holds `entities` (it never moves them). */
function flatWorld(entities: Entity[]): SimWorld {
  const eco = { entities, consume: (e: Entity) => { e.eaten = true; }, planetIndex: () => 0, step: () => [] } as unknown as Ecosystem;
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
    expect(typeof s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', s.time, true, true, centre)).toBe('object');
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && s.mode === 'playing'; i++) events.push(...frame(s, w));
    expect(events.filter(e => e.type === 'fainted')).toHaveLength(1);
    expect(s.mode).toBe('fainted'); expect(s.run.deaths).toBe(1); expect(s.faintLog).toHaveLength(1);
  });
  it('samples the player\'s combat pose once per playing frame (review R18)', () => {
    const { s, w } = begun([]);
    let n = 0; const original = mount.sampleCombatPose;
    const spy = vi.spyOn(mount, 'sampleCombatPose').mockImplementation(i => { n++; return original(i); });
    try { for (let i = 0; i < 10; i++) frame(s, w, { basicHeld: true }); } finally { spy.mockRestore(); }
    expect(n).toBe(10);
  });
});
